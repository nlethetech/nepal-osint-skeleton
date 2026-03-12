"""ClusterPublication model - versioned public releases for StoryClusters."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Integer, String, Text, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.story_cluster import StoryCluster
    from app.models.user import User


class ClusterPublication(Base):
    """
    Immutable-ish snapshot of what consumers saw for a published StoryCluster.

    Each publish creates a new version row. The StoryCluster holds the latest display fields
    for fast feed rendering, while ClusterPublication preserves history and citations.
    """

    __tablename__ = "cluster_publications"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    cluster_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("story_clusters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    cluster: Mapped["StoryCluster"] = relationship("StoryCluster")

    version: Mapped[int] = mapped_column(Integer, nullable=False)

    created_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[created_by_id])

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    headline: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    severity: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    customer_brief: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    citations: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="List of citation objects (URLs + source metadata)",
    )
    policy_check: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Publish policy evaluation and warnings",
    )
    change_note: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="What changed in this version (for corrections)",
    )

    __table_args__ = (
        UniqueConstraint("cluster_id", "version", name="uq_cluster_publication_version"),
        Index("idx_cluster_publications_cluster", "cluster_id"),
        Index("idx_cluster_publications_created_at", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<ClusterPublication {self.cluster_id} v{self.version}>"

