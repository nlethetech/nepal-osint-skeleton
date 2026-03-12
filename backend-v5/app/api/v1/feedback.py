"""Feedback and ML API endpoints."""
import logging
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_dev
from app.ml.feature_extraction import build_priority_features, extract_severity_tokens
from app.models.story import Story
from app.models.experience_record import ExperienceRecord, ExperienceType
from app.models.rl_model_version import RLModelVersion
from app.ml.experience_buffer import ExperienceRepository
from app.ml.inference import get_predictor
from app.ml.training import TrainingOrchestrator
from app.schemas.feedback import (
    FeedbackCreate,
    FeedbackResponse,
    MLStatusResponse,
    ExperienceStatsResponse,
    TrainingResponse,
    RecentExperienceResponse,
    RecentExperienceItem,
    SourceConfidenceItem,
    SourceRankingResponse,
    ModelStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ml", tags=["ml"])


# ============================================================
# Feedback Endpoints
# ============================================================

@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    feedback: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit human feedback for RL training.

    Supports feedback types:
    - classification: Correct category for a story
    - priority: Correct priority/severity for a story
    - source: Source reliability feedback
    - clustering: Whether story belongs in cluster
    """
    repo = ExperienceRepository(db)
    feedback_id = uuid4()

    try:
        if feedback.feedback_type == "classification" and feedback.classification:
            f = feedback.classification
            # Look up story to get system prediction
            result = await db.execute(
                select(Story).where(Story.id == f.story_id)
            )
            story = result.scalar_one_or_none()
            if not story:
                raise HTTPException(status_code=404, detail="Story not found")

            system_category = f.system_category or story.category or "unknown"

            record = await repo.create_classification_feedback(
                story_id=f.story_id,
                system_category=system_category,
                human_category=f.correct_category,
                context={"text": f"{story.title} {story.summary or ''}"},
            )
            feedback_id = record.id

        elif feedback.feedback_type == "priority" and feedback.priority:
            f = feedback.priority
            result = await db.execute(
                select(Story).where(Story.id == f.story_id)
            )
            story = result.scalar_one_or_none()
            if not story:
                raise HTTPException(status_code=404, detail="Story not found")

            system_priority = f.system_priority or story.severity or "medium"

            predictor = get_predictor()
            if not predictor._initialized:
                predictor.initialize()

            severity_tokens = extract_severity_tokens(story.title, story.summary)
            features = build_priority_features(
                predictor,
                category=story.category,
                source_id=story.source_id,
                published_at=story.published_at,
                severity_tokens=severity_tokens,
                entity_count=0,
            )

            record = await repo.create_priority_feedback(
                story_id=f.story_id,
                system_priority=system_priority,
                human_priority=f.correct_priority,
                context={"features": features, "label_source": "manual_feedback"},
            )
            feedback_id = record.id

        elif feedback.feedback_type == "source" and feedback.source:
            f = feedback.source
            record = await repo.create_source_feedback(
                source_id=f.source_id,
                is_reliable=f.is_reliable,
                story_id=f.story_id,
            )
            feedback_id = record.id

            # Also update source confidence model immediately
            predictor = get_predictor()
            predictor.update_source_feedback(f.source_id, f.is_reliable)

        elif feedback.feedback_type == "clustering" and feedback.clustering:
            f = feedback.clustering
            record = await repo.create_clustering_feedback(
                cluster_id=f.cluster_id,
                story_id=f.story_id,
                should_be_in_cluster=f.should_be_in_cluster,
            )
            feedback_id = record.id

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid feedback type or missing data: {feedback.feedback_type}",
            )

        return FeedbackResponse(
            success=True,
            feedback_id=feedback_id,
            feedback_type=feedback.feedback_type,
            message=f"Feedback recorded successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to record feedback: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# ML Status Endpoints
# ============================================================

@router.get("/status", response_model=MLStatusResponse)
async def get_ml_status(
    db: AsyncSession = Depends(get_db),
):
    """Get status of all ML models."""
    predictor = get_predictor()

    if not predictor._initialized:
        predictor.initialize()

    status = predictor.get_model_status()

    # Pull latest active model versions (if present)
    active_versions: dict[str, RLModelVersion] = {}
    try:
        result = await db.execute(
            select(RLModelVersion)
            .where(RLModelVersion.is_active == True)  # noqa: E712
            .order_by(RLModelVersion.created_at.desc())
        )
        for v in result.scalars().all():
            if v.model_type not in active_versions:
                active_versions[v.model_type] = v
    except Exception:
        active_versions = {}

    return MLStatusResponse(
        initialized=predictor._initialized,
        models={
            name: (
                lambda s=status[name], v=active_versions.get(name): ModelStatus(
                    model_type=s.model_type,
                    is_loaded=s.is_loaded,
                    version=(v.version if v else s.version),
                    accuracy=(float(v.accuracy) if (v and v.accuracy is not None) else s.accuracy),
                    last_trained=((v.model_metadata or {}).get("trained_at") if v else s.last_trained),
                    training_samples=(v.training_samples if v else None),
                )
            )()
            for name in status.keys()
        },
        device="cpu",  # TODO: Detect actual device
    )


# ============================================================
# Experience Buffer Endpoints
# ============================================================

@router.get("/experience/stats", response_model=ExperienceStatsResponse)
async def get_experience_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get experience buffer statistics."""
    repo = ExperienceRepository(db)
    stats = await repo.get_stats()

    # Determine which models are ready for training
    from app.ml.config import get_ml_config
    config = get_ml_config()

    ready_for_training = {}
    for exp_type, count in stats.get("unused_by_type", {}).items():
        model_type = exp_type.lower()
        if model_type == "classification":
            ready_for_training[exp_type] = count >= config.story_classifier.min_samples_to_train
        elif model_type == "priority":
            ready_for_training[exp_type] = count >= config.priority_bandit.min_samples_to_train
        elif model_type == "source":
            ready_for_training[exp_type] = count >= 1  # Bayesian updates are instant
        else:
            ready_for_training[exp_type] = count >= 50

    return ExperienceStatsResponse(
        total_records=stats.get("total_records", 0),
        by_type=stats.get("by_type", {}),
        unused_by_type=stats.get("unused_by_type", {}),
        recent_24h=stats.get("recent_24h", 0),
        average_rewards=stats.get("average_rewards", {}),
        ready_for_training=ready_for_training,
    )


@router.get("/experience/recent", response_model=RecentExperienceResponse)
async def get_recent_experience(
    experience_type: Optional[str] = Query(None),
    hours: int = Query(24, le=168),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get recent experience records."""
    repo = ExperienceRepository(db)
    records = await repo.get_recent(
        experience_type=experience_type,
        hours=hours,
        limit=limit,
    )

    return RecentExperienceResponse(
        records=[
            RecentExperienceItem(
                id=r.id,
                experience_type=r.experience_type,
                story_id=r.story_id,
                system_action=r.system_action,
                human_action=r.human_action,
                reward=float(r.reward) if r.reward else None,
                used_in_training=r.used_in_training,
                created_at=r.created_at,
            )
            for r in records
        ],
        total=len(records),
    )


# ============================================================
# Training Endpoints
# ============================================================

@router.post("/train", response_model=TrainingResponse, dependencies=[Depends(require_dev)])
async def trigger_training(
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger training of all RL models.

    This runs the training orchestrator which:
    1. Updates source confidence (instant)
    2. Trains story classifier if enough samples
    3. Trains priority bandit if enough samples
    4. Trains anomaly VAE if enough samples
    5. Trains temporal embedder if enough samples
    """
    orchestrator = TrainingOrchestrator(db)
    result = await orchestrator.train_all()

    return TrainingResponse(
        timestamp=result.timestamp,
        total_samples=result.total_samples,
        models_promoted=result.models_promoted,
        results={
            name: {
                "model_type": r.model_type,
                "success": r.success,
                "samples_used": r.samples_used,
                "new_accuracy": r.new_accuracy,
                "previous_accuracy": r.previous_accuracy,
                "new_metrics": r.new_metrics,
                "previous_metrics": r.previous_metrics,
                "promoted": r.promoted,
                "error": r.error,
            }
            for name, r in result.results.items()
        },
    )


# ============================================================
# Source Confidence Endpoints
# ============================================================

@router.get("/sources/confidence/{source_id}")
async def get_source_confidence(
    source_id: str,
):
    """Get confidence score for a specific source."""
    predictor = get_predictor()
    result = predictor.get_source_confidence(source_id)

    return SourceConfidenceItem(
        source_id=result.source_id,
        confidence=result.confidence,
        uncertainty=result.uncertainty,
        credible_interval=result.credible_interval,
        sample_size=result.sample_size,
    )


@router.get("/sources/ranking", response_model=SourceRankingResponse)
async def get_source_ranking(
    min_samples: int = Query(5, ge=1),
    limit: int = Query(50, le=200),
):
    """Get sources ranked by confidence."""
    predictor = get_predictor()
    ranked = predictor.source_confidence.get_ranked_sources(
        min_samples=min_samples,
        descending=True,
    )

    sources = [
        SourceConfidenceItem(
            source_id=r.source_id,
            confidence=r.confidence,
            uncertainty=r.uncertainty,
            credible_interval=r.credible_interval,
            sample_size=r.sample_size,
        )
        for r in ranked[:limit]
    ]

    return SourceRankingResponse(
        sources=sources,
        total_sources=len(ranked),
    )


# ============================================================
# Prediction Endpoints
# ============================================================

@router.post("/predict/category")
async def predict_category(
    title: str,
    content: Optional[str] = None,
):
    """Predict category for text using the story classifier."""
    predictor = get_predictor()
    result = predictor.classify_story(title, content)

    return {
        "category": result.category,
        "confidence": result.confidence,
        "all_probabilities": result.all_probabilities,
    }


@router.post("/predict/priority")
async def predict_priority(
    category: Optional[str] = None,
    source_id: Optional[str] = None,
):
    """Predict priority using the priority bandit."""
    predictor = get_predictor()
    result = predictor.predict_priority(
        category=category,
        source_id=source_id,
    )

    return {
        "priority": result.priority,
        "confidence": result.confidence,
        "all_scores": result.all_scores,
    }
