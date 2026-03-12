"""Resolved projection of approved candidate profile overrides."""
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class CandidateProfileOverride(Base):
    """Current-state override projection for candidate profile fields.

    This table is a fast read index. The immutable audit trail remains in
    candidate_corrections.
    """

    __tablename__ = "candidate_profile_overrides"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    candidate_external_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )
    field: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    value: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    source_correction_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("candidate_corrections.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=func.now(),
        server_default=func.now(),
        onupdate=func.now(),
    )
    updated_by: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
    )

    __table_args__ = (
        Index(
            "idx_candidate_profile_overrides_candidate_field",
            "candidate_external_id",
            "field",
            unique=True,
        ),
        Index("idx_candidate_profile_overrides_active", "is_active"),
    )

