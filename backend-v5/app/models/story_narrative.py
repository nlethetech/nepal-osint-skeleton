"""Story narrative models for slower-moving strategic tracker outputs."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, Float, Integer, ForeignKey, UniqueConstraint, Index, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.story_cluster import StoryCluster
    from app.models.user import User


class StoryNarrative(Base):
    """Persisted narrative record spanning multiple event clusters."""

    __tablename__ = "story_narratives"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    category: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    thesis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    direction: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    momentum_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cluster_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    lead_regions: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)
    lead_entities: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    workflow_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="approved",
        server_default="approved",
        index=True,
    )
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    rejected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_updated: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now(), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        onupdate=func.now(),
    )

    cluster_links: Mapped[list["StoryNarrativeCluster"]] = relationship(
        "StoryNarrativeCluster",
        back_populates="narrative",
        cascade="all, delete-orphan",
    )
    approved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by_id])
    rejected_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[rejected_by_id])


class StoryNarrativeCluster(Base):
    """Join table linking narratives to constituent clusters."""

    __tablename__ = "story_narrative_clusters"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    narrative_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("story_narratives.id", ondelete="CASCADE"),
        nullable=False,
    )
    cluster_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("story_clusters.id", ondelete="CASCADE"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    similarity_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now(), server_default=func.now())

    narrative: Mapped["StoryNarrative"] = relationship("StoryNarrative", back_populates="cluster_links")
    cluster: Mapped["StoryCluster"] = relationship("StoryCluster")

    __table_args__ = (
        UniqueConstraint("narrative_id", "cluster_id", name="uq_story_narrative_cluster"),
        Index("idx_story_narrative_clusters_narrative", "narrative_id"),
        Index("idx_story_narrative_clusters_cluster", "cluster_id"),
    )
