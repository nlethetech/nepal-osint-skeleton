"""Team models for collaborative analyst groups."""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING, List
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.case import Case


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class TeamRole(str, Enum):
    """Role within a team."""
    OWNER = "owner"           # Can delete team, manage all
    ADMIN = "admin"           # Can manage members, edit team
    MEMBER = "member"         # Can participate in team activities
    VIEWER = "viewer"         # Read-only access


class Team(Base, TimestampMixin):
    """Analyst team for collaboration."""

    __tablename__ = "teams"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Basic info
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Slug for URLs
    slug: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
        comment="URL-safe identifier",
    )

    # Classification
    specialization: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="threat | economic | political | general",
    )
    is_public: Mapped[bool] = mapped_column(
        default=False,
        comment="Whether team is discoverable",
    )
    is_active: Mapped[bool] = mapped_column(
        default=True,
    )

    # Settings
    settings: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Team configuration",
    )

    # Relationships
    memberships: Mapped[List["TeamMembership"]] = relationship(
        "TeamMembership",
        back_populates="team",
        cascade="all, delete-orphan",
    )
    cases: Mapped[List["Case"]] = relationship(
        "Case",
        back_populates="team",
    )

    def __repr__(self) -> str:
        return f"<Team {self.id}: {self.name}>"


class TeamMembership(Base, TimestampMixin):
    """User membership in a team with role."""

    __tablename__ = "team_memberships"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # References
    team_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    team: Mapped["Team"] = relationship(
        "Team",
        back_populates="memberships",
    )

    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    # Role
    role: Mapped[TeamRole] = mapped_column(
        ENUM(
            TeamRole,
            name="team_role",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=TeamRole.MEMBER,
    )

    # Status
    is_active: Mapped[bool] = mapped_column(
        default=True,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
    )

    # Who invited
    invited_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    invited_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[invited_by_id])

    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_user"),
        Index("idx_team_memberships_user_active", "user_id", "is_active"),
    )

    def __repr__(self) -> str:
        return f"<TeamMembership {self.user_id} in {self.team_id} as {self.role.value}>"
