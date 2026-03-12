"""Analyst metrics and activity tracking models."""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, Integer, Float
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class ActivityType(str, Enum):
    """Type of analyst activity."""
    # Case activities
    CASE_CREATED = "case_created"
    CASE_UPDATED = "case_updated"
    CASE_CLOSED = "case_closed"
    EVIDENCE_ADDED = "evidence_added"
    CASE_COMMENT = "case_comment"

    # Verification activities
    VERIFICATION_REQUESTED = "verification_requested"
    VERIFICATION_VOTED = "verification_voted"
    VERIFICATION_RESOLVED = "verification_resolved"

    # Entity activities
    ENTITY_CREATED = "entity_created"
    ENTITY_UPDATED = "entity_updated"
    ENTITY_LINKED = "entity_linked"

    # Story activities
    STORY_ANNOTATED = "story_annotated"
    STORY_CATEGORIZED = "story_categorized"
    STORY_FLAGGED = "story_flagged"

    # Collaboration
    MENTION_SENT = "mention_sent"
    MENTION_RECEIVED = "mention_received"
    TEAM_JOINED = "team_joined"

    # Watchlist
    WATCHLIST_CREATED = "watchlist_created"
    WATCHLIST_MATCH = "watchlist_match"

    # Notes
    NOTE_CREATED = "note_created"

    # System
    LOGIN = "login"


class BadgeType(str, Enum):
    """Achievement badges for gamification."""
    # Accuracy badges
    ACCURACY_BRONZE = "accuracy_bronze"     # 70%+ verification accuracy
    ACCURACY_SILVER = "accuracy_silver"     # 80%+ verification accuracy
    ACCURACY_GOLD = "accuracy_gold"         # 90%+ verification accuracy

    # Volume badges
    CASES_10 = "cases_10"                   # 10 cases created
    CASES_50 = "cases_50"                   # 50 cases created
    CASES_100 = "cases_100"                 # 100 cases created

    # Verification badges
    VERIFIER_BRONZE = "verifier_bronze"     # 25 verifications
    VERIFIER_SILVER = "verifier_silver"     # 100 verifications
    VERIFIER_GOLD = "verifier_gold"         # 500 verifications

    # Collaboration badges
    COLLABORATOR = "collaborator"           # Joined a team
    TEAM_LEADER = "team_leader"             # Led 5+ cases
    MENTOR = "mentor"                       # Helped train others

    # Specialization badges
    THREAT_EXPERT = "threat_expert"         # Security specialist
    ECONOMIC_EXPERT = "economic_expert"     # Trade/economic specialist
    POLITICAL_EXPERT = "political_expert"   # Political analyst

    # Streak badges
    STREAK_7 = "streak_7"                   # 7-day activity streak
    STREAK_30 = "streak_30"                 # 30-day activity streak
    STREAK_100 = "streak_100"               # 100-day activity streak


class AnalystMetrics(Base, TimestampMixin):
    """Aggregated metrics for an analyst's performance."""

    __tablename__ = "analyst_metrics"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # User reference (one-to-one)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    user: Mapped["User"] = relationship("User")

    # Activity counts
    total_cases: Mapped[int] = mapped_column(Integer, default=0)
    cases_closed: Mapped[int] = mapped_column(Integer, default=0)
    evidence_added: Mapped[int] = mapped_column(Integer, default=0)
    comments_posted: Mapped[int] = mapped_column(Integer, default=0)

    # Verification metrics
    verifications_requested: Mapped[int] = mapped_column(Integer, default=0)
    verifications_voted: Mapped[int] = mapped_column(Integer, default=0)
    verifications_correct: Mapped[int] = mapped_column(Integer, default=0)
    verification_accuracy: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Percentage of correct verifications",
    )

    # Entity contributions
    entities_created: Mapped[int] = mapped_column(Integer, default=0)
    entities_updated: Mapped[int] = mapped_column(Integer, default=0)
    entity_links_created: Mapped[int] = mapped_column(Integer, default=0)

    # Annotations
    stories_annotated: Mapped[int] = mapped_column(Integer, default=0)
    notes_created: Mapped[int] = mapped_column(Integer, default=0)

    # Collaboration
    mentions_sent: Mapped[int] = mapped_column(Integer, default=0)
    mentions_received: Mapped[int] = mapped_column(Integer, default=0)

    # Time tracking
    active_days: Mapped[int] = mapped_column(Integer, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_active_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Badges earned
    badges: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        default=list,
        comment="List of earned badge types",
    )

    # Reputation score (calculated)
    reputation_score: Mapped[int] = mapped_column(
        Integer,
        default=0,
        comment="Composite reputation score",
    )

    # Specialization scores (0-100)
    threat_score: Mapped[int] = mapped_column(Integer, default=0)
    economic_score: Mapped[int] = mapped_column(Integer, default=0)
    political_score: Mapped[int] = mapped_column(Integer, default=0)

    # Last calculation
    calculated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_analyst_metrics_reputation", "reputation_score"),
        Index("idx_analyst_metrics_accuracy", "verification_accuracy"),
    )

    def __repr__(self) -> str:
        return f"<AnalystMetrics for user {self.user_id}>"


class AnalystActivity(Base):
    """Individual activity log entry for an analyst."""

    __tablename__ = "analyst_activities"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # User reference
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user: Mapped["User"] = relationship("User")

    # Activity type
    activity_type: Mapped[ActivityType] = mapped_column(
        ENUM(
            ActivityType,
            name="activity_type",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )

    # What was affected
    target_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="case | story | entity | verification | etc",
    )
    target_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
    )

    # Description
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Additional data
    extra_data: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Visibility (for activity feed filtering)
    is_public: Mapped[bool] = mapped_column(
        default=True,
        comment="Show in public activity feed",
    )

    # Team context
    team_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Mentions
    mentioned_user_ids: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="User IDs mentioned in this activity",
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
        index=True,
    )

    __table_args__ = (
        Index("idx_activity_user_created", "user_id", "created_at"),
        Index("idx_activity_team_created", "team_id", "created_at"),
        Index("idx_activity_type_created", "activity_type", "created_at"),
        Index("idx_activity_target", "target_type", "target_id"),
    )

    def __repr__(self) -> str:
        return f"<AnalystActivity {self.id}: {self.activity_type.value}>"
