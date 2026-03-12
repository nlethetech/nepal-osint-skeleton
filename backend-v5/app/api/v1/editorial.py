"""Developer editorial control plane endpoints."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_dev
from app.config import get_settings
from app.core.database import AsyncSessionLocal
from app.models.admin_audit import AdminAuditLog
from app.models.fact_check import FactCheckResult
from app.models.fact_check_review import FactCheckReview
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.story_narrative import StoryNarrative, StoryNarrativeCluster
from app.models.user import User
from app.services.editorial_control_service import (
    AUTOMATION_DEFS,
    EditorialControlService,
    serialize_control,
)
from app.services.story_products_service import DevelopingStoriesService, StoryTrackerService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/editorial", tags=["editorial"])


class ReasonBody(BaseModel):
    reason: str = Field(..., min_length=3, max_length=1000)


class FactCheckPatchBody(BaseModel):
    final_verdict: Optional[str] = None
    final_verdict_summary: Optional[str] = None
    final_confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    final_key_finding: Optional[str] = None
    final_context: Optional[str] = None
    override_notes: Optional[str] = None
    reason: str = Field(..., min_length=3, max_length=1000)


class FactCheckRejectBody(BaseModel):
    reason: str = Field(..., min_length=3, max_length=1000)
    workflow_status: str = Field(default="rejected", pattern="^(rejected|suppressed)$")


class NarrativePatchBody(BaseModel):
    label: Optional[str] = None
    thesis: Optional[str] = None
    review_notes: Optional[str] = None
    workflow_status: Optional[str] = Field(default=None, pattern="^(approved|monitoring|rejected)$")
    reason: str = Field(..., min_length=3, max_length=1000)


class ClusterPatchBody(BaseModel):
    analyst_headline: Optional[str] = None
    analyst_summary: Optional[str] = None
    analyst_category: Optional[str] = None
    analyst_severity: Optional[str] = None
    analyst_notes: Optional[str] = None
    workflow_status: Optional[str] = Field(default=None, pattern="^(unreviewed|monitoring|verified|published|rejected)$")
    reason: str = Field(..., min_length=3, max_length=1000)


async def _run_analyst_agent_job(hours: int = 4) -> None:
    from app.services.analyst_agent.agent import NaradaAnalystAgent

    async with AsyncSessionLocal() as db:
        control_service = EditorialControlService(db)
        await control_service.mark_run_started("analyst_brief_generation")
        try:
            agent = NaradaAnalystAgent(db=db, hours=hours)
            await agent.run()
            await control_service.mark_run_finished("analyst_brief_generation", success=True)
        except Exception as exc:
            await control_service.mark_run_finished("analyst_brief_generation", success=False, error=str(exc))
            logger.exception("Analyst brief rerun failed: %s", exc)


async def _run_story_tracker_refresh(hours: int = 72, limit: int = 20) -> None:
    async with AsyncSessionLocal() as db:
        control_service = EditorialControlService(db)
        await control_service.mark_run_started("story_tracker_refresh")
        try:
            service = StoryTrackerService(db)
            await service.refresh_narratives(hours=hours, limit=limit, force=True)
            await control_service.mark_run_finished("story_tracker_refresh", success=True)
        except Exception as exc:
            await control_service.mark_run_finished("story_tracker_refresh", success=False, error=str(exc))
            logger.exception("Story tracker refresh failed: %s", exc)


async def _run_haiku_borderline_review() -> None:
    from app.tasks.scheduler import review_borderline_stories

    async with AsyncSessionLocal() as db:
        control_service = EditorialControlService(db)
        await control_service.mark_run_started("haiku_relevance")
        try:
            await review_borderline_stories()
            await control_service.mark_run_finished("haiku_relevance", success=True)
        except Exception as exc:
            await control_service.mark_run_finished("haiku_relevance", success=False, error=str(exc))
            logger.exception("Haiku relevance rerun failed: %s", exc)


def _client_meta(request: Request) -> tuple[Optional[str], Optional[str]]:
    return (
        request.client.host if request.client else None,
        request.headers.get("user-agent"),
    )


async def _audit(
    db: AsyncSession,
    *,
    user: User,
    request: Request,
    action: str,
    target_type: str,
    target_id: str,
    details: dict,
) -> None:
    ip_address, user_agent = _client_meta(request)
    entry = AdminAuditLog(
        user_id=user.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(entry)
    await db.commit()


def _fact_check_payload(result: FactCheckResult, story: Story | None = None) -> dict:
    review = result.review
    effective = {
        "verdict": review.final_verdict if review and review.workflow_status == "approved" and review.final_verdict else result.verdict,
        "verdict_summary": review.final_verdict_summary if review and review.workflow_status == "approved" and review.final_verdict_summary else result.verdict_summary,
        "confidence": review.final_confidence if review and review.workflow_status == "approved" and review.final_confidence is not None else result.confidence,
        "key_finding": review.final_key_finding if review and review.workflow_status == "approved" and review.final_key_finding else result.key_finding,
        "context": review.final_context if review and review.workflow_status == "approved" and review.final_context else result.context,
    }
    return {
        "story_id": str(result.story_id),
        "fact_check_result_id": str(result.id),
        "title": story.title if story else None,
        "source_name": story.source_name if story else None,
        "url": story.url if story else None,
        "request_count": result.request_count,
        "checked_at": result.checked_at,
        "raw": {
            "verdict": result.verdict,
            "verdict_summary": result.verdict_summary,
            "confidence": result.confidence,
            "key_finding": result.key_finding,
            "context": result.context,
            "claims_analyzed": result.claims_analyzed,
            "sources_checked": result.sources_checked,
        },
        "review": {
            "workflow_status": review.workflow_status if review else "unreviewed",
            "final_verdict": review.final_verdict if review else None,
            "final_verdict_summary": review.final_verdict_summary if review else None,
            "final_confidence": review.final_confidence if review else None,
            "final_key_finding": review.final_key_finding if review else None,
            "final_context": review.final_context if review else None,
            "override_notes": review.override_notes if review else None,
            "approved_at": review.approved_at if review else None,
            "rejected_at": review.rejected_at if review else None,
            "rejection_reason": review.rejection_reason if review else None,
            "needs_rerun": review.needs_rerun if review else False,
            "rerun_requested_at": review.rerun_requested_at if review else None,
        },
        "effective": effective,
    }


def _cluster_payload(cluster: StoryCluster) -> dict:
    stories = sorted(
        list(cluster.stories or []),
        key=lambda s: s.published_at or s.created_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return {
        "cluster_id": str(cluster.id),
        "headline": cluster.analyst_headline or cluster.headline,
        "summary": cluster.analyst_summary or cluster.summary,
        "category": cluster.analyst_category or cluster.category,
        "severity": cluster.analyst_severity or cluster.severity,
        "system_headline": cluster.headline,
        "system_summary": cluster.summary,
        "system_category": cluster.category,
        "system_severity": cluster.severity,
        "workflow_status": cluster.workflow_status,
        "story_count": cluster.story_count,
        "source_count": cluster.source_count,
        "first_published": cluster.first_published,
        "last_updated": cluster.last_updated,
        "bluf": cluster.bluf,
        "analyst_notes": cluster.analyst_notes,
        "stories": [
            {
                "id": str(story.id),
                "title": story.title,
                "summary": story.summary,
                "source_name": story.source_name,
                "url": story.url,
                "published_at": story.published_at,
            }
            for story in stories[:8]
        ],
    }


def _narrative_payload(narrative: StoryNarrative) -> dict:
    ordered_links = sorted(narrative.cluster_links, key=lambda link: link.position)
    return {
        "narrative_id": str(narrative.id),
        "label": narrative.label,
        "thesis": narrative.thesis,
        "category": narrative.category,
        "direction": narrative.direction,
        "momentum_score": narrative.momentum_score,
        "confidence": narrative.confidence,
        "workflow_status": narrative.workflow_status,
        "review_notes": narrative.review_notes,
        "cluster_count": narrative.cluster_count,
        "first_seen_at": narrative.first_seen_at,
        "last_updated": narrative.last_updated,
        "clusters": [
            {
                "cluster_id": str(link.cluster_id),
                "headline": link.cluster.analyst_headline or link.cluster.headline,
                "category": link.cluster.analyst_category or link.cluster.category,
                "severity": link.cluster.analyst_severity or link.cluster.severity,
                "story_count": link.cluster.story_count,
                "source_count": link.cluster.source_count,
                "last_updated": link.cluster.last_updated,
                "similarity_score": link.similarity_score,
            }
            for link in ordered_links[:8]
        ],
    }


def _pagination_payload(*, items: list[dict], page: int, per_page: int, total: int) -> dict:
    return {
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page if per_page else 0,
    }


@router.get("/overview")
async def get_editorial_overview(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    service = EditorialControlService(db)
    overview = await service.get_overview()
    recent_actions = (
        await db.execute(
            select(AdminAuditLog, User.email)
            .join(User, User.id == AdminAuditLog.user_id, isouter=True)
            .order_by(AdminAuditLog.created_at.desc())
            .limit(10)
        )
    ).all()
    overview["recent_actions"] = [
        {
            "id": str(log.id),
            "action": log.action,
            "target_type": log.target_type,
            "target_id": log.target_id,
            "details": log.details,
            "created_at": log.created_at,
            "user_email": email or "",
        }
        for log, email in recent_actions
    ]
    return overview


@router.get("/automation-controls")
async def get_automation_controls(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    service = EditorialControlService(db)
    settings = get_settings()
    any_openai_feature_enabled = any(
        [
            settings.openai_embedding_enabled,
            settings.openai_clustering_enabled,
            settings.openai_agent_enabled,
            settings.openai_developing_stories_enabled,
            settings.openai_story_tracker_enabled,
        ]
    )
    return {
        "items": [serialize_control(control) for control in await service.list_controls()],
        "openai": {
            "status": (
                "healthy"
                if bool(settings.openai_api_key) and any_openai_feature_enabled
                else "misconfigured"
                if any_openai_feature_enabled
                else "disabled"
            ),
            "api_key_configured": bool(settings.openai_api_key),
            "embedding_enabled": settings.openai_embedding_enabled,
            "clustering_enabled": settings.openai_clustering_enabled,
            "agent_enabled": settings.openai_agent_enabled,
            "developing_stories_enabled": settings.openai_developing_stories_enabled,
            "story_tracker_enabled": settings.openai_story_tracker_enabled,
            "embedding_model_key": settings.embedding_model_key,
            "embedding_model": settings.openai_embedding_model,
            "clustering_model": settings.openai_clustering_model,
            "agent_fast_model": settings.openai_agent_fast_model,
            "agent_deep_model": settings.openai_agent_deep_model,
            "usage_limit_enabled": settings.openai_usage_limit_enabled,
            "local_embeddings_active": settings.embedding_model_key != "openai-3-large",
        },
    }


@router.post("/automation-controls/{automation_key}/pause")
async def pause_automation(
    automation_key: str,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    if automation_key not in AUTOMATION_DEFS:
        raise HTTPException(status_code=404, detail="Unknown automation key")
    service = EditorialControlService(db)
    control = await service.set_enabled(
        automation_key=automation_key,
        enabled=False,
        changed_by=user,
        reason=body.reason,
    )
    await _audit(
        db,
        user=user,
        request=request,
        action="pause",
        target_type="editorial_automation",
        target_id=automation_key,
        details={"reason": body.reason, "is_enabled": False},
    )
    await db.refresh(control)
    return serialize_control(control)


@router.post("/automation-controls/{automation_key}/resume")
async def resume_automation(
    automation_key: str,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    if automation_key not in AUTOMATION_DEFS:
        raise HTTPException(status_code=404, detail="Unknown automation key")
    service = EditorialControlService(db)
    control = await service.set_enabled(
        automation_key=automation_key,
        enabled=True,
        changed_by=user,
        reason=body.reason,
    )
    await _audit(
        db,
        user=user,
        request=request,
        action="resume",
        target_type="editorial_automation",
        target_id=automation_key,
        details={"reason": body.reason, "is_enabled": True},
    )
    await db.refresh(control)
    return serialize_control(control)


@router.post("/automation-controls/{automation_key}/rerun")
async def rerun_automation(
    automation_key: str,
    body: ReasonBody,
    background_tasks: BackgroundTasks,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    if automation_key not in AUTOMATION_DEFS:
        raise HTTPException(status_code=404, detail="Unknown automation key")
    service = EditorialControlService(db)
    control = await service.mark_rerun_requested(
        automation_key=automation_key,
        changed_by=user,
        reason=body.reason,
    )

    if automation_key == "story_tracker_refresh":
        background_tasks.add_task(_run_story_tracker_refresh)
    elif automation_key == "analyst_brief_generation":
        background_tasks.add_task(_run_analyst_agent_job)
    elif automation_key == "haiku_relevance":
        background_tasks.add_task(_run_haiku_borderline_review)

    await _audit(
        db,
        user=user,
        request=request,
        action="rerun",
        target_type="editorial_automation",
        target_id=automation_key,
        details={"reason": body.reason},
    )
    return serialize_control(control)


@router.get("/fact-check/inbox")
async def get_fact_check_inbox(
    workflow_status: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=40, ge=1, le=200),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    count_stmt = (
        select(func.count(FactCheckResult.id))
        .select_from(FactCheckResult)
        .join(Story, Story.id == FactCheckResult.story_id)
        .outerjoin(FactCheckReview, FactCheckReview.fact_check_result_id == FactCheckResult.id)
    )
    stmt = (
        select(FactCheckResult, Story)
        .join(Story, Story.id == FactCheckResult.story_id)
        .outerjoin(FactCheckReview, FactCheckReview.fact_check_result_id == FactCheckResult.id)
        .options(selectinload(FactCheckResult.review))
        .order_by(
            case(
                (FactCheckReview.workflow_status == "pending_review", 0),
                else_=1,
            ),
            desc(FactCheckResult.checked_at),
        )
    )
    if workflow_status:
        count_stmt = count_stmt.where(FactCheckReview.workflow_status == workflow_status)
        stmt = stmt.where(FactCheckReview.workflow_status == workflow_status)
    total = int((await db.execute(count_stmt)).scalar() or 0)
    rows = (
        await db.execute(
            stmt.offset((page - 1) * per_page).limit(per_page)
        )
    ).all()
    return _pagination_payload(
        items=[_fact_check_payload(result, story) for result, story in rows],
        page=page,
        per_page=per_page,
        total=total,
    )


@router.get("/fact-check/{story_id}")
async def get_fact_check_detail(
    story_id: UUID,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(FactCheckResult, Story)
            .join(Story, Story.id == FactCheckResult.story_id)
            .options(selectinload(FactCheckResult.review))
            .where(FactCheckResult.story_id == story_id)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Fact-check not found")
    result, story = row
    return _fact_check_payload(result, story)


@router.patch("/fact-check/{story_id}")
async def patch_fact_check(
    story_id: UUID,
    body: FactCheckPatchBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    result = (
        await db.execute(
            select(FactCheckResult)
            .options(selectinload(FactCheckResult.review))
            .where(FactCheckResult.story_id == story_id)
        )
    ).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Fact-check not found")

    review = result.review or FactCheckReview(fact_check_result_id=result.id)
    if result.review is None:
        db.add(review)
    before = {
        "workflow_status": review.workflow_status,
        "final_verdict": review.final_verdict,
        "final_verdict_summary": review.final_verdict_summary,
        "final_confidence": review.final_confidence,
        "final_key_finding": review.final_key_finding,
        "final_context": review.final_context,
        "override_notes": review.override_notes,
    }
    review.final_verdict = body.final_verdict
    review.final_verdict_summary = body.final_verdict_summary
    review.final_confidence = body.final_confidence
    review.final_key_finding = body.final_key_finding
    review.final_context = body.final_context
    review.override_notes = body.override_notes
    review.workflow_status = "pending_review"
    review.needs_rerun = False
    await db.commit()
    await db.refresh(result)
    await _audit(
        db,
        user=user,
        request=request,
        action="update",
        target_type="fact_check_review",
        target_id=str(result.id),
        details={"reason": body.reason, "before": before, "after": _fact_check_payload(result)["review"]},
    )
    return _fact_check_payload(result)


@router.post("/fact-check/{story_id}/approve")
async def approve_fact_check(
    story_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    result = (
        await db.execute(
            select(FactCheckResult)
            .options(selectinload(FactCheckResult.review))
            .where(FactCheckResult.story_id == story_id)
        )
    ).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Fact-check not found")
    review = result.review or FactCheckReview(fact_check_result_id=result.id)
    if result.review is None:
        db.add(review)
    review.workflow_status = "approved"
    review.final_verdict = review.final_verdict or result.verdict
    review.final_verdict_summary = review.final_verdict_summary or result.verdict_summary
    review.final_confidence = result.confidence if review.final_confidence is None else review.final_confidence
    review.final_key_finding = review.final_key_finding or result.key_finding
    review.final_context = review.final_context or result.context
    review.approved_by_id = user.id
    review.approved_at = datetime.now(timezone.utc)
    review.rejected_at = None
    review.rejected_by_id = None
    review.rejection_reason = None
    review.needs_rerun = False
    await db.commit()
    await db.refresh(result)
    await _audit(
        db,
        user=user,
        request=request,
        action="approve",
        target_type="fact_check_review",
        target_id=str(result.id),
        details={"reason": body.reason, "workflow_status": "approved"},
    )
    return _fact_check_payload(result)


@router.post("/fact-check/{story_id}/reject")
async def reject_fact_check(
    story_id: UUID,
    body: FactCheckRejectBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    result = (
        await db.execute(
            select(FactCheckResult)
            .options(selectinload(FactCheckResult.review))
            .where(FactCheckResult.story_id == story_id)
        )
    ).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Fact-check not found")
    review = result.review or FactCheckReview(fact_check_result_id=result.id)
    if result.review is None:
        db.add(review)
    review.workflow_status = body.workflow_status
    review.rejected_by_id = user.id
    review.rejected_at = datetime.now(timezone.utc)
    review.rejection_reason = body.reason
    review.approved_by_id = None
    review.approved_at = None
    await db.commit()
    await db.refresh(result)
    await _audit(
        db,
        user=user,
        request=request,
        action="reject",
        target_type="fact_check_review",
        target_id=str(result.id),
        details={"reason": body.reason, "workflow_status": body.workflow_status},
    )
    return _fact_check_payload(result)


@router.post("/fact-check/{story_id}/rerun")
async def rerun_fact_check(
    story_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    result = (
        await db.execute(
            select(FactCheckResult)
            .options(selectinload(FactCheckResult.review))
            .where(FactCheckResult.story_id == story_id)
        )
    ).scalar_one_or_none()
    if not result:
        raise HTTPException(status_code=404, detail="Fact-check not found")
    review = result.review or FactCheckReview(fact_check_result_id=result.id)
    if result.review is None:
        db.add(review)
    review.needs_rerun = True
    review.rerun_requested_at = datetime.now(timezone.utc)
    review.rerun_requested_by_id = user.id
    review.workflow_status = "pending_review"
    await db.commit()
    service = EditorialControlService(db)
    await service.mark_rerun_requested(
        automation_key="fact_check_generation",
        changed_by=user,
        reason=body.reason,
    )
    await _audit(
        db,
        user=user,
        request=request,
        action="rerun",
        target_type="fact_check_review",
        target_id=str(result.id),
        details={"reason": body.reason},
    )
    return _fact_check_payload(result)


@router.get("/developing-stories/inbox")
async def get_developing_story_inbox(
    hours: int = Query(default=72, ge=1, le=168),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=40, ge=1, le=200),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    count_stmt = (
        select(func.count(StoryCluster.id))
        .where(StoryCluster.first_published >= cutoff)
        .where(StoryCluster.story_count >= 2)
    )
    stmt = (
        select(StoryCluster)
        .options(selectinload(StoryCluster.stories))
        .where(StoryCluster.first_published >= cutoff)
        .where(StoryCluster.story_count >= 2)
        .order_by(
            case((StoryCluster.workflow_status.in_(["unreviewed", "monitoring"]), 0), else_=1),
            StoryCluster.last_updated.desc().nullslast(),
        )
    )
    total = int((await db.execute(count_stmt)).scalar() or 0)
    rows = (
        await db.execute(stmt.offset((page - 1) * per_page).limit(per_page))
    ).scalars().all()
    return _pagination_payload(
        items=[_cluster_payload(cluster) for cluster in rows],
        page=page,
        per_page=per_page,
        total=total,
    )


@router.get("/developing-stories/{cluster_id}")
async def get_developing_story_detail(
    cluster_id: UUID,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cluster = (
        await db.execute(
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.id == cluster_id)
        )
    ).scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return _cluster_payload(cluster)


@router.patch("/developing-stories/{cluster_id}")
async def patch_developing_story(
    cluster_id: UUID,
    body: ClusterPatchBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cluster = await db.get(StoryCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    before = {
        "headline": cluster.analyst_headline,
        "summary": cluster.analyst_summary,
        "category": cluster.analyst_category,
        "severity": cluster.analyst_severity,
        "notes": cluster.analyst_notes,
        "workflow_status": cluster.workflow_status,
    }
    cluster.analyst_headline = body.analyst_headline
    cluster.analyst_summary = body.analyst_summary
    cluster.analyst_category = body.analyst_category
    cluster.analyst_severity = body.analyst_severity
    cluster.analyst_notes = body.analyst_notes
    if body.workflow_status:
        cluster.workflow_status = body.workflow_status
    await db.commit()
    await db.refresh(cluster)
    await _audit(
        db,
        user=user,
        request=request,
        action="update",
        target_type="developing_story",
        target_id=str(cluster_id),
        details={"reason": body.reason, "before": before, "after": _cluster_payload(cluster)},
    )
    return _cluster_payload(cluster)


@router.post("/developing-stories/{cluster_id}/approve")
async def approve_developing_story(
    cluster_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cluster = await db.get(StoryCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    cluster.workflow_status = "verified"
    cluster.verified_by_id = user.id
    cluster.verified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(cluster)
    await _audit(
        db,
        user=user,
        request=request,
        action="approve",
        target_type="developing_story",
        target_id=str(cluster_id),
        details={"reason": body.reason, "workflow_status": "verified"},
    )
    return _cluster_payload(cluster)


@router.post("/developing-stories/{cluster_id}/reject")
async def reject_developing_story(
    cluster_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cluster = await db.get(StoryCluster, cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    cluster.workflow_status = "rejected"
    cluster.analyst_notes = f"{cluster.analyst_notes or ''}\n\nRejection reason: {body.reason}".strip()
    await db.commit()
    await db.refresh(cluster)
    await _audit(
        db,
        user=user,
        request=request,
        action="reject",
        target_type="developing_story",
        target_id=str(cluster_id),
        details={"reason": body.reason, "workflow_status": "rejected"},
    )
    return _cluster_payload(cluster)


@router.post("/developing-stories/{cluster_id}/rerun")
async def rerun_developing_story(
    cluster_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cluster = (
        await db.execute(
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.id == cluster_id)
        )
    ).scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    cluster.bluf = None
    await db.commit()
    control_service = EditorialControlService(db)
    await control_service.mark_rerun_requested(
        automation_key="developing_story_bluf",
        changed_by=user,
        reason=body.reason,
    )
    await control_service.mark_run_started("developing_story_bluf")
    try:
        service = DevelopingStoriesService(db)
        await service._resolve_event_bluf(cluster, allow_generate=True)
        await control_service.mark_run_finished("developing_story_bluf", success=True)
    except Exception as exc:
        await control_service.mark_run_finished("developing_story_bluf", success=False, error=str(exc))
        raise
    await _audit(
        db,
        user=user,
        request=request,
        action="rerun",
        target_type="developing_story",
        target_id=str(cluster_id),
        details={"reason": body.reason},
    )
    await db.refresh(cluster)
    return _cluster_payload(cluster)


@router.get("/story-tracker/inbox")
async def get_story_tracker_inbox(
    hours: int = Query(default=72, ge=1, le=168),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=40, ge=1, le=200),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    count_stmt = select(func.count(StoryNarrative.id)).where(StoryNarrative.last_updated >= cutoff)
    stmt = (
        select(StoryNarrative)
        .options(
            selectinload(StoryNarrative.cluster_links)
            .selectinload(StoryNarrativeCluster.cluster)
        )
        .where(StoryNarrative.last_updated >= cutoff)
        .order_by(
            case((StoryNarrative.workflow_status != "approved", 0), else_=1),
            StoryNarrative.last_updated.desc().nullslast(),
        )
    )
    total = int((await db.execute(count_stmt)).scalar() or 0)
    rows = (
        await db.execute(stmt.offset((page - 1) * per_page).limit(per_page))
    ).scalars().all()
    return _pagination_payload(
        items=[_narrative_payload(narrative) for narrative in rows],
        page=page,
        per_page=per_page,
        total=total,
    )


@router.patch("/story-tracker/{narrative_id}")
async def patch_story_tracker_narrative(
    narrative_id: UUID,
    body: NarrativePatchBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    narrative = (
        await db.execute(
            select(StoryNarrative)
            .options(
                selectinload(StoryNarrative.cluster_links)
                .selectinload(StoryNarrativeCluster.cluster)
            )
            .where(StoryNarrative.id == narrative_id)
        )
    ).scalar_one_or_none()
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")
    before = _narrative_payload(narrative)
    if body.label is not None:
        narrative.label = body.label
    if body.thesis is not None:
        narrative.thesis = body.thesis
    if body.review_notes is not None:
        narrative.review_notes = body.review_notes
    if body.workflow_status is not None:
        narrative.workflow_status = body.workflow_status
    await db.commit()
    await db.refresh(narrative)
    await _audit(
        db,
        user=user,
        request=request,
        action="update",
        target_type="story_tracker",
        target_id=str(narrative_id),
        details={"reason": body.reason, "before": before, "after": _narrative_payload(narrative)},
    )
    return _narrative_payload(narrative)


@router.post("/story-tracker/{narrative_id}/approve")
async def approve_story_tracker_narrative(
    narrative_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    narrative = await db.get(StoryNarrative, narrative_id)
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")
    narrative.workflow_status = "approved"
    narrative.approved_by_id = user.id
    narrative.approved_at = datetime.now(timezone.utc)
    narrative.rejected_by_id = None
    narrative.rejected_at = None
    await db.commit()
    await db.refresh(narrative)
    await _audit(
        db,
        user=user,
        request=request,
        action="approve",
        target_type="story_tracker",
        target_id=str(narrative_id),
        details={"reason": body.reason},
    )
    return _narrative_payload(narrative)


@router.post("/story-tracker/{narrative_id}/reject")
async def reject_story_tracker_narrative(
    narrative_id: UUID,
    body: ReasonBody,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    narrative = await db.get(StoryNarrative, narrative_id)
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")
    narrative.workflow_status = "rejected"
    narrative.review_notes = body.reason
    narrative.rejected_by_id = user.id
    narrative.rejected_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(narrative)
    await _audit(
        db,
        user=user,
        request=request,
        action="reject",
        target_type="story_tracker",
        target_id=str(narrative_id),
        details={"reason": body.reason},
    )
    return _narrative_payload(narrative)


@router.post("/story-tracker/{narrative_id}/rerun")
async def rerun_story_tracker_narrative(
    narrative_id: UUID,
    body: ReasonBody,
    background_tasks: BackgroundTasks,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    narrative = await db.get(StoryNarrative, narrative_id)
    if not narrative:
        raise HTTPException(status_code=404, detail="Narrative not found")
    service = EditorialControlService(db)
    await service.mark_rerun_requested(
        automation_key="story_tracker_refresh",
        changed_by=user,
        reason=body.reason,
    )
    background_tasks.add_task(_run_story_tracker_refresh)
    await _audit(
        db,
        user=user,
        request=request,
        action="rerun",
        target_type="story_tracker",
        target_id=str(narrative_id),
        details={"reason": body.reason},
    )
    return {"status": "queued", "narrative_id": str(narrative_id)}
