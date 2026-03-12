"""Graph correction workflow model for investigation graph governance."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, DateTime, Text, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class GraphCorrectionStatus(str, Enum):
    """Workflow states for graph corrections."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ROLLED_BACK = "rolled_back"


class GraphCorrectionAction(str, Enum):
    """Supported graph correction action types."""
    ADD_EDGE = "add_edge"
    DEACTIVATE_EDGE = "deactivate_edge"
    UPDATE_NODE_FIELD = "update_node_field"
    MERGE_NODES = "merge_nodes"
    SPLIT_SUGGESTION = "split_suggestion"
    PREDICATE_CORRECTION = "predicate_correction"


class GraphCorrection(Base, TimestampMixin):
    """Analyst-submitted graph correction proposals with reviewer approval."""

    __tablename__ = "graph_corrections"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=GraphCorrectionStatus.PENDING.value,
        index=True,
    )

    # Optional direct pointers for easier filtering in UI.
    node_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_nodes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    edge_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("graph_edges.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Requested mutation payload and rationale.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # Submission metadata.
    submitted_by: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
        server_default=func.now(),
    )

    # Review metadata.
    reviewed_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Applied mutation metadata for rollback.
    applied_change: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    applied_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rolled_back_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    rolled_back_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rollback_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_graph_corrections_status_submitted", "status", "submitted_at"),
    )

