"""RLModelVersion model - tracks ML model versions and performance."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, DateTime, Boolean, Integer, Numeric, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ModelType:
    """RL model types."""
    STORY_CLASSIFIER = "story_classifier"
    PRIORITY_BANDIT = "priority_bandit"
    SOURCE_CONFIDENCE = "source_confidence"
    ANOMALY_VAE = "anomaly_vae"
    TEMPORAL_EMBEDDER = "temporal_embedder"


class RLModelVersion(Base):
    """Tracks RL model versions and their performance metrics."""

    __tablename__ = "rl_model_versions"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Model identification
    model_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
        comment="story_classifier|priority_bandit|source_confidence|anomaly_vae|temporal_embedder",
    )
    version: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    # Performance metrics
    accuracy: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4),
        nullable=True,
        comment="Model accuracy 0.0000-1.0000",
    )

    # Deployment status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
        comment="Whether this version is currently in use",
    )

    # Storage
    model_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
        comment="Path to serialized model file",
    )

    # Training info
    training_samples: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Number of samples used for training",
    )

    # Additional metadata (column name is 'metadata' in the DB migration)
    # Use model_metadata attribute to avoid SQLAlchemy reserved name collisions.
    model_metadata: Mapped[Optional[dict]] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        comment="Training hyperparameters, metrics, etc.",
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        active = " (active)" if self.is_active else ""
        return f"<RLModelVersion {self.model_type} v{self.version}{active}>"
