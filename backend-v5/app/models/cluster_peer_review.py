"""Peer review model for published StoryClusters."""

from __future__ import annotations

from enum import Enum
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Text, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.story_cluster import StoryCluster
    from app.models.user import User


class PeerReviewVerdict(str, Enum):
    AGREE = "agree"
    NEEDS_CORRECTION = "needs_correction"
    DISPUTE = "dispute"


class ClusterPeerReview(Base, TimestampMixin):
    """Single peer review verdict per reviewer per cluster (updatable)."""

    __tablename__ = "cluster_peer_reviews"

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

    reviewer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reviewer: Mapped["User"] = relationship("User", foreign_keys=[reviewer_id])

    verdict: Mapped[PeerReviewVerdict] = mapped_column(
        ENUM(
            PeerReviewVerdict,
            name="peer_review_verdict",
            create_type=False,
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        index=True,
    )

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("cluster_id", "reviewer_id", name="uq_cluster_peer_review_reviewer"),
        Index("idx_cluster_peer_reviews_cluster", "cluster_id"),
        Index("idx_cluster_peer_reviews_verdict", "verdict"),
    )

    def __repr__(self) -> str:
        return f"<ClusterPeerReview {self.cluster_id} {self.reviewer_id} {self.verdict}>"
