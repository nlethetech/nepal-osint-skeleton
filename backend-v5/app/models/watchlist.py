"""Watchlist models for entity and keyword monitoring."""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING, List
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, UniqueConstraint, Integer, Boolean
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.team import Team


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class WatchlistScope(str, Enum):
    """Who can see/use the watchlist."""
    PERSONAL = "personal"     # Only creator
    TEAM = "team"             # Team members
    PUBLIC = "public"         # All analysts


class WatchableType(str, Enum):
    """Type of item being watched."""
    ENTITY = "entity"               # KB entity
    KEYWORD = "keyword"             # Text pattern
    LOCATION = "location"           # Geographic area
    ORGANIZATION = "organization"   # Organization name
    PERSON = "person"               # Person name
    TOPIC = "topic"                 # Topic/theme


class AlertFrequency(str, Enum):
    """How often to send alerts."""
    REALTIME = "realtime"     # Immediate notification
    HOURLY = "hourly"         # Batch every hour
    DAILY = "daily"           # Daily digest
    WEEKLY = "weekly"         # Weekly summary


class Watchlist(Base, TimestampMixin):
    """Collection of monitored entities/keywords."""

    __tablename__ = "watchlists"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Basic info
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Scope
    scope: Mapped[WatchlistScope] = mapped_column(
        ENUM(
            WatchlistScope,
            name="watchlist_scope",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=WatchlistScope.PERSONAL,
        index=True,
    )

    # Alert settings
    alert_frequency: Mapped[AlertFrequency] = mapped_column(
        ENUM(
            AlertFrequency,
            name="alert_frequency",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=AlertFrequency.DAILY,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
    )

    # Filters
    min_relevance_score: Mapped[Optional[float]] = mapped_column(
        nullable=True,
        comment="Minimum relevance score (0-1) for alerts",
    )
    categories_filter: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Filter by story categories",
    )

    # Ownership
    owner_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner: Mapped["User"] = relationship("User")

    # Team (if team-scoped)
    team_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Last activity
    last_match_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last time a match was found",
    )
    last_alert_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last time alert was sent",
    )

    # Stats
    total_matches: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )

    # Relationships
    items: Mapped[List["WatchlistItem"]] = relationship(
        "WatchlistItem",
        back_populates="watchlist",
        cascade="all, delete-orphan",
    )
    matches: Mapped[List["WatchlistMatch"]] = relationship(
        "WatchlistMatch",
        back_populates="watchlist",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("idx_watchlist_owner_active", "owner_id", "is_active"),
        Index("idx_watchlist_team_active", "team_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<Watchlist {self.id}: {self.name}>"


class WatchlistItem(Base, TimestampMixin):
    """Individual item being watched in a watchlist."""

    __tablename__ = "watchlist_items"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Parent watchlist
    watchlist_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("watchlists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    watchlist: Mapped["Watchlist"] = relationship(
        "Watchlist",
        back_populates="items",
    )

    # What's being watched
    item_type: Mapped[WatchableType] = mapped_column(
        ENUM(
            WatchableType,
            name="watchable_type",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )

    # Reference (for entity type)
    reference_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
        comment="KB entity ID if watching an entity",
    )

    # Value (for keyword/name types)
    value: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        index=True,
        comment="Keyword, name, or pattern to match",
    )
    aliases: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Alternative names/spellings to match",
    )

    # Matching options
    case_sensitive: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )
    exact_match: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        comment="Require exact match vs contains",
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Why this is being watched",
    )

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
    )

    # Stats
    match_count: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )
    last_match_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_watchlist_item_type_value", "item_type", "value"),
        UniqueConstraint("watchlist_id", "item_type", "value", name="uq_watchlist_item"),
    )

    def __repr__(self) -> str:
        return f"<WatchlistItem {self.id}: {self.item_type.value} - {self.value}>"


class WatchlistMatch(Base, TimestampMixin):
    """Record of a watchlist item match."""

    __tablename__ = "watchlist_matches"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # References
    watchlist_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("watchlists.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    watchlist: Mapped["Watchlist"] = relationship(
        "Watchlist",
        back_populates="matches",
    )

    item_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("watchlist_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What matched
    matched_story_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        nullable=True,
        index=True,
        comment="Story that matched",
    )
    matched_text: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="The text that matched",
    )
    match_context: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Surrounding context",
    )

    # Match quality
    relevance_score: Mapped[Optional[float]] = mapped_column(
        nullable=True,
        comment="How relevant the match is (0-1)",
    )

    # Alert tracking
    is_alerted: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )
    alerted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # User interaction
    is_dismissed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )
    dismissed_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_watchlist_match_story", "matched_story_id"),
        Index("idx_watchlist_match_alert", "watchlist_id", "is_alerted"),
    )

    def __repr__(self) -> str:
        return f"<WatchlistMatch {self.id}>"
