"""AnalysisBatch model - tracks Anthropic batch API requests."""
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, Integer, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class BatchStatus:
    """Status values for analysis batches."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class AnalysisBatch(Base):
    """Tracks Anthropic batch API requests for cluster analysis."""

    __tablename__ = "analysis_batches"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Anthropic batch ID
    anthropic_batch_id: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        index=True,
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=BatchStatus.PENDING,
        index=True,
        comment="pending|processing|completed|failed",
    )

    # Clusters in this batch
    cluster_ids: Mapped[list[UUID]] = mapped_column(
        ARRAY(PGUUID(as_uuid=True)),
        nullable=False,
    )

    # Progress tracking
    total_clusters: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    completed_clusters: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )

    # Error handling
    error_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<AnalysisBatch {self.anthropic_batch_id} status={self.status} {self.completed_clusters}/{self.total_clusters}>"

    @property
    def progress_percent(self) -> float:
        """Get completion percentage."""
        if self.total_clusters == 0:
            return 0.0
        return (self.completed_clusters / self.total_clusters) * 100

    @property
    def is_complete(self) -> bool:
        """Check if batch is complete."""
        return self.status in (BatchStatus.COMPLETED, BatchStatus.FAILED)
