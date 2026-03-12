"""Publishing service for analyst-to-consumer public feed."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import SourceReliability
from app.models.case import Case, CaseEvidence, EvidenceType
from app.models.cluster_publication import ClusterPublication
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.source import Source
from app.models.user import User


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        return host or None
    except Exception:
        return None


def _normalize_source_key(source_id: str | None, url: str | None) -> str | None:
    if source_id:
        return source_id.lower()
    return _safe_domain(url)


@dataclass(frozen=True)
class PublishPolicyResult:
    meets_policy: bool
    official_confirmation: bool
    distinct_sources: int
    official_sources: int
    independent_sources: int
    unknown_sources: int
    warnings: list[str]
    rule: str

    def as_dict(self) -> dict:
        return {
            "meets_policy": self.meets_policy,
            "official_confirmation": self.official_confirmation,
            "distinct_sources": self.distinct_sources,
            "official_sources": self.official_sources,
            "independent_sources": self.independent_sources,
            "unknown_sources": self.unknown_sources,
            "warnings": self.warnings,
            "rule": self.rule,
        }


async def _get_source_profile(
    db: AsyncSession,
    *,
    source_id: str | None,
    url: str | None,
) -> dict:
    """
    Return a normalized source profile for policy and UI.

    Tries:
      1) SourceReliability by source_id (RSS id) OR by domain
      2) Source table by source_id (for category hint)
    """
    domain = _safe_domain(url)

    reliability: SourceReliability | None = None
    if source_id:
        reliability = await db.scalar(select(SourceReliability).where(SourceReliability.source_id == source_id))

    if not reliability and domain:
        reliability = await db.scalar(select(SourceReliability).where(SourceReliability.source_id == domain))

    source_row: Source | None = None
    if source_id:
        source_row = await db.scalar(select(Source).where(Source.id == source_id))

    # Determine source_type (government/rss/wire/blog/social/unknown)
    source_type: str | None = None
    if reliability:
        source_type = reliability.source_type
    elif source_row:
        source_type = "government" if source_row.category == "government" else "rss"
    else:
        source_type = "unknown"

    return {
        "source_id": source_id,
        "domain": domain,
        "source_type": source_type,
        "reliability_rating": getattr(reliability, "reliability_rating", None),
        "credibility_rating": getattr(reliability, "credibility_rating", None),
        "admiralty_code": reliability.admiralty_code if reliability else None,
        "confidence_score": getattr(reliability, "confidence_score", None),
        "source_name": getattr(reliability, "source_name", None) or (source_row.name if source_row else None),
    }


def evaluate_publish_policy(
    citations: Sequence[dict],
    *,
    require_distinct_sources: int = 2,
    require_official_and_independent: bool = True,
) -> PublishPolicyResult:
    """
    Evaluate whether a set of citations meets the "independent + official" policy.

    Policy:
      - Must have >= 2 distinct sources total
      - Prefer >= 1 official + >= 1 independent
      - If no official sources: allow publish as UNCONFIRMED if >= 2 independent/unknown
    """
    warnings: list[str] = []

    # Collapse to distinct sources
    source_keys: set[str] = set()
    official_keys: set[str] = set()
    independent_keys: set[str] = set()
    unknown_keys: set[str] = set()

    for c in citations:
        key = c.get("source_key")
        if not key:
            continue
        source_keys.add(key)
        classification = c.get("source_classification") or "unknown"
        if classification == "official":
            official_keys.add(key)
        elif classification == "independent":
            independent_keys.add(key)
        else:
            unknown_keys.add(key)

    distinct = len(source_keys)
    official = len(official_keys)
    independent = len(independent_keys)
    unknown = len(unknown_keys)

    if distinct < require_distinct_sources:
        return PublishPolicyResult(
            meets_policy=False,
            official_confirmation=False,
            distinct_sources=distinct,
            official_sources=official,
            independent_sources=independent,
            unknown_sources=unknown,
            warnings=["needs_more_sources"],
            rule="minimum_sources",
        )

    if not require_official_and_independent:
        return PublishPolicyResult(
            meets_policy=True,
            official_confirmation=official > 0,
            distinct_sources=distinct,
            official_sources=official,
            independent_sources=independent,
            unknown_sources=unknown,
            warnings=warnings,
            rule="minimum_sources",
        )

    # Count unknown as independent for minimum coverage, but warn loudly
    effective_independent = independent + unknown
    if unknown > 0:
        warnings.append("unrated_sources_present")

    if official > 0 and effective_independent > 0:
        return PublishPolicyResult(
            meets_policy=True,
            official_confirmation=True,
            distinct_sources=distinct,
            official_sources=official,
            independent_sources=independent,
            unknown_sources=unknown,
            warnings=warnings,
            rule="official_plus_independent",
        )

    # Allow publish without official confirmation, but mark unconfirmed and require >=2 non-official.
    if official == 0 and effective_independent >= 2:
        warnings.append("not_officially_confirmed")
        return PublishPolicyResult(
            meets_policy=True,
            official_confirmation=False,
            distinct_sources=distinct,
            official_sources=official,
            independent_sources=independent,
            unknown_sources=unknown,
            warnings=warnings,
            rule="unconfirmed_two_independent",
        )

    return PublishPolicyResult(
        meets_policy=False,
        official_confirmation=False,
        distinct_sources=distinct,
        official_sources=official,
        independent_sources=independent,
        unknown_sources=unknown,
        warnings=warnings + ["missing_required_source_mix"],
        rule="official_plus_independent",
    )


async def build_citations_from_cluster(
    db: AsyncSession,
    cluster: StoryCluster,
    *,
    max_sources: int = 10,
) -> list[dict]:
    """
    Build citations from a cluster's stories, selecting at most one canonical story per source_id.
    """
    seen_sources: set[str] = set()
    citations: list[dict] = []

    stories = sorted(
        cluster.stories,
        key=lambda s: (s.published_at or datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )

    for story in stories:
        if not story.source_id:
            continue
        if story.source_id in seen_sources:
            continue
        seen_sources.add(story.source_id)

        profile = await _get_source_profile(db, source_id=story.source_id, url=story.url)
        source_classification = (
            "official" if profile["source_type"] == "government"
            else "independent" if profile["source_type"] in {"rss", "wire", "blog"}
            else "unknown"
        )

        citations.append(
            {
                "url": story.url,
                "title": story.title,
                "source_id": story.source_id,
                "source_name": story.source_name or profile.get("source_name"),
                "source_type": profile.get("source_type"),
                "admiralty_code": profile.get("admiralty_code"),
                "reliability_rating": profile.get("reliability_rating"),
                "credibility_rating": profile.get("credibility_rating"),
                "source_key": _normalize_source_key(story.source_id, story.url),
                "source_classification": source_classification,
                "accessed_at": _utc_now().isoformat(),
            }
        )

        if len(citations) >= max_sources:
            break

    return citations


async def build_citations_from_case(
    db: AsyncSession,
    case: Case,
    *,
    max_items: int = 20,
) -> list[dict]:
    """
    Build citations from case evidence.

    We treat STORY and LINK evidence as citations.
    """
    result = await db.execute(
        select(CaseEvidence)
        .where(CaseEvidence.case_id == case.id)
        .order_by(CaseEvidence.created_at.desc())
    )
    evidence_items = list(result.scalars().all())

    citations: list[dict] = []
    for ev in evidence_items:
        if ev.evidence_type not in {EvidenceType.STORY, EvidenceType.LINK}:
            continue

        if ev.evidence_type == EvidenceType.STORY:
            try:
                story_id = UUID(ev.reference_id) if ev.reference_id else None
            except Exception:
                story_id = None

            story: Story | None = None
            if story_id:
                story = await db.scalar(select(Story).where(Story.id == story_id))

            if not story:
                # Fallback to what we have on the evidence row
                url = ev.reference_url
                profile = await _get_source_profile(db, source_id=None, url=url)
                source_classification = (
                    "official" if profile["source_type"] == "government"
                    else "independent" if profile["source_type"] in {"rss", "wire", "blog"}
                    else "unknown"
                )
                citations.append(
                    {
                        "url": url,
                        "title": ev.title,
                        "source_id": None,
                        "source_name": profile.get("source_name"),
                        "source_type": profile.get("source_type"),
                        "admiralty_code": profile.get("admiralty_code"),
                        "reliability_rating": profile.get("reliability_rating"),
                        "credibility_rating": profile.get("credibility_rating"),
                        "source_key": _normalize_source_key(None, url),
                        "source_classification": source_classification,
                        "accessed_at": _utc_now().isoformat(),
                    }
                )
            else:
                profile = await _get_source_profile(db, source_id=story.source_id, url=story.url)
                source_classification = (
                    "official" if profile["source_type"] == "government"
                    else "independent" if profile["source_type"] in {"rss", "wire", "blog"}
                    else "unknown"
                )
                citations.append(
                    {
                        "url": story.url,
                        "title": story.title,
                        "source_id": story.source_id,
                        "source_name": story.source_name or profile.get("source_name"),
                        "source_type": profile.get("source_type"),
                        "admiralty_code": profile.get("admiralty_code"),
                        "reliability_rating": profile.get("reliability_rating"),
                        "credibility_rating": profile.get("credibility_rating"),
                        "source_key": _normalize_source_key(story.source_id, story.url),
                        "source_classification": source_classification,
                        "accessed_at": _utc_now().isoformat(),
                    }
                )

        if ev.evidence_type == EvidenceType.LINK:
            url = ev.reference_url
            profile = await _get_source_profile(db, source_id=None, url=url)
            source_classification = (
                "official" if profile["source_type"] == "government"
                else "independent" if profile["source_type"] in {"rss", "wire", "blog"}
                else "unknown"
            )
            citations.append(
                {
                    "url": url,
                    "title": ev.title,
                    "source_id": None,
                    "source_name": profile.get("source_name"),
                    "source_type": profile.get("source_type"),
                    "admiralty_code": profile.get("admiralty_code"),
                    "reliability_rating": profile.get("reliability_rating"),
                    "credibility_rating": profile.get("credibility_rating"),
                    "source_key": _normalize_source_key(None, url),
                    "source_classification": source_classification,
                    "accessed_at": _utc_now().isoformat(),
                }
            )

        if len(citations) >= max_items:
            break

    # De-dupe citations by URL (keep first occurrence)
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for c in citations:
        url = c.get("url")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        deduped.append(c)

    return deduped


async def _next_publication_version(db: AsyncSession, cluster_id: UUID) -> int:
    max_version = await db.scalar(
        select(func.max(ClusterPublication.version)).where(ClusterPublication.cluster_id == cluster_id)
    )
    return int(max_version or 0) + 1


async def publish_cluster(
    db: AsyncSession,
    *,
    cluster: StoryCluster,
    publisher: User,
    headline: str,
    category: Optional[str],
    severity: Optional[str],
    customer_brief: Optional[str],
    citations: list[dict],
    change_note: Optional[str] = None,
    enforce_policy: bool = True,
) -> ClusterPublication:
    """
    Publish (or republish) a cluster to the consumer feed with a versioned publication record.
    """
    policy = evaluate_publish_policy(citations)
    if enforce_policy and not policy.meets_policy:
        raise ValueError(",".join(policy.warnings) or "publish_policy_failed")

    version = await _next_publication_version(db, cluster.id)
    policy_dict = policy.as_dict()
    policy_dict["total_citations"] = len(citations)

    # Update cluster display fields (these power the feed)
    cluster.analyst_headline = headline
    cluster.analyst_category = category or cluster.analyst_category or cluster.category
    cluster.analyst_severity = severity or cluster.analyst_severity or cluster.severity
    if customer_brief is not None:
        cluster.customer_brief = customer_brief

    # Mark published (only set published_at/by on first publish; versions track later updates)
    now = _utc_now()
    cluster.is_published = True
    cluster.workflow_status = "published"
    if not cluster.published_at:
        cluster.published_at = now
    if not cluster.published_by_id:
        cluster.published_by_id = publisher.id

    if not cluster.verified_at:
        cluster.verified_at = now
    if not cluster.verified_by_id:
        cluster.verified_by_id = publisher.id

    publication = ClusterPublication(
        cluster_id=cluster.id,
        version=version,
        created_by_id=publisher.id,
        created_at=now,
        headline=headline,
        category=cluster.analyst_category,
        severity=cluster.analyst_severity,
        customer_brief=cluster.customer_brief,
        citations=citations,
        policy_check=policy_dict,
        change_note=change_note,
    )
    db.add(publication)

    await db.commit()
    await db.refresh(publication)
    return publication

