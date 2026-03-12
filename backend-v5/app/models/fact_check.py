"""Fact-check models — user-requested fact verification system.

Tracks fact-check requests from users (any role) and stores
verification results produced by the local Claude CLI agent.
"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Text, DateTime, Integer, Float, ForeignKey, Index, func,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class FactCheckRequest(Base):
    """A user's request to fact-check a specific story.

    Anti-spam: unique constraint on (story_id, requested_by_id) prevents
    one user from requesting the same story twice.
    """

    __tablename__ = "fact_check_requests"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4,
    )
    story_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    requested_by_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), server_default=func.now(),
    )
    __table_args__ = (
        UniqueConstraint("story_id", "requested_by_id", name="uq_factcheck_story_user"),
        Index("idx_factcheck_req_story", "story_id"),
    )

    def __repr__(self) -> str:
        return f"<FactCheckRequest story={self.story_id} by={self.requested_by_id}>"


class FactCheckResult(Base):
    """Completed fact-check result produced by the local Claude CLI agent.

    One result per story — no double-dipping.
    """

    __tablename__ = "fact_check_results"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4,
    )
    story_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )

    # Verdict
    verdict: Mapped[str] = mapped_column(
        String(30), nullable=False,
        comment="true|false|partially_true|misleading|unverifiable|satire",
    )
    verdict_summary: Mapped[str] = mapped_column(
        Text, nullable=False,
        comment="1-3 sentence plain-language verdict explanation",
    )
    confidence: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.5,
        comment="0.0-1.0 confidence in verdict",
    )

    # Detailed analysis
    claims_analyzed: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
        comment='[{"claim": "...", "verdict": "...", "evidence": "...", "sources": ["..."]}]',
    )
    sources_checked: Mapped[Optional[list]] = mapped_column(
        JSONB, nullable=True,
        comment='[{"url": "...", "title": "...", "relevant_excerpt": "...", "supports": true}]',
    )
    key_finding: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="The most important finding from the fact-check",
    )
    context: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True,
        comment="Important context missing from the original story",
    )

    # Metadata
    request_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1,
        comment="How many users requested this fact-check",
    )
    model_used: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True,
        comment="Claude model used for verification",
    )
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), server_default=func.now(),
        comment="When the fact-check was completed",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=func.now(), server_default=func.now(),
    )
    review: Mapped[Optional["FactCheckReview"]] = relationship(
        "FactCheckReview",
        back_populates="fact_check_result",
        cascade="all, delete-orphan",
        uselist=False,
    )

    __table_args__ = (
        Index("idx_factcheck_result_verdict", "verdict"),
        Index("idx_factcheck_result_checked", "checked_at"),
    )

    def __repr__(self) -> str:
        return f"<FactCheckResult {self.verdict}: story={self.story_id}>"
