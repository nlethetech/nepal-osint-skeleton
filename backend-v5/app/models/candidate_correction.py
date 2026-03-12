"""Candidate correction model for data correction workflow."""
from datetime import datetime
from enum import Enum
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import String, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CorrectionStatus(str, Enum):
    """Correction workflow states."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ROLLED_BACK = "rolled_back"


class CandidateCorrection(Base, TimestampMixin):
    """Tracks proposed corrections to candidate data.

    Workflow: Analyst submits → Dev reviews → Approve/Reject
    Approved corrections can be rolled back by Dev.
    """

    __tablename__ = "candidate_corrections"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    candidate_external_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )
    field: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    old_value: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    new_value: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Workflow status
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=CorrectionStatus.PENDING.value,
        index=True,
    )

    # Submission info
    submitted_by: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(),
        server_default=func.now(),
        nullable=False,
    )

    # Review info
    reviewed_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    review_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Rollback info
    rolled_back_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    rolled_back_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )
    rollback_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Bulk upload tracking
    batch_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
    )

    def __repr__(self) -> str:
        return f"<CandidateCorrection {self.candidate_external_id}.{self.field} [{self.status}]>"
