"""ML training, embeddings, clustering, and experience buffer endpoints."""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_dev
from app.core.database import get_db
from app.models.user import User
from app.services.ml_training_service import MLTrainingService
from app.services.embedding_management_service import EmbeddingManagementService
from app.services.audit_service import AuditService

router = APIRouter(prefix="/ml", tags=["ml"])


# ── Model Endpoints ──

@router.get("/models")
async def get_models(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get status of all ML models. DEV only."""
    service = MLTrainingService(db)
    return await service.get_models()


@router.post("/models/{model_name}/train")
async def train_model(
    model_name: str,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Start training a model. DEV only."""
    body = await request.json()
    parameters = body.get("parameters", {})
    reason = body.get("reason", "Manual training")

    service = MLTrainingService(db)
    try:
        result = await service.start_training(model_name, parameters, reason, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Audit log
    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="train",
        target_type="model",
        target_id=model_name,
        details={"parameters": parameters, "reason": reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.get("/training/{run_id}/progress")
async def get_training_progress(
    run_id: UUID,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get training run progress. DEV only."""
    service = MLTrainingService(db)
    try:
        return await service.get_training_progress(run_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/training/history")
async def get_training_history(
    model: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get training history. DEV only."""
    service = MLTrainingService(db)
    return await service.get_training_history(model_name=model, limit=limit)


@router.post("/models/{model_name}/promote")
async def promote_model(
    model_name: str,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Promote trained model to production. DEV only."""
    body = await request.json()
    version = body.get("version", "")
    notes = body.get("notes", "")

    service = MLTrainingService(db)
    result = await service.promote_model(model_name, version, notes)

    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="promote",
        target_type="model",
        target_id=model_name,
        details={"version": version, "notes": notes},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.post("/models/{model_name}/rollback")
async def rollback_model(
    model_name: str,
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Rollback model to previous version. DEV only."""
    body = await request.json()
    to_version = body.get("to_version", "")
    reason = body.get("reason", "")

    service = MLTrainingService(db)
    result = await service.rollback_model(model_name, to_version, reason)

    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="rollback",
        target_type="model",
        target_id=model_name,
        details={"to_version": to_version, "reason": reason},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


# ── Embedding Endpoints ──

@router.get("/embeddings/stats")
async def get_embedding_stats(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get embedding statistics. DEV only."""
    service = EmbeddingManagementService(db)
    return await service.get_embedding_stats()


@router.post("/embeddings/regenerate")
async def regenerate_embeddings(
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Trigger embedding regeneration. DEV only."""
    body = await request.json()
    service = EmbeddingManagementService(db)
    result = await service.regenerate_embeddings(
        scope=body.get("scope", "failed"),
        date_from=body.get("date_from"),
        date_to=body.get("date_to"),
        batch_size=body.get("batch_size", 100),
    )

    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="train",
        target_type="embeddings",
        target_id="regenerate",
        details=body,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


# ── Clustering Endpoints ──

@router.get("/clustering/config")
async def get_clustering_config(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get clustering configuration. DEV only."""
    service = EmbeddingManagementService(db)
    return await service.get_clustering_config()


@router.put("/clustering/config")
async def update_clustering_config(
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Update clustering configuration. DEV only."""
    body = await request.json()
    service = EmbeddingManagementService(db)
    result = await service.update_clustering_config(body)

    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="update",
        target_type="clustering_config",
        target_id="config",
        details=body,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.get("/clustering/stats")
async def get_clustering_stats(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get clustering statistics. DEV only."""
    service = EmbeddingManagementService(db)
    return await service.get_clustering_stats()


@router.post("/clustering/retrain")
async def retrain_clustering(
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Trigger clustering retraining. DEV only."""
    body = await request.json()
    service = EmbeddingManagementService(db)
    result = await service.retrain_clustering(body.get("reason", "Manual retrain"))

    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="train",
        target_type="clustering",
        target_id="retrain",
        details=body,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


# ── Clustering Merge (Local Agent) Endpoints ──

@router.get("/clustering/merge-candidates")
async def get_merge_candidates(
    hours: int = Query(48, ge=1, le=168),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """
    Export unclustered stories grouped by district for local Haiku merge.
    Returns district batches where at least one story is unclustered.
    DEV only.
    """
    from collections import defaultdict
    from sqlalchemy import select, func, and_
    from app.models.story import Story
    from app.models.story_feature import StoryFeature
    from datetime import datetime, timezone, timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(Story, StoryFeature.districts)
        .join(StoryFeature, Story.id == StoryFeature.story_id)
        .where(
            and_(
                func.coalesce(Story.published_at, Story.created_at) >= cutoff,
                Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
                StoryFeature.districts.isnot(None),
            )
        )
        .order_by(func.coalesce(Story.published_at, Story.created_at).desc())
    )
    rows = result.all()

    # Build story map
    story_map = {}
    story_districts = {}
    for story, districts in rows:
        if not districts:
            continue
        story_map[story.id] = story
        story_districts[story.id] = districts

    # Group by district
    by_district: dict[str, list] = defaultdict(list)
    for story_id, districts in story_districts.items():
        for district in districts:
            by_district[district.lower()].append(story_map[story_id])

    # Build export — only districts with at least one unclustered story
    batches = []
    for district, stories in by_district.items():
        seen = set()
        unique = []
        for s in stories:
            if s.id not in seen:
                seen.add(s.id)
                unique.append(s)
        if len(unique) < 2:
            continue

        unclustered = [s for s in unique if s.cluster_id is None]
        if not unclustered:
            continue

        story_items = []
        for s in unique[:25]:
            title = (s.title or "")[:120].replace('\n', ' ')
            source = s.source_id or "?"
            cluster_tag = f" [C{str(s.cluster_id)[:4]}]" if s.cluster_id else ""
            summary = ""
            if s.ai_summary and isinstance(s.ai_summary, dict):
                summary = (s.ai_summary.get("haiku_summary") or "")[:200]
            elif s.summary:
                summary = (s.summary or "")[:200]
            story_items.append({
                "id": str(s.id),
                "source": source,
                "source_name": s.source_name or source,
                "title": title,
                "summary": summary,
                "published_at": s.published_at.isoformat() if s.published_at else None,
                "category": s.category,
                "severity": s.severity,
                "language": s.language or "ne",
                "cluster_tag": cluster_tag,
            })
        batches.append({
            "district": district,
            "story_count": len(story_items),
            "unclustered_count": len(unclustered),
            "stories": story_items,
        })

    return {
        "total_stories": len(story_map),
        "total_districts": len(batches),
        "batches": batches,
    }


class MergeGroupMeta(BaseModel):
    """Optional rich metadata per group from enhanced clustering."""
    event_type: Optional[str] = None
    severity: Optional[str] = None
    headline: Optional[str] = None
    bluf: Optional[str] = None
    development_stage: Optional[str] = None
    key_updates: Optional[list[str]] = None
    geographic_scope: Optional[str] = None
    cross_lingual: Optional[bool] = None
    source_agreement: Optional[str] = None
    confidence: Optional[float] = None


class MergeGroup(BaseModel):
    district: str
    groups: list[list[str]]  # List of groups, each group is list of story IDs
    metadata: Optional[list[dict]] = None  # Optional per-group metadata


class MergeResultsRequest(BaseModel):
    merges: list[MergeGroup]


@router.post("/clustering/merge-results")
async def ingest_merge_results(
    payload: MergeResultsRequest,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest merge results from local Claude CLI clustering.
    Accepts groups of story IDs per district and performs the merge.
    DEV only.
    """
    from app.services.clustering.clustering_service import ClusteringService

    service = ClusteringService(db)
    total_merges = 0
    errors = []

    for merge_group in payload.merges:
        try:
            merges = await service.apply_external_merge(
                district=merge_group.district,
                groups=merge_group.groups,
                metadata=merge_group.metadata,
            )
            total_merges += merges
        except Exception as e:
            errors.append(f"{merge_group.district}: {e}")

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Commit failed: {e}")

    return {
        "total_merges": total_merges,
        "districts_processed": len(payload.merges),
        "errors": errors,
    }


# ── Experience Buffer Endpoints ──

@router.get("/experience-buffer/stats")
async def get_experience_buffer_stats(
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Get experience buffer statistics. DEV only."""
    service = EmbeddingManagementService(db)
    return await service.get_experience_buffer_stats()


@router.post("/experience-buffer/flush")
async def flush_experience_buffer(
    request: Request,
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Flush old experience buffer entries. DEV only."""
    body = await request.json()
    older_than_days = body.get("older_than_days", 90)
    model = body.get("model")

    service = EmbeddingManagementService(db)
    result = await service.flush_experience_buffer(older_than_days, model)

    audit = AuditService(db)
    await audit.log_action(
        user_id=user.id,
        action="flush",
        target_type="experience_buffer",
        target_id=model or "all",
        details={"older_than_days": older_than_days, "flushed": result["flushed"]},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    return result


@router.get("/experience-buffer/export")
async def export_experience_buffer(
    model: Optional[str] = Query(default=None),
    user: User = Depends(require_dev),
    db: AsyncSession = Depends(get_db),
):
    """Export experience buffer as CSV. DEV only."""
    import csv
    import io
    from sqlalchemy import select
    from app.models.experience_record import ExperienceRecord

    query = select(ExperienceRecord).order_by(ExperienceRecord.created_at.desc()).limit(10000)
    if model:
        query = query.where(ExperienceRecord.experience_type == model)

    result = await db.execute(query)
    records = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "story_id", "reward", "created_at"])
    for r in records:
        writer.writerow([str(r.id), r.experience_type, str(r.story_id), r.reward, r.created_at.isoformat()])

    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=experience-buffer.csv"},
    )
