"""Training run model for tracking ML training progress."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, DateTime, Integer, Float, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TrainingStatus(str, Enum):
    """Training run lifecycle states."""
    QUEUED = "queued"
    TRAINING = "training"
    EVALUATING = "evaluating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TrainingRun(Base):
    """Tracks individual ML training runs with progress and metrics.

    Complements RLModelVersion which tracks deployed versions.
    TrainingRun tracks the actual training process itself.
    """

    __tablename__ = "training_runs"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    model_name: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=TrainingStatus.QUEUED.value,
        index=True,
    )

    # Progress tracking
    progress_pct: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    current_epoch: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    total_epochs: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    current_loss: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )
    best_loss: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )

    # Training parameters
    parameters: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )
    reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Results
    result_accuracy: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
    )
    result_metrics: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Timing
    started_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    estimated_duration_sec: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )

    # Model version link
    result_version: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<TrainingRun {self.model_name} [{self.status}] {self.progress_pct}%>"
