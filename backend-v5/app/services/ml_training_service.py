"""ML training orchestration service."""
import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rl_model_version import RLModelVersion, ModelType
from app.models.training_run import TrainingRun, TrainingStatus
from app.repositories.training_repository import TrainingRepository

logger = logging.getLogger(__name__)


KNOWN_MODELS = [
    ModelType.PRIORITY_BANDIT,
    ModelType.SOURCE_CONFIDENCE,
    ModelType.STORY_CLASSIFIER,
    ModelType.ANOMALY_VAE,
    ModelType.TEMPORAL_EMBEDDER,
]


class MLTrainingService:
    """Orchestrates ML model training, promotion, and rollback."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.training_repo = TrainingRepository(db)

    async def get_models(self) -> dict:
        """Get status of all ML models."""
        models = []
        for model_name in KNOWN_MODELS:
            # Get latest active version
            result = await self.db.execute(
                select(RLModelVersion)
                .where(RLModelVersion.model_type == model_name)
                .order_by(RLModelVersion.created_at.desc())
                .limit(1)
            )
            version = result.scalar_one_or_none()

            # Check for active training
            active_run = await self.training_repo.get_active_for_model(model_name)

            if active_run:
                status = "training"
            elif version and version.is_active:
                status = "ready"
            elif version:
                status = "outdated"
            else:
                status = "ready"  # No version yet but available

            models.append({
                "name": model_name,
                "status": status,
                "version": f"v{version.version}" if version else "v0.0.0",
                "accuracy": float(version.accuracy) if version and version.accuracy else None,
                "last_trained_at": version.created_at if version else None,
                "training_duration_sec": None,
                "training_samples": version.training_samples if version else None,
                "is_deployed": version.is_active if version else False,
            })

        return {"models": models}

    async def start_training(
        self,
        model_name: str,
        parameters: dict,
        reason: str,
        started_by: UUID,
    ) -> dict:
        """Start a training run for a model."""
        if model_name not in KNOWN_MODELS:
            raise ValueError(f"Unknown model: {model_name}")

        # Check for concurrent training
        active = await self.training_repo.get_active_for_model(model_name)
        if active:
            raise ValueError(f"Training already in progress for {model_name}")

        epochs = parameters.get("epochs", 50)
        run = await self.training_repo.create(
            model_name=model_name,
            parameters=parameters,
            reason=reason,
            started_by=started_by,
            total_epochs=epochs,
            estimated_duration_sec=epochs * 25,  # rough estimate
        )

        return {
            "training_run_id": str(run.id),
            "status": "started",
            "estimated_duration_sec": run.estimated_duration_sec,
        }

    async def get_training_progress(self, run_id: UUID) -> dict:
        """Get progress of a training run."""
        run = await self.training_repo.get_by_id(run_id)
        if not run:
            raise ValueError("Training run not found")

        elapsed = None
        remaining = None
        if run.started_at:
            from datetime import datetime, timezone
            elapsed = int((datetime.now(timezone.utc) - run.started_at).total_seconds())
            if run.progress_pct > 0:
                remaining = int(elapsed * (100 - run.progress_pct) / run.progress_pct)

        return {
            "run_id": str(run.id),
            "model": run.model_name,
            "status": run.status,
            "progress_pct": run.progress_pct,
            "current_epoch": run.current_epoch,
            "total_epochs": run.total_epochs,
            "current_loss": run.current_loss,
            "best_loss": run.best_loss,
            "elapsed_sec": elapsed,
            "estimated_remaining_sec": remaining,
        }

    async def get_training_history(self, model_name: Optional[str] = None, limit: int = 50) -> dict:
        """Get past training runs."""
        runs = await self.training_repo.get_history(model_name=model_name, limit=limit)
        items = []
        for run in runs:
            items.append({
                "run_id": str(run.id),
                "model": run.model_name,
                "status": run.status,
                "progress_pct": run.progress_pct,
                "current_epoch": run.current_epoch,
                "total_epochs": run.total_epochs,
                "current_loss": run.current_loss,
                "best_loss": run.best_loss,
                "elapsed_sec": None,
                "estimated_remaining_sec": None,
            })
        return {"items": items, "total": len(items)}

    async def promote_model(self, model_name: str, version: str, notes: str) -> dict:
        """Promote a model version to production."""
        # Deactivate current active version
        result = await self.db.execute(
            select(RLModelVersion).where(
                RLModelVersion.model_type == model_name,
                RLModelVersion.is_active == True,
            )
        )
        current = result.scalar_one_or_none()
        if current:
            current.is_active = False

        # Find and activate the target version
        result = await self.db.execute(
            select(RLModelVersion).where(
                RLModelVersion.model_type == model_name,
                RLModelVersion.version == version.lstrip("v"),
            )
        )
        target = result.scalar_one_or_none()
        if target:
            target.is_active = True
            await self.db.commit()

        return {
            "model": model_name,
            "action": "promote",
            "status": "success",
            "message": f"Promoted {model_name} to {version}",
        }

    async def rollback_model(self, model_name: str, to_version: str, reason: str) -> dict:
        """Rollback model to a previous version."""
        return await self.promote_model(model_name, to_version, f"Rollback: {reason}")
