"""API endpoints for tactical enrichment data (Tactical Map Agent output)."""
import logging
from typing import Optional
from uuid import UUID
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.api.deps import get_db, require_dev
from app.models.tactical_enrichment import TacticalEnrichment

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tactical", tags=["tactical"])


# ── Response schemas ──


class TacticalEnrichmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    story_id: UUID
    tactical_type: str
    tactical_subtype: Optional[str] = None
    municipality: Optional[str] = None
    ward: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    tactical_context: Optional[str] = None
    actors: list = []
    confidence: str = "MEDIUM"
    enriched_at: Optional[datetime] = None


class TacticalIngestResponse(BaseModel):
    ingested: int = 0
    skipped: int = 0
    total: int = 0


# ── Ingest schemas ──


class TacticalEnrichmentIngest(BaseModel):
    story_id: UUID
    tactical_type: str
    tactical_subtype: Optional[str] = None
    municipality: Optional[str] = None
    ward: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    tactical_context: Optional[str] = None
    actors: list = []
    confidence: str = "MEDIUM"


class TacticalBatchIngest(BaseModel):
    enrichments: list[TacticalEnrichmentIngest] = []


# ── Endpoints ──


@router.get("/latest", response_model=list[TacticalEnrichmentResponse])
async def get_latest_tactical(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Get recent tactical enrichments for debugging."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        result = await db.execute(
            select(TacticalEnrichment)
            .where(TacticalEnrichment.enriched_at >= cutoff)
            .order_by(TacticalEnrichment.enriched_at.desc())
            .limit(200)
        )
        enrichments = result.scalars().all()
        return [
            TacticalEnrichmentResponse(
                story_id=e.story_id,
                tactical_type=e.tactical_type,
                tactical_subtype=e.tactical_subtype,
                municipality=e.municipality,
                ward=e.ward,
                latitude=e.latitude,
                longitude=e.longitude,
                tactical_context=e.tactical_context,
                actors=e.actors or [],
                confidence=e.confidence,
                enriched_at=e.enriched_at,
            )
            for e in enrichments
        ]
    except (ProgrammingError, OperationalError):
        logger.warning("tactical_enrichments table not found — run migration 061")
        return []


@router.post("/enriched-ids")
async def get_enriched_story_ids(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_dev),
):
    """Given a list of story IDs, return which ones already have tactical enrichments.

    Used by local agent to skip already-classified stories before calling Claude.
    """
    story_ids = payload.get("story_ids", [])
    if not story_ids:
        return {"enriched_ids": []}

    # Convert to UUIDs
    from uuid import UUID as _UUID
    uuids = []
    for sid in story_ids:
        try:
            uuids.append(_UUID(str(sid)))
        except ValueError:
            continue

    result = await db.execute(
        select(TacticalEnrichment.story_id).where(
            TacticalEnrichment.story_id.in_(uuids)
        )
    )
    enriched = [str(row[0]) for row in result.fetchall()]
    return {"enriched_ids": enriched}


@router.post("/ingest", response_model=TacticalIngestResponse)
async def ingest_tactical(
    payload: TacticalBatchIngest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_dev),
):
    """Ingest tactical enrichment results from local agent (dev role required).

    Skips stories that already have enrichments (idempotent).
    """
    ingested = 0
    skipped = 0

    # Get already-enriched story IDs in one query
    story_ids = [e.story_id for e in payload.enrichments]
    if story_ids:
        existing_result = await db.execute(
            select(TacticalEnrichment.story_id).where(
                TacticalEnrichment.story_id.in_(story_ids)
            )
        )
        existing_ids = {row[0] for row in existing_result.fetchall()}
    else:
        existing_ids = set()

    for item in payload.enrichments:
        if item.story_id in existing_ids:
            skipped += 1
            continue

        enrichment = TacticalEnrichment(
            story_id=item.story_id,
            tactical_type=item.tactical_type,
            tactical_subtype=item.tactical_subtype,
            municipality=item.municipality,
            ward=item.ward,
            latitude=item.latitude,
            longitude=item.longitude,
            tactical_context=item.tactical_context,
            actors=item.actors,
            confidence=item.confidence,
            model_used="haiku",
        )
        db.add(enrichment)
        ingested += 1

    if ingested:
        await db.commit()

    logger.info("Tactical ingest: %d ingested, %d skipped", ingested, skipped)

    return TacticalIngestResponse(
        ingested=ingested,
        skipped=skipped,
        total=len(payload.enrichments),
    )
