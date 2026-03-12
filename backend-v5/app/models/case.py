"""Case models for collaborative intelligence investigations."""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING, List
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.team import Team
    from app.models.story_cluster import StoryCluster


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class CaseStatus(str, Enum):
    """Case investigation status."""
    DRAFT = "draft"           # Initial creation, not yet active
    ACTIVE = "active"         # Under active investigation
    REVIEW = "review"         # Pending peer review
    CLOSED = "closed"         # Investigation complete
    ARCHIVED = "archived"     # Old case, kept for reference


class CasePriority(str, Enum):
    """Case priority level."""
    CRITICAL = "critical"     # Immediate attention required
    HIGH = "high"             # Urgent investigation
    MEDIUM = "medium"         # Standard priority
    LOW = "low"               # When resources allow


class CaseVisibility(str, Enum):
    """Case visibility scope."""
    PUBLIC = "public"         # Visible to all analysts
    TEAM = "team"             # Visible to team members only
    PRIVATE = "private"       # Visible only to creator


class EvidenceType(str, Enum):
    """Type of evidence linked to a case."""
    STORY = "story"           # News story
    ENTITY = "entity"         # KB entity
    DOCUMENT = "document"     # Uploaded document
    LINK = "link"             # External URL
    NOTE = "note"             # Analyst note


class Case(Base, TimestampMixin):
    """Investigation case for collaborative analysis."""

    __tablename__ = "cases"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Basic info
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
        index=True,
    )
    description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Classification
    status: Mapped[CaseStatus] = mapped_column(
        ENUM(
            CaseStatus,
            name="case_status",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=CaseStatus.DRAFT,
        index=True,
    )
    priority: Mapped[CasePriority] = mapped_column(
        ENUM(
            CasePriority,
            name="case_priority",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=CasePriority.MEDIUM,
        index=True,
    )
    visibility: Mapped[CaseVisibility] = mapped_column(
        ENUM(
            CaseVisibility,
            name="case_visibility",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=CaseVisibility.PUBLIC,
        index=True,
    )

    # Category/type
    category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        index=True,
        comment="political | economic | security | disaster | social",
    )
    tags: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Freeform tags for organization",
    )

    # Ownership
    created_by_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by: Mapped["User"] = relationship(
        "User",
        foreign_keys=[created_by_id],
    )

    assigned_to_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_to: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[assigned_to_id],
    )

    # Team ownership (if team-scoped)
    team_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    team: Mapped[Optional["Team"]] = relationship(
        "Team",
        back_populates="cases",
    )

    # Optional: link to an event (StoryCluster) this case supports/publishes to
    linked_cluster_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("story_clusters.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    linked_cluster: Mapped[Optional["StoryCluster"]] = relationship(
        "StoryCluster",
        foreign_keys=[linked_cluster_id],
    )

    # Metadata
    hypothesis: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Working hypothesis for the investigation",
    )
    conclusion: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Final conclusion when case is closed",
    )

    # Timestamps
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When investigation actively started",
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When case was closed",
    )

    # Relationships
    evidence: Mapped[List["CaseEvidence"]] = relationship(
        "CaseEvidence",
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="CaseEvidence.created_at.desc()",
    )
    comments: Mapped[List["CaseComment"]] = relationship(
        "CaseComment",
        back_populates="case",
        cascade="all, delete-orphan",
        order_by="CaseComment.created_at",
    )

    __table_args__ = (
        Index("idx_cases_status_priority", "status", "priority"),
        Index("idx_cases_created_by_status", "created_by_id", "status"),
        Index("idx_cases_team_status", "team_id", "status"),
    )

    def __repr__(self) -> str:
        return f"<Case {self.id}: {self.title[:50]}...>"


class CaseEvidence(Base, TimestampMixin):
    """Evidence linked to a case (stories, entities, documents, links)."""

    __tablename__ = "case_evidence"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Parent case
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    case: Mapped["Case"] = relationship(
        "Case",
        back_populates="evidence",
    )

    # Evidence type and reference
    evidence_type: Mapped[EvidenceType] = mapped_column(
        ENUM(
            EvidenceType,
            name="evidence_type",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )

    # Reference to the actual item (polymorphic via type)
    reference_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        index=True,
        comment="UUID or ID of referenced item",
    )
    reference_url: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="URL for link type evidence",
    )

    # Evidence metadata
    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    summary: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Brief summary of relevance",
    )
    relevance_notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Why this is relevant to the case",
    )

    # Classification
    is_key_evidence: Mapped[bool] = mapped_column(
        default=False,
        comment="Flag for critical evidence",
    )
    confidence: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        comment="confirmed | likely | possible | doubtful",
    )

    # Who added it
    added_by_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    added_by: Mapped["User"] = relationship("User")

    # Raw data for links/notes
    extra_data: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
    )

    __table_args__ = (
        Index("idx_case_evidence_type_ref", "evidence_type", "reference_id"),
    )

    def __repr__(self) -> str:
        return f"<CaseEvidence {self.id}: {self.evidence_type.value}>"


class CaseComment(Base, TimestampMixin):
    """Threaded comments/discussion on a case."""

    __tablename__ = "case_comments"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Parent case
    case_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    case: Mapped["Case"] = relationship(
        "Case",
        back_populates="comments",
    )

    # Threading (replies)
    parent_comment_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("case_comments.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    replies: Mapped[List["CaseComment"]] = relationship(
        "CaseComment",
        back_populates="parent_comment",
        cascade="all, delete-orphan",
    )
    parent_comment: Mapped[Optional["CaseComment"]] = relationship(
        "CaseComment",
        back_populates="replies",
        remote_side=[id],
    )

    # Content
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Author
    author_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author: Mapped["User"] = relationship("User")

    # Mentions (parsed @mentions)
    mentions: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="List of mentioned user IDs",
    )

    # Edit tracking
    is_edited: Mapped[bool] = mapped_column(
        default=False,
    )
    edited_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<CaseComment {self.id} on case {self.case_id}>"
