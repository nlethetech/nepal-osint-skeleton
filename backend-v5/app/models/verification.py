"""Verification models for peer review and consensus system."""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING, List
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, UniqueConstraint, Integer
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class VerificationStatus(str, Enum):
    """Status of a verification request."""
    PENDING = "pending"             # Awaiting votes
    VERIFIED = "verified"           # Consensus reached - confirmed
    REJECTED = "rejected"           # Consensus reached - rejected
    NEEDS_INFO = "needs_info"       # More information needed
    EXPIRED = "expired"             # Timed out without consensus


class VerifiableType(str, Enum):
    """Type of item being verified."""
    STORY = "story"                 # News story claim
    ENTITY = "entity"               # Entity information
    ENTITY_LINK = "entity_link"     # Entity relationship
    CASE_EVIDENCE = "case_evidence" # Case evidence accuracy
    CLASSIFICATION = "classification"  # Category/severity
    LOCATION = "location"           # Geographic claim


class VoteChoice(str, Enum):
    """Vote choices for verification."""
    AGREE = "agree"                 # Confirms the claim
    DISAGREE = "disagree"           # Disputes the claim
    ABSTAIN = "abstain"             # No opinion
    NEEDS_INFO = "needs_info"       # Cannot verify, need more data


class VerificationRequest(Base, TimestampMixin):
    """Request for community verification of a claim/item."""

    __tablename__ = "verification_requests"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # What's being verified
    item_type: Mapped[VerifiableType] = mapped_column(
        ENUM(
            VerifiableType,
            name="verifiable_type",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )
    item_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
        comment="UUID or ID of the item being verified",
    )

    # The claim/statement being verified
    claim: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="The specific claim to verify",
    )
    context: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Additional context for verification",
    )

    # Evidence provided by requester
    evidence: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Supporting evidence for the claim",
    )
    source_urls: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="URLs supporting the claim",
    )

    # Status
    status: Mapped[VerificationStatus] = mapped_column(
        ENUM(
            VerificationStatus,
            name="verification_status",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=VerificationStatus.PENDING,
        index=True,
    )

    # Threshold settings
    required_votes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=3,
        comment="Minimum votes needed for consensus",
    )
    consensus_threshold: Mapped[float] = mapped_column(
        nullable=False,
        default=0.67,
        comment="Percentage needed (e.g., 0.67 = 2/3)",
    )

    # Priority
    priority: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        default="normal",
        comment="urgent | normal | low",
    )

    # Creator
    requested_by_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requested_by: Mapped["User"] = relationship(
        "User",
        foreign_keys=[requested_by_id],
    )

    # Timing
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When request expires if not resolved",
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When consensus was reached",
    )

    # Result summary
    final_verdict: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="Final determination",
    )
    resolution_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Vote counts (denormalized for efficiency)
    agree_count: Mapped[int] = mapped_column(Integer, default=0)
    disagree_count: Mapped[int] = mapped_column(Integer, default=0)
    abstain_count: Mapped[int] = mapped_column(Integer, default=0)
    needs_info_count: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    votes: Mapped[List["VerificationVote"]] = relationship(
        "VerificationVote",
        back_populates="request",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_verification_item", "item_type", "item_id"),
        Index("idx_verification_status_created", "status", "created_at"),
        Index("idx_verification_pending_priority", "status", "priority", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<VerificationRequest {self.id}: {self.item_type.value}>"

    @property
    def total_votes(self) -> int:
        """Total votes cast (excluding abstain)."""
        return self.agree_count + self.disagree_count

    @property
    def consensus_reached(self) -> bool:
        """Check if consensus threshold is met."""
        if self.total_votes < self.required_votes:
            return False
        if self.total_votes == 0:
            return False
        agreement_ratio = max(self.agree_count, self.disagree_count) / self.total_votes
        return agreement_ratio >= self.consensus_threshold


class VerificationVote(Base, TimestampMixin):
    """Individual vote on a verification request."""

    __tablename__ = "verification_votes"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Request reference
    request_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("verification_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    request: Mapped["VerificationRequest"] = relationship(
        "VerificationRequest",
        back_populates="votes",
    )

    # Voter
    voter_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    voter: Mapped["User"] = relationship("User")

    # Vote
    choice: Mapped[VoteChoice] = mapped_column(
        ENUM(
            VoteChoice,
            name="vote_choice",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
    )

    # Confidence (for weighted voting in future)
    confidence: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="1-5 confidence level",
    )

    # Reasoning
    reasoning: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Why voter chose this option",
    )
    supporting_evidence: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Evidence supporting vote",
    )

    __table_args__ = (
        UniqueConstraint("request_id", "voter_id", name="uq_verification_vote"),
    )

    def __repr__(self) -> str:
        return f"<VerificationVote {self.id}: {self.choice.value}>"
