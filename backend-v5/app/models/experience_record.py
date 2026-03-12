"""ExperienceRecord model - RL feedback from human corrections."""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, Boolean, Numeric, ForeignKey, func, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ExperienceType:
    """Experience record types for RL training."""
    CLASSIFICATION = "CLASSIFICATION"  # Category classification feedback
    PRIORITY = "PRIORITY"              # Priority/severity feedback
    ANOMALY = "ANOMALY"                # Anomaly detection feedback
    SOURCE = "SOURCE"                  # Source reliability feedback
    TEMPORAL = "TEMPORAL"              # Temporal similarity feedback
    CLUSTERING = "CLUSTERING"          # Cluster quality feedback


class ExperienceRecord(Base):
    """
    Experience record for reinforcement learning.

    Stores human feedback on system predictions to train RL models:
    - Story Classifier: category corrections
    - Priority Bandit: priority/severity corrections
    - Source Confidence: source reliability signals
    - Anomaly VAE: anomaly confirmation/rejection
    - Temporal Embedder: temporal clustering feedback
    """

    __tablename__ = "experience_records"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Experience type
    experience_type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        index=True,
        comment="CLASSIFICATION|PRIORITY|ANOMALY|SOURCE|TEMPORAL|CLUSTERING",
    )

    # Related entities (at least one should be set)
    story_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    cluster_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("story_clusters.id", ondelete="SET NULL"),
        nullable=True,
    )
    source_id: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="RSS source ID for source confidence feedback",
    )

    # Context state when prediction was made
    context_features: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Input features used for prediction",
    )

    # Actions
    system_action: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="What the system predicted/did",
    )
    human_action: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Human correction/feedback",
    )

    # Reward signal for RL training
    reward: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(4, 2),
        nullable=True,
        comment="Reward value from -1.0 to 1.0",
    )

    # Training status
    used_in_training: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
        comment="Whether this record has been used in model training",
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        index=True,
    )

    __table_args__ = (
        Index("idx_experience_type_training", "experience_type", "used_in_training"),
    )

    def __repr__(self) -> str:
        return f"<ExperienceRecord {self.id} type={self.experience_type} reward={self.reward}>"

    @classmethod
    def create_classification_feedback(
        cls,
        story_id: UUID,
        system_category: str,
        human_category: str,
        context: Optional[dict] = None,
    ) -> "ExperienceRecord":
        """Create a classification feedback record."""
        # Reward: +1.0 if correct, -1.0 if wrong
        reward = Decimal("1.0") if system_category == human_category else Decimal("-1.0")

        return cls(
            experience_type=ExperienceType.CLASSIFICATION,
            story_id=story_id,
            context_features=context,
            system_action=system_category,
            human_action=human_category,
            reward=reward,
        )

    @classmethod
    def create_priority_feedback(
        cls,
        story_id: UUID,
        system_priority: str,
        human_priority: str,
        context: Optional[dict] = None,
    ) -> "ExperienceRecord":
        """Create a priority feedback record."""
        # Reward based on distance from correct answer
        priority_order = ["low", "medium", "high", "critical"]
        sys_idx = priority_order.index(system_priority) if system_priority in priority_order else 1
        human_idx = priority_order.index(human_priority) if human_priority in priority_order else 1

        # Reward ranges from -1.0 (3 levels off) to +1.0 (exact match)
        diff = abs(sys_idx - human_idx)
        reward = Decimal(str(1.0 - (diff / 1.5)))  # Max diff of 3 gives -1.0

        return cls(
            experience_type=ExperienceType.PRIORITY,
            story_id=story_id,
            context_features=context,
            system_action=system_priority,
            human_action=human_priority,
            reward=reward,
        )

    @classmethod
    def create_source_feedback(
        cls,
        source_id: str,
        is_reliable: bool,
        story_id: Optional[UUID] = None,
        context: Optional[dict] = None,
    ) -> "ExperienceRecord":
        """Create a source reliability feedback record."""
        return cls(
            experience_type=ExperienceType.SOURCE,
            source_id=source_id,
            story_id=story_id,
            context_features=context,
            system_action="unknown",
            human_action="reliable" if is_reliable else "unreliable",
            reward=Decimal("1.0") if is_reliable else Decimal("-1.0"),
        )

    @classmethod
    def create_clustering_feedback(
        cls,
        cluster_id: UUID,
        story_id: UUID,
        should_be_in_cluster: bool,
        context: Optional[dict] = None,
    ) -> "ExperienceRecord":
        """Create a clustering feedback record."""
        return cls(
            experience_type=ExperienceType.CLUSTERING,
            cluster_id=cluster_id,
            story_id=story_id,
            context_features=context,
            system_action="in_cluster",
            human_action="in_cluster" if should_be_in_cluster else "not_in_cluster",
            reward=Decimal("1.0") if should_be_in_cluster else Decimal("-1.0"),
        )
