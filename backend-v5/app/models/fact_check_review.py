"""Human moderation layer for fact-check results."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.fact_check import FactCheckResult
    from app.models.user import User


class FactCheckReview(Base):
    """Developer review state for a raw fact-check result."""

    __tablename__ = "fact_check_reviews"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    fact_check_result_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("fact_check_results.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    workflow_status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="pending_review",
        server_default="pending_review",
        index=True,
    )
    final_verdict: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    final_verdict_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    final_key_finding: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    override_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    needs_rerun: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    rerun_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rerun_requested_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=func.now(), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        onupdate=func.now(),
    )

    fact_check_result: Mapped["FactCheckResult"] = relationship("FactCheckResult", back_populates="review")
    approved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by_id])
    rejected_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[rejected_by_id])
    rerun_requested_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[rerun_requested_by_id])
