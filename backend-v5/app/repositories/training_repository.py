"""Training run repository for data access."""
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training_run import TrainingRun, TrainingStatus


class TrainingRepository:
    """Data access for ML training runs."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(
        self,
        model_name: str,
        parameters: dict | None = None,
        reason: str | None = None,
        total_epochs: int = 0,
        started_by: UUID | None = None,
        estimated_duration_sec: int | None = None,
    ) -> TrainingRun:
        """Create a new training run record."""
        run = TrainingRun(
            model_name=model_name,
            parameters=parameters,
            reason=reason,
            total_epochs=total_epochs,
            started_by=started_by,
            estimated_duration_sec=estimated_duration_sec,
        )
        self.db.add(run)
        await self.db.commit()
        await self.db.refresh(run)
        return run

    async def get_by_id(self, run_id: UUID) -> Optional[TrainingRun]:
        """Get training run by ID."""
        result = await self.db.execute(
            select(TrainingRun).where(TrainingRun.id == run_id)
        )
        return result.scalar_one_or_none()

    async def get_active_for_model(self, model_name: str) -> Optional[TrainingRun]:
        """Get any active training run for a model (concurrent lock check)."""
        result = await self.db.execute(
            select(TrainingRun).where(
                and_(
                    TrainingRun.model_name == model_name,
                    TrainingRun.status.in_([
                        TrainingStatus.QUEUED.value,
                        TrainingStatus.TRAINING.value,
                        TrainingStatus.EVALUATING.value,
                    ]),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_history(
        self,
        model_name: str | None = None,
        limit: int = 50,
    ) -> list[TrainingRun]:
        """Get training history, optionally filtered by model."""
        query = select(TrainingRun).order_by(TrainingRun.created_at.desc()).limit(limit)
        if model_name:
            query = query.where(TrainingRun.model_name == model_name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_progress(
        self,
        run_id: UUID,
        status: str | None = None,
        progress_pct: int | None = None,
        current_epoch: int | None = None,
        current_loss: float | None = None,
        best_loss: float | None = None,
    ) -> Optional[TrainingRun]:
        """Update training run progress."""
        run = await self.get_by_id(run_id)
        if not run:
            return None

        if status is not None:
            run.status = status
        if progress_pct is not None:
            run.progress_pct = progress_pct
        if current_epoch is not None:
            run.current_epoch = current_epoch
        if current_loss is not None:
            run.current_loss = current_loss
        if best_loss is not None:
            run.best_loss = best_loss

        await self.db.commit()
        await self.db.refresh(run)
        return run
