"""Analyst Ops API endpoints (verify → publish workflow)."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_analyst
from app.ml.feature_extraction import build_priority_features, build_story_text, extract_severity_tokens
from app.ml.inference import get_predictor
from app.models.experience_record import ExperienceRecord, ExperienceType
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.user import User
from app.services.ops.event_dedup import group_stories_by_near_duplicate
from app.services.publishing_service import build_citations_from_cluster, publish_cluster
from app.schemas.ops import (
    OpsDuplicateGroup,
    OpsEventDetailResponse,
    OpsEventInboxItem,
    OpsEventInboxResponse,
    OpsPublishEventRequest,
    OpsRelatedEvent,
    OpsStoryItem,
    OpsUpdateEventRequest,
    WorkflowStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ops", tags=["ops"])


SEVERITY_WEIGHT = {
    "critical": 1.0,
    "high": 0.8,
    "medium": 0.5,
    "low": 0.2,
}

PRIORITY_CATEGORIES = {"political", "security", "disaster"}


def _display_fields(cluster: StoryCluster) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
    """
    Return (headline, summary, category, severity) for display.

    Prefer analyst overrides; for published clusters prefer customer_brief.
    """
    headline = cluster.analyst_headline or cluster.headline

    if cluster.is_published and cluster.customer_brief:
        summary = cluster.customer_brief
    else:
        summary = cluster.analyst_summary or cluster.summary

    category = cluster.analyst_category or cluster.category
    severity = cluster.analyst_severity or cluster.severity
    return headline, summary, category, severity


def _age_minutes(first_published: Optional[datetime], now: datetime) -> Optional[int]:
    if not first_published:
        return None
    return int((now - first_published).total_seconds() // 60)


def _impact_score(
    category: Optional[str],
    severity: Optional[str],
    story_count: int,
    source_count: int,
    age_min: Optional[int],
) -> float:
    sev = SEVERITY_WEIGHT.get((severity or "low").lower(), 0.2)
    src = min(1.0, max(0.0, source_count / 5.0))

    age_hours = max(1.0, (age_min or 60) / 60.0)
    velocity = story_count / age_hours
    vel = min(1.0, velocity / 3.0)  # 3 stories/hour ~= maxed

    base = (0.45 * sev) + (0.30 * src) + (0.25 * vel)
    cat_boost = 1.0 if (category or "").lower() in PRIORITY_CATEGORIES else 0.6
    return float(max(0.0, min(1.0, base * cat_boost)))


def _uncertainty_score(cluster: StoryCluster, age_min: Optional[int]) -> tuple[float, list[str]]:
    """
    ML-enhanced uncertainty score.

    Higher means "needs analyst verification".
    Combines heuristic signals with ML model confidence.
    """
    score = 0.0
    reasons: list[str] = []

    # === Heuristic signals ===
    if cluster.source_count <= 1:
        score += 0.35
        reasons.append("single_source")

    if not cluster.category:
        score += 0.10
        reasons.append("missing_category")

    if not cluster.severity:
        score += 0.10
        reasons.append("missing_severity")

    # Category disagreement across evidence stories
    story_categories = [s.category for s in cluster.stories if s.category]
    if story_categories:
        counts: dict[str, int] = defaultdict(int)
        for c in story_categories:
            counts[c] += 1
        top = max(counts.values())
        consistency = top / max(1, len(story_categories))
        if consistency < 0.6:
            score += 0.15
            reasons.append("category_disagreement")

    # Still early in the 30–60 min window => slightly more uncertainty
    if age_min is not None and age_min < 45:
        score += 0.05
        reasons.append("early_window")

    # === ML-based signals ===
    try:
        predictor = get_predictor()
        if predictor._initialized and cluster.headline:
            # Classification confidence
            result = predictor.classify_story(
                cluster.headline,
                cluster.summary or ""
            )
            if hasattr(result, 'confidence') and result.confidence < 0.6:
                score += 0.25
                reasons.append(f"low_ml_confidence:{result.confidence:.2f}")
    except Exception:
        pass  # Graceful degradation if ML unavailable

    return float(max(0.0, min(1.0, score))), reasons


def _ready_for_publish(cluster: StoryCluster, min_age_minutes: int, now: datetime) -> bool:
    if cluster.is_published:
        return False
    if cluster.workflow_status in ("rejected",):
        return False
    if not cluster.first_published:
        return False
    if (now - cluster.first_published) < timedelta(minutes=min_age_minutes):
        return False

    severity = (cluster.analyst_severity or cluster.severity or "low").lower()
    if cluster.source_count >= 2:
        return True
    if severity in {"high", "critical"}:
        return True
    return False


def _priority_reward(system_priority: str, human_priority: str) -> Decimal:
    priority_order = ["low", "medium", "high", "critical"]
    sys_idx = priority_order.index(system_priority) if system_priority in priority_order else 1
    human_idx = priority_order.index(human_priority) if human_priority in priority_order else 1

    diff = abs(sys_idx - human_idx)
    return Decimal(str(1.0 - (diff / 1.5)))


async def _record_publish_experience(
    db: AsyncSession,
    cluster: StoryCluster,
    *,
    label_source: str,
    similarity_threshold: float = 0.95,
) -> int:
    """
    Convert an analyst publish action into training labels.

    Records:
      - CLASSIFICATION labels (category)
      - PRIORITY labels (severity/priority)

    Uses canonical stories from soft-dedup groups to avoid over-weighting near-identicals.
    """
    # Idempotency: if we already recorded labels for this cluster, skip.
    existing = await db.scalar(
        select(func.count(ExperienceRecord.id)).where(
            ExperienceRecord.cluster_id == cluster.id,
            ExperienceRecord.experience_type.in_(
                [ExperienceType.CLASSIFICATION, ExperienceType.PRIORITY]
            ),
        )
    )
    if int(existing or 0) > 0:
        return 0

    human_category = (cluster.analyst_category or cluster.category or "").lower() or None
    human_priority = (cluster.analyst_severity or cluster.severity or "").lower() or None

    if not cluster.stories:
        return 0

    predictor = get_predictor()
    if not predictor._initialized:
        predictor.initialize()

    groups = await group_stories_by_near_duplicate(
        db,
        cluster.stories,
        similarity_threshold=similarity_threshold,
    )
    canonicals: list[Story] = [g[0] for g in groups if g]

    created = 0
    records: list[ExperienceRecord] = []
    for story in canonicals:
        system_category = (story.category or cluster.category or "unknown").lower()
        system_priority = (story.severity or cluster.severity or "medium").lower()

        if human_category:
            reward = Decimal("1.0") if system_category == human_category else Decimal("-1.0")
            records.append(
                ExperienceRecord(
                    experience_type=ExperienceType.CLASSIFICATION,
                    story_id=story.id,
                    cluster_id=cluster.id,
                    source_id=story.source_id,
                    context_features={
                        "text": build_story_text(story.title, story.summary),
                        "label_source": label_source,
                    },
                    system_action=system_category,
                    human_action=human_category,
                    reward=reward,
                    used_in_training=False,
                )
            )
            created += 1

        if human_priority:
            severity_tokens = extract_severity_tokens(story.title, story.summary)
            features = build_priority_features(
                predictor,
                category=human_category or system_category,
                source_id=story.source_id,
                published_at=story.published_at,
                severity_tokens=severity_tokens,
                entity_count=0,
            )

            records.append(
                ExperienceRecord(
                    experience_type=ExperienceType.PRIORITY,
                    story_id=story.id,
                    cluster_id=cluster.id,
                    source_id=story.source_id,
                    context_features={
                        "features": features,
                        "label_source": label_source,
                    },
                    system_action=system_priority,
                    human_action=human_priority,
                    reward=_priority_reward(system_priority, human_priority),
                    used_in_training=False,
                )
            )
            created += 1

    if records:
        db.add_all(records)
        await db.commit()

    return created


async def _build_story_groups(
    db: AsyncSession,
    stories: list[Story],
    similarity_threshold: float = 0.95,
) -> list[OpsDuplicateGroup]:
    """
    Soft-dedup grouping within a cluster.
    """
    grouped = await group_stories_by_near_duplicate(
        db,
        stories,
        similarity_threshold=similarity_threshold,
    )

    groups: list[OpsDuplicateGroup] = []
    for group_stories in grouped:
        canonical = group_stories[0]
        duplicates = group_stories[1:]
        groups.append(
            OpsDuplicateGroup(
                canonical=OpsStoryItem.model_validate(canonical),
                duplicates=[OpsStoryItem.model_validate(d) for d in duplicates],
            )
        )

    return groups


async def _related_events(
    db: AsyncSession,
    cluster: StoryCluster,
    hours: int = 72,
    limit: int = 5,
) -> list[OpsRelatedEvent]:
    """
    Suggest related clusters using pgvector similarity via a representative story embedding.
    """
    # Pick most recent story with an embedding_vector
    rep = await db.execute(
        text(
            """
            SELECT s.id
            FROM stories s
            JOIN story_embeddings se ON se.story_id = s.id
            WHERE s.cluster_id = :cluster_id
              AND se.embedding_vector IS NOT NULL
            ORDER BY s.published_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        {"cluster_id": cluster.id},
    )
    row = rep.first()
    if not row:
        return []

    source_story_id: UUID = row[0]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Find similar stories to the representative story (no need to fetch vectors into Python)
    similar = await db.execute(
        text(
            """
            WITH source_embedding AS (
              SELECT embedding_vector
              FROM story_embeddings
              WHERE story_id = :source_story_id
            )
            SELECT
              se.story_id,
              1 - (se.embedding_vector <=> (SELECT embedding_vector FROM source_embedding)) AS similarity
            FROM story_embeddings se
            JOIN stories s ON s.id = se.story_id
            WHERE s.created_at >= :cutoff
              AND se.story_id != :source_story_id
              AND se.embedding_vector IS NOT NULL
            ORDER BY se.embedding_vector <=> (SELECT embedding_vector FROM source_embedding)
            LIMIT :limit
            """
        ),
        {"source_story_id": source_story_id, "cutoff": cutoff, "limit": 50},
    )

    by_cluster: dict[UUID, float] = {}
    rows = similar.fetchall()
    story_ids = [story_id for story_id, _ in rows]

    if not story_ids:
        return []

    # Map similar stories to clusters
    story_rows = await db.execute(
        select(Story.id, Story.cluster_id)
        .where(Story.id.in_(story_ids))
    )
    story_to_cluster = {sid: cid for sid, cid in story_rows.fetchall() if cid}

    # Aggregate max similarity per cluster
    for story_id, similarity in rows:
        cid = story_to_cluster.get(story_id)
        if not cid or cid == cluster.id:
            continue
        sim_val = float(similarity or 0.0)
        if sim_val <= 0.0:
            continue
        by_cluster[cid] = max(by_cluster.get(cid, 0.0), sim_val)

    if not by_cluster:
        return []

    # Fetch cluster metadata
    clusters = await db.execute(
        select(StoryCluster).where(StoryCluster.id.in_(list(by_cluster.keys())))
    )

    items: list[OpsRelatedEvent] = []
    for c in clusters.scalars().all():
        headline, _, category, severity = _display_fields(c)
        items.append(
            OpsRelatedEvent(
                cluster_id=c.id,
                headline=headline,
                category=category,
                severity=severity,
                similarity=float(by_cluster.get(c.id, 0.0)),
            )
        )

    items.sort(key=lambda x: x.similarity, reverse=True)
    return items[:limit]


# ============================================================
# Inbox
# ============================================================


@router.get("/events/inbox", response_model=OpsEventInboxResponse)
async def list_event_inbox(
    hours: int = Query(72, ge=1, le=168),
    limit: int = Query(50, ge=1, le=200),
    min_age_minutes: int = Query(30, ge=0, le=180),
    include_published: bool = Query(False),
    needs_review_only: bool = Query(False, description="Filter to only high-uncertainty items needing analyst review"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_analyst),
):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)

    query = (
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.first_published >= cutoff)
    )

    # Only prioritize the key domains, but also include high/critical even if misclassified.
    query = query.where(
        (StoryCluster.category.in_(list(PRIORITY_CATEGORIES)))
        | (StoryCluster.severity.in_(["high", "critical"]))
    )

    if not include_published:
        query = query.where(StoryCluster.is_published == False)  # noqa: E712

    # Respect workflow state (hide rejected by default)
    query = query.where(StoryCluster.workflow_status != WorkflowStatus.REJECTED.value)

    # 30–60 minute posture: only show events that have had time to confirm
    if min_age_minutes > 0:
        query = query.where(StoryCluster.first_published <= (now - timedelta(minutes=min_age_minutes)))

    query = query.order_by(StoryCluster.last_updated.desc().nullslast()).limit(limit)

    result = await db.execute(query)
    clusters = list(result.scalars().all())

    items: list[OpsEventInboxItem] = []
    for c in clusters:
        headline, summary, category, severity = _display_fields(c)

        age_min = _age_minutes(c.first_published, now)
        impact = _impact_score(category, severity, c.story_count, c.source_count, age_min)
        uncertainty, reasons = _uncertainty_score(c, age_min)
        ready = _ready_for_publish(c, min_age_minutes=min_age_minutes, now=now)

        items.append(
            OpsEventInboxItem(
                id=c.id,
                headline=headline,
                summary=summary,
                category=category,
                severity=severity,
                system_headline=c.headline,
                system_category=c.category,
                system_severity=c.severity,
                story_count=c.story_count,
                source_count=c.source_count,
                first_published=c.first_published,
                last_updated=c.last_updated,
                workflow_status=WorkflowStatus(c.workflow_status),
                is_published=c.is_published,
                published_at=c.published_at,
                verified_at=c.verified_at,
                age_minutes=age_min,
                impact_score=impact,
                uncertainty_score=uncertainty,
                reasons=reasons,
                ready_for_publish=ready,
            )
        )

    # Filter for high uncertainty if requested (human-in-loop workflow)
    if needs_review_only:
        items = [i for i in items if i.uncertainty_score >= 0.5]

    # Sort by uncertainty desc (review items first), then impact desc
    items.sort(key=lambda x: (x.uncertainty_score, x.impact_score), reverse=True)
    return OpsEventInboxResponse(items=items, total=len(items))


# ============================================================
# Event Detail
# ============================================================


@router.get("/events/{cluster_id}", response_model=OpsEventDetailResponse)
async def get_event_detail(
    cluster_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_analyst),
):
    result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == cluster_id)
    )
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    headline, summary, category, severity = _display_fields(cluster)

    story_groups = await _build_story_groups(db, cluster.stories)
    all_stories = [
        OpsStoryItem.model_validate(s)
        for s in sorted(
            cluster.stories,
            key=lambda x: x.published_at or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
    ]

    related = await _related_events(db, cluster)

    return OpsEventDetailResponse(
        id=cluster.id,
        headline=headline,
        summary=summary,
        category=category,
        severity=severity,
        system_headline=cluster.headline,
        system_summary=cluster.summary,
        system_category=cluster.category,
        system_severity=cluster.severity,
        story_count=cluster.story_count,
        source_count=cluster.source_count,
        first_published=cluster.first_published,
        last_updated=cluster.last_updated,
        workflow_status=WorkflowStatus(cluster.workflow_status),
        analyst_notes=cluster.analyst_notes,
        customer_brief=cluster.customer_brief,
        is_published=cluster.is_published,
        published_at=cluster.published_at,
        verified_at=cluster.verified_at,
        story_groups=story_groups,
        all_stories=all_stories,
        related_events=related,
    )


# ============================================================
# Workflow actions
# ============================================================


@router.patch("/events/{cluster_id}", response_model=OpsEventDetailResponse)
async def update_event(
    cluster_id: UUID,
    data: OpsUpdateEventRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    result = await db.execute(select(StoryCluster).where(StoryCluster.id == cluster_id))
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # Patch analyst fields
    if data.analyst_headline is not None:
        cluster.analyst_headline = data.analyst_headline
    if data.analyst_summary is not None:
        cluster.analyst_summary = data.analyst_summary
    if data.analyst_category is not None:
        cluster.analyst_category = data.analyst_category
    if data.analyst_severity is not None:
        cluster.analyst_severity = data.analyst_severity
    if data.analyst_notes is not None:
        cluster.analyst_notes = data.analyst_notes

    if data.workflow_status is not None:
        cluster.workflow_status = data.workflow_status.value
        if data.workflow_status == WorkflowStatus.VERIFIED:
            cluster.verified_by_id = current_user.id
            cluster.verified_at = datetime.now(timezone.utc)

    await db.commit()

    # Return detail view
    return await get_event_detail(cluster_id, db, current_user)


@router.post("/events/{cluster_id}/publish", response_model=OpsEventDetailResponse)
async def publish_event(
    cluster_id: UUID,
    data: OpsPublishEventRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
    min_age_minutes: int = Query(30, ge=0, le=180),
    record_feedback: bool = Query(True, description="Record training labels from analyst publish"),
):
    result = await db.execute(
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.id == cluster_id)
    )
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    now = datetime.now(timezone.utc)
    if min_age_minutes > 0 and cluster.first_published:
        if (now - cluster.first_published) < timedelta(minutes=min_age_minutes):
            raise HTTPException(
                status_code=400,
                detail=f"Event is too new to publish (min_age_minutes={min_age_minutes})",
            )

    headline = data.analyst_headline or cluster.analyst_headline or cluster.headline
    category = data.analyst_category or cluster.analyst_category or cluster.category
    severity = data.analyst_severity or cluster.analyst_severity or cluster.severity
    customer_brief = (
        data.customer_brief
        if data.customer_brief is not None
        else cluster.customer_brief or cluster.analyst_summary or cluster.summary
    )

    citations = await build_citations_from_cluster(db, cluster)
    try:
        await publish_cluster(
            db,
            cluster=cluster,
            publisher=current_user,
            headline=headline,
            category=category,
            severity=severity,
            customer_brief=customer_brief,
            citations=citations,
            change_note=None,
            enforce_policy=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if record_feedback:
        label_source = "analyst_publish"
        if any(
            x is not None
            for x in [
                data.analyst_category,
                data.analyst_severity,
                data.analyst_headline,
                data.analyst_summary,
                data.customer_brief,
            ]
        ):
            label_source = "analyst_publish_override"

        try:
            await _record_publish_experience(db, cluster, label_source=label_source)
        except Exception as e:
            logger.warning(f"Failed to record publish experience for {cluster.id}: {e}")

    return await get_event_detail(cluster_id, db, current_user)


@router.post("/events/{cluster_id}/reject", response_model=OpsEventDetailResponse)
async def reject_event(
    cluster_id: UUID,
    notes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    result = await db.execute(select(StoryCluster).where(StoryCluster.id == cluster_id))
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    cluster.workflow_status = WorkflowStatus.REJECTED.value
    if notes:
        cluster.analyst_notes = notes
    await db.commit()

    return await get_event_detail(cluster_id, db, current_user)


# ============================================================
# Source Management (Human-in-the-loop)
# ============================================================


@router.delete("/events/{cluster_id}/stories/{story_id}")
async def remove_story_from_cluster(
    cluster_id: UUID,
    story_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Remove a story from a cluster without deleting it.

    The story returns to the unclustered pool and can be added to another cluster.
    This also records clustering feedback for ML training.
    """
    # 1. Find the cluster
    cluster_result = await db.execute(
        select(StoryCluster).where(StoryCluster.id == cluster_id)
    )
    cluster = cluster_result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # 2. Find the story
    story_result = await db.execute(
        select(Story).where(Story.id == story_id)
    )
    story = story_result.scalar_one_or_none()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # 3. Verify story belongs to this cluster
    if story.cluster_id != cluster_id:
        raise HTTPException(
            status_code=400,
            detail="Story does not belong to this cluster"
        )

    # 4. Remove story from cluster (set cluster_id to NULL)
    story.cluster_id = None

    # 5. Update cluster stats
    cluster.story_count = max(0, (cluster.story_count or 1) - 1)

    # Recalculate source_count by querying remaining stories
    remaining_sources = await db.execute(
        select(func.count(func.distinct(Story.source_id)))
        .where(Story.cluster_id == cluster_id)
    )
    cluster.source_count = remaining_sources.scalar() or 0
    cluster.last_updated = datetime.now(timezone.utc)

    # 6. Record as clustering feedback for ML training
    try:
        feedback_record = ExperienceRecord(
            experience_type=ExperienceType.CLUSTERING,
            story_id=story_id,
            cluster_id=cluster_id,
            source_id=story.source_id,
            context_features={
                "action": "remove",
                "reason": "analyst_correction",
                "cluster_headline": cluster.headline,
                "story_title": story.title,
            },
            system_action="cluster_together",
            human_action="remove_from_cluster",
            reward=Decimal("-1.0"),  # Negative reward = system was wrong
            used_in_training=False,
        )
        db.add(feedback_record)
    except Exception as e:
        logger.warning(f"Failed to record clustering feedback: {e}")

    await db.commit()

    return {
        "status": "success",
        "message": f"Story removed from cluster",
        "story_id": str(story_id),
        "cluster_id": str(cluster_id),
        "new_story_count": cluster.story_count,
        "new_source_count": cluster.source_count,
    }


@router.post("/events/{cluster_id}/stories/{story_id}")
async def add_story_to_cluster(
    cluster_id: UUID,
    story_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Add an unclustered story to an existing cluster.

    This also records clustering feedback for ML training.
    """
    # 1. Find the cluster
    cluster_result = await db.execute(
        select(StoryCluster).where(StoryCluster.id == cluster_id)
    )
    cluster = cluster_result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # 2. Find the story
    story_result = await db.execute(
        select(Story).where(Story.id == story_id)
    )
    story = story_result.scalar_one_or_none()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # 3. Check if story is already in a cluster
    if story.cluster_id is not None:
        if story.cluster_id == cluster_id:
            raise HTTPException(
                status_code=400,
                detail="Story is already in this cluster"
            )
        raise HTTPException(
            status_code=400,
            detail="Story is already in another cluster. Remove it first."
        )

    # 4. Add story to cluster
    story.cluster_id = cluster_id

    # 5. Update cluster stats
    cluster.story_count = (cluster.story_count or 0) + 1

    # Recalculate source_count
    source_count_result = await db.execute(
        select(func.count(func.distinct(Story.source_id)))
        .where(Story.cluster_id == cluster_id)
    )
    cluster.source_count = source_count_result.scalar() or 0
    cluster.last_updated = datetime.now(timezone.utc)

    # 6. Record as clustering feedback for ML training
    try:
        feedback_record = ExperienceRecord(
            experience_type=ExperienceType.CLUSTERING,
            story_id=story_id,
            cluster_id=cluster_id,
            source_id=story.source_id,
            context_features={
                "action": "add",
                "reason": "analyst_correction",
                "cluster_headline": cluster.headline,
                "story_title": story.title,
            },
            system_action="not_clustered",
            human_action="add_to_cluster",
            reward=Decimal("1.0"),  # Positive reward = human added it
            used_in_training=False,
        )
        db.add(feedback_record)
    except Exception as e:
        logger.warning(f"Failed to record clustering feedback: {e}")

    await db.commit()

    return {
        "status": "success",
        "message": f"Story added to cluster",
        "story_id": str(story_id),
        "cluster_id": str(cluster_id),
        "new_story_count": cluster.story_count,
        "new_source_count": cluster.source_count,
    }


@router.get("/events/{cluster_id}/candidate-stories")
async def get_candidate_stories(
    cluster_id: UUID,
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """
    Get candidate stories that could be added to this cluster.

    Returns:
    - Similar unclustered stories (no cluster assigned)
    - Similar stories from related clusters that might be misclassified

    Uses embedding similarity to find candidates.
    """
    # 1. Find the cluster
    cluster_result = await db.execute(
        select(StoryCluster).where(StoryCluster.id == cluster_id)
    )
    cluster = cluster_result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # 2. Get representative story embedding from this cluster
    rep = await db.execute(
        text(
            """
            SELECT s.id
            FROM stories s
            JOIN story_embeddings se ON se.story_id = s.id
            WHERE s.cluster_id = :cluster_id
              AND se.embedding_vector IS NOT NULL
            ORDER BY s.published_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        {"cluster_id": cluster_id},
    )
    row = rep.first()
    if not row:
        return {"candidates": [], "message": "No embeddings found for cluster stories"}

    source_story_id: UUID = row[0]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=72)

    # 3. Find similar stories that are NOT in this cluster
    similar = await db.execute(
        text(
            """
            WITH source_embedding AS (
              SELECT embedding_vector
              FROM story_embeddings
              WHERE story_id = :source_story_id
            )
            SELECT
              s.id,
              s.title,
              s.url,
              s.source_id,
              s.source_name,
              s.published_at,
              s.cluster_id,
              1 - (se.embedding_vector <=> (SELECT embedding_vector FROM source_embedding)) AS similarity
            FROM story_embeddings se
            JOIN stories s ON s.id = se.story_id
            WHERE s.created_at >= :cutoff
              AND se.story_id != :source_story_id
              AND se.embedding_vector IS NOT NULL
              AND (s.cluster_id IS NULL OR s.cluster_id != :cluster_id)
            ORDER BY se.embedding_vector <=> (SELECT embedding_vector FROM source_embedding)
            LIMIT :limit
            """
        ),
        {"source_story_id": source_story_id, "cutoff": cutoff, "limit": limit, "cluster_id": cluster_id},
    )

    candidates = []
    for row in similar.fetchall():
        story_id, title, url, source_id, source_name, published_at, story_cluster_id, similarity = row
        sim_val = float(similarity or 0.0)
        if sim_val < 0.3:  # Skip very low similarity
            continue

        # Get cluster headline if story is in another cluster
        other_cluster_headline = None
        if story_cluster_id:
            other_cluster = await db.execute(
                select(StoryCluster.headline).where(StoryCluster.id == story_cluster_id)
            )
            other_cluster_headline = other_cluster.scalar()

        candidates.append({
            "story_id": str(story_id),
            "title": title,
            "url": url,
            "source_id": source_id,
            "source_name": source_name,
            "published_at": published_at.isoformat() if published_at else None,
            "similarity": round(sim_val * 100),  # Percentage
            "current_cluster_id": str(story_cluster_id) if story_cluster_id else None,
            "current_cluster_headline": other_cluster_headline,
            "is_unclustered": story_cluster_id is None,
        })

    # Sort by similarity descending
    candidates.sort(key=lambda x: x["similarity"], reverse=True)

    return {
        "cluster_id": str(cluster_id),
        "cluster_headline": cluster.headline,
        "candidates": candidates,
    }
