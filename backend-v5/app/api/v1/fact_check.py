"""Fact-check API — user-requested story verification.

Consumer endpoints:
  POST /fact-check/request/{story_id}  — Request a fact-check (1 per user per story)
  GET  /fact-check/results             — Recent fact-check results
  GET  /fact-check/results/{story_id}  — Result for a specific story
  GET  /fact-check/status/{story_id}   — Request count + whether already checked

Dev endpoints:
  GET  /fact-check/pending             — Top stories awaiting fact-check (for CLI agent)
  POST /fact-check/ingest              — Ingest fact-check results from CLI agent
"""

from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user, require_dev
from app.models.user import User
from app.models.story import Story
from app.models.fact_check import FactCheckRequest, FactCheckResult
from app.models.fact_check_review import FactCheckReview
from app.services.editorial_control_service import EditorialControlService

router = APIRouter(prefix="/fact-check", tags=["fact-check"])


# ── Schemas ──

class FactCheckStatusResponse(BaseModel):
    story_id: str
    request_count: int
    already_checked: bool
    user_requested: bool  # Whether current user already requested


class FactCheckResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    story_id: str
    story_title: Optional[str] = None
    story_source: Optional[str] = None
    story_url: Optional[str] = None
    verdict: str
    verdict_summary: str
    confidence: float
    claims_analyzed: Optional[list] = None
    sources_checked: Optional[list] = None
    key_finding: Optional[str] = None
    context: Optional[str] = None
    request_count: int
    checked_at: datetime


class FactCheckIngestItem(BaseModel):
    story_id: str
    verdict: str
    verdict_summary: str
    confidence: float = 0.5
    claims_analyzed: Optional[list] = None
    sources_checked: Optional[list] = None
    key_finding: Optional[str] = None
    context: Optional[str] = None
    model_used: Optional[str] = None


class FactCheckIngestRequest(BaseModel):
    results: list[FactCheckIngestItem]


class PendingStoryItem(BaseModel):
    story_id: str
    title: str
    url: Optional[str] = None
    source_name: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    request_count: int
    first_requested: datetime


def _resolved_fact_check_response(
    result: FactCheckResult,
    *,
    title: Optional[str],
    source_name: Optional[str],
    url: Optional[str],
) -> Optional[FactCheckResultResponse]:
    review = result.review
    if review and review.workflow_status in {"rejected", "suppressed"}:
        return None
    if review and review.workflow_status != "approved":
        return None
    return FactCheckResultResponse(
        id=str(result.id),
        story_id=str(result.story_id),
        story_title=title,
        story_source=source_name,
        story_url=url,
        verdict=(review.final_verdict if review and review.final_verdict else result.verdict),
        verdict_summary=(
            review.final_verdict_summary if review and review.final_verdict_summary else result.verdict_summary
        ),
        confidence=(
            review.final_confidence if review and review.final_confidence is not None else result.confidence
        ),
        claims_analyzed=result.claims_analyzed,
        sources_checked=result.sources_checked,
        key_finding=(review.final_key_finding if review and review.final_key_finding else result.key_finding),
        context=(review.final_context if review and review.final_context else result.context),
        request_count=result.request_count,
        checked_at=result.checked_at,
    )


# ── Consumer Endpoints ──

@router.post("/request/{story_id}")
async def request_fact_check(
    story_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Request a fact-check for a story. One request per user per story."""
    # Verify story exists
    story = await db.get(Story, story_id)
    if not story:
        raise HTTPException(404, "Story not found")

    # Check if already requested by this user
    existing = await db.execute(
        select(FactCheckRequest).where(
            and_(
                FactCheckRequest.story_id == story_id,
                FactCheckRequest.requested_by_id == user.id,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "You already requested a fact-check for this story")

    # Create request
    req = FactCheckRequest(story_id=story_id, requested_by_id=user.id)
    db.add(req)
    await db.commit()

    # Get total count
    count_result = await db.execute(
        select(func.count()).select_from(FactCheckRequest).where(
            FactCheckRequest.story_id == story_id
        )
    )
    total = count_result.scalar() or 1

    return {"status": "requested", "request_count": total}


@router.get("/status/{story_id}")
async def get_fact_check_status(
    story_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get fact-check status for a story (request count, checked or not)."""
    # Count requests
    count_result = await db.execute(
        select(func.count()).select_from(FactCheckRequest).where(
            FactCheckRequest.story_id == story_id
        )
    )
    request_count = count_result.scalar() or 0

    # Check if already fact-checked
    result = await db.execute(
        select(FactCheckResult)
        .options(selectinload(FactCheckResult.review))
        .where(FactCheckResult.story_id == story_id)
    )
    resolved = result.scalar_one_or_none()
    already_checked = bool(
        resolved and (resolved.review is None or resolved.review.workflow_status == "approved")
    )

    # Check if current user already requested
    user_req = await db.execute(
        select(FactCheckRequest.id).where(
            and_(
                FactCheckRequest.story_id == story_id,
                FactCheckRequest.requested_by_id == user.id,
            )
        )
    )
    user_requested = user_req.scalar_one_or_none() is not None

    return FactCheckStatusResponse(
        story_id=str(story_id),
        request_count=request_count,
        already_checked=already_checked,
        user_requested=user_requested,
    )


@router.get("/results", response_model=list[FactCheckResultResponse])
async def get_fact_check_results(
    limit: int = Query(20, ge=1, le=50),
    hours: int = Query(168, ge=1, le=720),  # Default: last week
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get recent fact-check results."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(FactCheckResult, Story.title, Story.source_name, Story.url)
        .join(Story, FactCheckResult.story_id == Story.id)
        .options(selectinload(FactCheckResult.review))
        .where(FactCheckResult.checked_at >= cutoff)
        .order_by(FactCheckResult.checked_at.desc())
        .limit(limit)
    )
    rows = result.all()

    items = [
        _resolved_fact_check_response(r, title=title, source_name=source_name, url=url)
        for r, title, source_name, url in rows
    ]
    return [item for item in items if item is not None]


@router.get("/results/{story_id}", response_model=Optional[FactCheckResultResponse])
async def get_fact_check_result_for_story(
    story_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get fact-check result for a specific story."""
    result = await db.execute(
        select(FactCheckResult, Story.title, Story.source_name, Story.url)
        .join(Story, FactCheckResult.story_id == Story.id)
        .options(selectinload(FactCheckResult.review))
        .where(FactCheckResult.story_id == story_id)
    )
    row = result.first()
    if not row:
        return None

    r, title, source_name, url = row
    return _resolved_fact_check_response(r, title=title, source_name=source_name, url=url)


# ── Dev Endpoints (for CLI agent) ──

@router.get("/pending")
async def get_pending_fact_checks(
    limit: int = Query(15, ge=1, le=30),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get top stories awaiting fact-check, ranked by request count then FCFS.

    Excludes stories that already have a FactCheckResult (no double-dipping).
    """
    control_service = EditorialControlService(db)
    if not await control_service.is_enabled("fact_check_generation"):
        return []

    result = await db.execute(
        select(
            Story.id.label("story_id"),
            Story.title,
            Story.url,
            Story.source_name,
            Story.summary,
            Story.content,
            func.coalesce(func.count(FactCheckRequest.id), 0).label("request_count"),
            func.coalesce(
                func.min(FactCheckRequest.created_at),
                FactCheckResult.checked_at,
                Story.published_at,
                Story.created_at,
            ).label("first_requested"),
        )
        .select_from(Story)
        .outerjoin(FactCheckRequest, FactCheckRequest.story_id == Story.id)
        .outerjoin(FactCheckResult, FactCheckResult.story_id == Story.id)
        .outerjoin(FactCheckReview, FactCheckReview.fact_check_result_id == FactCheckResult.id)
        .where(
            or_(
                FactCheckResult.id.is_(None),
                FactCheckReview.needs_rerun.is_(True),
            )
        )
        .group_by(
            Story.id,
            Story.title,
            Story.url,
            Story.source_name,
            Story.summary,
            Story.content,
            FactCheckResult.checked_at,
        )
        .order_by(
            func.coalesce(func.count(FactCheckRequest.id), 0).desc(),
            func.coalesce(func.min(FactCheckRequest.created_at), FactCheckResult.checked_at).asc(),
        )
        .limit(limit)
    )
    rows = result.all()

    return [
        PendingStoryItem(
            story_id=str(row.story_id),
            title=row.title or "Untitled",
            url=row.url,
            source_name=row.source_name,
            summary=row.summary,
            content=(row.content or "")[:3000],  # Truncate for CLI
            request_count=row.request_count,
            first_requested=row.first_requested,
        )
        for row in rows
    ]


@router.post("/ingest")
async def ingest_fact_check_results(
    payload: FactCheckIngestRequest,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Ingest fact-check results from the local CLI agent. DEV only."""
    control_service = EditorialControlService(db)
    await control_service.mark_run_started("fact_check_generation")
    ingested = 0
    skipped = 0

    try:
        for item in payload.results:
            story_id = UUID(item.story_id)

            existing_result = (
                await db.execute(
                    select(FactCheckResult)
                    .options(selectinload(FactCheckResult.review))
                    .where(FactCheckResult.story_id == story_id)
                )
            ).scalar_one_or_none()

            count_result = await db.execute(
                select(func.count()).select_from(FactCheckRequest).where(
                    FactCheckRequest.story_id == story_id
                )
            )
            request_count = count_result.scalar() or 1

            if existing_result and not (existing_result.review and existing_result.review.needs_rerun):
                skipped += 1
                continue

            if existing_result:
                existing_result.verdict = item.verdict
                existing_result.verdict_summary = item.verdict_summary
                existing_result.confidence = item.confidence
                existing_result.claims_analyzed = item.claims_analyzed
                existing_result.sources_checked = item.sources_checked
                existing_result.key_finding = item.key_finding
                existing_result.context = item.context
                existing_result.request_count = request_count
                existing_result.model_used = item.model_used
                existing_result.checked_at = datetime.now(timezone.utc)
                review = existing_result.review or FactCheckReview(fact_check_result_id=existing_result.id)
                if existing_result.review is None:
                    db.add(review)
                review.workflow_status = "pending_review"
                review.needs_rerun = False
                review.rerun_requested_at = None
                review.rerun_requested_by_id = None
                review.approved_at = None
                review.approved_by_id = None
                review.rejected_at = None
                review.rejected_by_id = None
                review.rejection_reason = None
            else:
                result = FactCheckResult(
                    story_id=story_id,
                    verdict=item.verdict,
                    verdict_summary=item.verdict_summary,
                    confidence=item.confidence,
                    claims_analyzed=item.claims_analyzed,
                    sources_checked=item.sources_checked,
                    key_finding=item.key_finding,
                    context=item.context,
                    request_count=request_count,
                    model_used=item.model_used,
                )
                db.add(result)
                await db.flush()
                db.add(
                    FactCheckReview(
                        fact_check_result_id=result.id,
                        workflow_status="pending_review",
                    )
                )
            ingested += 1

        await db.commit()
        await control_service.mark_run_finished("fact_check_generation", success=True)
    except Exception as exc:
        await db.rollback()
        await control_service.mark_run_finished("fact_check_generation", success=False, error=str(exc))
        raise
    return {"ingested": ingested, "skipped": skipped}
