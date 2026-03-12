"""Unified Search API - Single endpoint that fans out parallel queries.

Searches candidates, constituencies, entities, and stories simultaneously.
Used by the OmniSearch (Cmd+K) frontend component.
"""
import logging
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_, func, case
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.election import Candidate, Constituency, Election
from app.models.story import Story
from app.models.political_entity import PoliticalEntity
from app.models.announcement import GovtAnnouncement
from app.models.parliament import MPPerformance

router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger(__name__)


def _is_missing_relation_error(exc: Exception) -> bool:
    """
    Detect missing-table errors (common in dev when migrations/seeds haven't run).
    SQLSTATE 42P01 = undefined_table.
    """
    orig = getattr(exc, "orig", None)
    sqlstate = getattr(orig, "sqlstate", None)
    if sqlstate == "42P01":
        return True
    message = str(orig or exc).lower()
    return "relation" in message and "does not exist" in message


async def _search_candidates(
    db: AsyncSession,
    query: str,
    pattern: str,
    election_year: Optional[int],
    limit: int,
) -> Dict[str, Any]:
    """Search candidates by name, party, or aliases.

    Prioritizes the latest election (2082) to avoid duplicates.
    If no election_year is specified, searches the latest election first,
    then backfills from older elections for people not already found.
    """
    # Find the latest election year
    latest_result = await db.execute(
        select(Election.year_bs).order_by(Election.year_bs.desc()).limit(1)
    )
    latest_year = latest_result.scalar() or 2082

    target_year = election_year or latest_year

    name_filter = or_(
        Candidate.name_en.ilike(pattern),
        Candidate.name_ne.ilike(pattern),
        Candidate.name_en_roman.ilike(pattern),
        Candidate.party.ilike(pattern),
    )

    # Search in target (latest) election first
    stmt = (
        select(Candidate, Constituency.name_en.label("constituency_name"),
               Constituency.constituency_code, Constituency.district,
               Constituency.status.label("constituency_status"),
               Election.year_bs.label("election_year"))
        .join(Constituency, Candidate.constituency_id == Constituency.id)
        .join(Election, Candidate.election_id == Election.id)
        .where(name_filter, Election.year_bs == target_year)
        .order_by(
            case(
                (func.lower(Candidate.name_en) == query.lower(), 1000),
                else_=0,
            ).desc(),
            case(
                (Candidate.name_en.ilike(f"{query}%"), 500),
                else_=0,
            ).desc(),
            Candidate.is_winner.desc(),
            Candidate.votes.desc(),
        )
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    items = []
    seen_names = set()
    for row in rows:
        candidate = row[0]
        # Track by normalized name for dedup
        norm_key = (candidate.name_en or "").strip().lower()
        seen_names.add(norm_key)
        if candidate.name_en_roman:
            seen_names.add(candidate.name_en_roman.strip().lower())
        items.append(_candidate_to_dict(candidate, row))

    # Backfill from older elections if we haven't filled the limit
    if not election_year and len(items) < limit:
        backfill_stmt = (
            select(Candidate, Constituency.name_en.label("constituency_name"),
                   Constituency.constituency_code, Constituency.district,
                   Constituency.status.label("constituency_status"),
                   Election.year_bs.label("election_year"))
            .join(Constituency, Candidate.constituency_id == Constituency.id)
            .join(Election, Candidate.election_id == Election.id)
            .where(name_filter, Election.year_bs != target_year)
            .order_by(
                Election.year_bs.desc(),
                Candidate.is_winner.desc(),
                Candidate.votes.desc(),
            )
            .limit(limit * 2)  # fetch extra for dedup filtering
        )
        backfill_result = await db.execute(backfill_stmt)
        for row in backfill_result.all():
            if len(items) >= limit:
                break
            candidate = row[0]
            norm_key = (candidate.name_en or "").strip().lower()
            roman_key = (candidate.name_en_roman or "").strip().lower()
            # Skip if already seen from the latest election
            if norm_key in seen_names or (roman_key and roman_key in seen_names):
                continue
            seen_names.add(norm_key)
            if roman_key:
                seen_names.add(roman_key)
            items.append(_candidate_to_dict(candidate, row))

    return {"items": items, "total": len(items)}


def _candidate_to_dict(candidate, row) -> dict:
    """Convert a candidate DB row to API dict."""
    return {
        "id": str(candidate.id),
        "external_id": candidate.external_id,
        "name_en": candidate.name_en,
        "name_ne": candidate.name_ne,
        "name_en_roman": candidate.name_en_roman,
        "party": candidate.party,
        "party_ne": candidate.party_ne,
        "votes": candidate.votes,
        "vote_pct": candidate.vote_pct,
        "rank": candidate.rank,
        "is_winner": candidate.is_winner,
        "photo_url": candidate.photo_url,
        "constituency_name": row.constituency_name,
        "constituency_code": row.constituency_code,
        "district": row.district,
        "constituency_status": row.constituency_status,
        "election_year": row.election_year,
    }


async def _search_constituencies(
    db: AsyncSession,
    query: str,
    pattern: str,
    election_year: Optional[int],
    limit: int,
) -> Dict[str, Any]:
    """Search constituencies by name, district, or code. Defaults to latest election."""
    # Default to latest election to avoid duplicates across years
    if not election_year:
        latest_result = await db.execute(
            select(Election.year_bs).order_by(Election.year_bs.desc()).limit(1)
        )
        election_year = latest_result.scalar() or 2082

    stmt = (
        select(Constituency)
        .join(Election, Constituency.election_id == Election.id)
        .where(
            Election.year_bs == election_year,
            or_(
                Constituency.name_en.ilike(pattern),
                Constituency.name_ne.ilike(pattern),
                Constituency.district.ilike(pattern),
                Constituency.constituency_code.ilike(pattern),
            )
        )
    )

    stmt = stmt.order_by(
        case(
            (func.lower(Constituency.name_en) == query.lower(), 1000),
            else_=0,
        ).desc(),
        case(
            (Constituency.name_en.ilike(f"{query}%"), 500),
            else_=0,
        ).desc(),
        Constituency.constituency_code.asc(),
    ).limit(limit)

    result = await db.execute(stmt)
    constituencies = result.scalars().all()

    items = []
    for c in constituencies:
        items.append({
            "id": str(c.id),
            "constituency_code": c.constituency_code,
            "name_en": c.name_en,
            "name_ne": c.name_ne,
            "district": c.district,
            "province": c.province,
            "province_id": c.province_id,
            "status": c.status,
            "turnout_pct": c.turnout_pct,
            "winner_party": c.winner_party,
            "winner_votes": c.winner_votes,
            "winner_margin": c.winner_margin,
            "total_votes_cast": c.total_votes_cast,
        })

    return {"items": items, "total": len(items)}


async def _search_entities(
    db: AsyncSession,
    query: str,
    pattern: str,
    limit: int,
) -> Dict[str, Any]:
    """Search political entities (people, parties, orgs)."""
    stmt = (
        select(PoliticalEntity)
        .where(
            PoliticalEntity.is_active == True,
            or_(
                PoliticalEntity.name_en.ilike(pattern),
                PoliticalEntity.name_ne.ilike(pattern),
                PoliticalEntity.canonical_id.ilike(pattern),
                PoliticalEntity.party.ilike(pattern),
            ),
        )
        .order_by(
            case(
                (func.lower(PoliticalEntity.name_en) == query.lower(), 1000),
                (PoliticalEntity.canonical_id == query.lower(), 1000),
                else_=0,
            ).desc(),
            case(
                (PoliticalEntity.name_en.ilike(f"{query}%"), 500),
                else_=0,
            ).desc(),
            PoliticalEntity.mentions_24h.desc(),
            PoliticalEntity.total_mentions.desc(),
        )
        .limit(limit)
    )

    result = await db.execute(stmt)
    entities = result.scalars().all()

    items = []
    for e in entities:
        items.append({
            "id": str(e.id),
            "canonical_id": e.canonical_id,
            "name_en": e.name_en,
            "name_ne": e.name_ne,
            "entity_type": e.entity_type.value,
            "party": e.party,
            "role": e.role,
            "image_url": e.image_url,
            "total_mentions": e.total_mentions,
            "mentions_24h": e.mentions_24h,
            "trend": e.trend.value,
        })

    return {"items": items, "total": len(items)}


async def _search_stories(
    db: AsyncSession,
    pattern: str,
    limit: int,
) -> Dict[str, Any]:
    """Search stories by title or summary."""
    stmt = (
        select(Story)
        .where(
            or_(
                Story.title.ilike(pattern),
                Story.summary.ilike(pattern),
            )
        )
        .order_by(Story.published_at.desc().nullslast())
        .limit(limit)
    )

    result = await db.execute(stmt)
    stories = result.scalars().all()

    items = []
    for s in stories:
        items.append({
            "id": str(s.id),
            "title": s.title,
            "summary": (s.summary or "")[:200],
            "source_name": s.source_name,
            "category": s.category,
            "severity": s.severity,
            "published_at": s.published_at.isoformat() if s.published_at else None,
            "url": s.url,
        })

    return {"items": items, "total": len(items)}


async def _search_announcements(
    db: AsyncSession,
    query: str,
    pattern: str,
    limit: int,
) -> Dict[str, Any]:
    """Search government announcements by title or issuing office."""
    stmt = (
        select(GovtAnnouncement)
        .where(
            or_(
                GovtAnnouncement.title.ilike(pattern),
                GovtAnnouncement.source_name.ilike(pattern),
                GovtAnnouncement.source.ilike(pattern),
            )
        )
        .order_by(
            case(
                (func.lower(GovtAnnouncement.title) == query.lower(), 1000),
                else_=0,
            ).desc(),
            case(
                (GovtAnnouncement.title.ilike(f"{query}%"), 500),
                else_=0,
            ).desc(),
            func.coalesce(
                GovtAnnouncement.published_at,
                GovtAnnouncement.date_ad,
                GovtAnnouncement.fetched_at,
            ).desc().nullslast(),
        )
        .limit(limit)
    )

    result = await db.execute(stmt)
    announcements = result.scalars().all()

    items = []
    for a in announcements:
        items.append({
            "id": str(a.id),
            "external_id": a.external_id,
            "source": a.source,
            "source_name": a.source_name,
            "title": a.title,
            "url": a.url,
            "category": a.category,
            "date_bs": a.date_bs,
            "date_ad": a.date_ad.isoformat() if a.date_ad else None,
            "published_at": a.published_at.isoformat() if a.published_at else None,
            "fetched_at": a.fetched_at.isoformat() if a.fetched_at else None,
            "has_attachments": a.has_attachments,
            "is_important": a.is_important,
            "is_read": a.is_read,
        })

    return {"items": items, "total": len(items)}


async def _search_mps(
    db: AsyncSession,
    query: str,
    pattern: str,
    limit: int,
) -> Dict[str, Any]:
    """Search parliament members by name, party, or constituency."""
    stmt = (
        select(MPPerformance)
        .where(
            or_(
                MPPerformance.name_en.ilike(pattern),
                MPPerformance.name_ne.ilike(pattern),
                MPPerformance.party.ilike(pattern),
                MPPerformance.constituency.ilike(pattern),
            )
        )
        .order_by(
            case(
                (func.lower(MPPerformance.name_en) == query.lower(), 1000),
                else_=0,
            ).desc(),
            case(
                (MPPerformance.name_en.ilike(f"{query}%"), 500),
                else_=0,
            ).desc(),
            MPPerformance.performance_score.desc().nullslast(),
        )
        .limit(limit)
    )

    result = await db.execute(stmt)
    mps = result.scalars().all()

    items = []
    for mp in mps:
        items.append({
            "id": str(mp.id),
            "mp_id": mp.mp_id,
            "name_en": mp.name_en,
            "name_ne": mp.name_ne,
            "party": mp.party,
            "constituency": mp.constituency,
            "chamber": mp.chamber,
            "election_type": mp.election_type,
            "photo_url": mp.photo_url,
            "performance_score": mp.performance_score,
            "performance_tier": mp.performance_tier,
            "is_minister": mp.is_minister,
            "ministry_portfolio": mp.ministry_portfolio,
        })

    return {"items": items, "total": len(items)}


@router.get("/unified")
async def unified_search(
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    limit: int = Query(6, ge=1, le=20, description="Max results per category"),
    election_year: Optional[int] = Query(None, description="Filter election data by BS year"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Unified search across candidates, constituencies, entities, and stories.

    Runs sequentially on a single async session (SQLAlchemy async sessions
    don't support concurrent coroutines on the same connection).
    """
    query = q.strip()
    pattern = f"%{query}%"

    async def safe_call(fn, category: str, *args):
        try:
            return await fn(*args)
        except ProgrammingError as e:
            if _is_missing_relation_error(e):
                # Clear failed transaction state so subsequent queries can run.
                try:
                    await db.rollback()
                except Exception:
                    pass
                logger.warning("Unified search category '%s' unavailable (missing tables).", category)
                return {"items": [], "total": 0}
            raise

    candidates = await safe_call(_search_candidates, "candidates", db, query, pattern, election_year, limit)
    constituencies = await safe_call(_search_constituencies, "constituencies", db, query, pattern, election_year, limit)
    entities = await safe_call(_search_entities, "entities", db, query, pattern, limit)
    stories = await safe_call(_search_stories, "stories", db, pattern, limit)
    announcements = await safe_call(_search_announcements, "announcements", db, query, pattern, limit)
    mps = await safe_call(_search_mps, "mps", db, query, pattern, limit)

    total = (
        candidates["total"]
        + constituencies["total"]
        + entities["total"]
        + stories["total"]
        + announcements["total"]
        + mps["total"]
    )

    return {
        "query": query,
        "total": total,
        "categories": {
            "candidates": candidates,
            "constituencies": constituencies,
            "entities": entities,
            "stories": stories,
            "announcements": announcements,
            "mps": mps,
        },
    }
