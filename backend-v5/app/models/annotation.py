"""Annotation and AnalystNote models for collaborative intelligence."""
from datetime import datetime
from enum import Enum
from typing import Optional, TYPE_CHECKING, List
from uuid import UUID, uuid4

from sqlalchemy import String, Text, DateTime, ForeignKey, Index, Boolean
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


def _enum_values(enum_cls):
    return [e.value for e in enum_cls]


class AnnotationType(str, Enum):
    """Type of annotation."""
    HIGHLIGHT = "highlight"           # Text highlight
    COMMENT = "comment"               # Inline comment
    TAG = "tag"                       # Classification tag
    CORRECTION = "correction"         # Factual correction
    LINK = "link"                     # Link to related item
    FLAG = "flag"                     # Flag for attention


class AnnotatableType(str, Enum):
    """Type of item being annotated."""
    STORY = "story"
    ENTITY = "entity"
    DOCUMENT = "document"
    CASE = "case"


class NoteVisibility(str, Enum):
    """Who can see the note."""
    PRIVATE = "private"       # Only creator
    TEAM = "team"             # Team members
    PUBLIC = "public"         # All analysts


class Annotation(Base, TimestampMixin):
    """Annotation on a story, entity, or document."""

    __tablename__ = "annotations"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # What's being annotated
    target_type: Mapped[AnnotatableType] = mapped_column(
        ENUM(
            AnnotatableType,
            name="annotatable_type",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )
    target_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    # Annotation type
    annotation_type: Mapped[AnnotationType] = mapped_column(
        ENUM(
            AnnotationType,
            name="annotation_type",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        index=True,
    )

    # Content
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Position (for text highlights)
    start_offset: Mapped[Optional[int]] = mapped_column(
        nullable=True,
        comment="Character offset where annotation starts",
    )
    end_offset: Mapped[Optional[int]] = mapped_column(
        nullable=True,
        comment="Character offset where annotation ends",
    )
    selected_text: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="The text that was highlighted",
    )

    # Link target (for LINK type)
    linked_type: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    linked_id: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    # Tags (for TAG type)
    tags: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Author
    author_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author: Mapped["User"] = relationship("User", foreign_keys=[author_id])

    # Visibility
    visibility: Mapped[NoteVisibility] = mapped_column(
        ENUM(
            NoteVisibility,
            name="note_visibility",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=NoteVisibility.PUBLIC,
    )

    # Team context
    team_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Moderation
    is_resolved: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        comment="For corrections/flags - marked resolved",
    )
    resolved_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolved_by: Mapped[Optional["User"]] = relationship("User", foreign_keys=[resolved_by_id])
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_annotation_target", "target_type", "target_id"),
        Index("idx_annotation_author", "author_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Annotation {self.id}: {self.annotation_type.value}>"


class AnalystNote(Base, TimestampMixin):
    """Personal/shared notepad for analysts."""

    __tablename__ = "analyst_notes"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Basic info
    title: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        index=True,
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    # Classification
    category: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="quick | research | hypothesis | todo | reference",
    )
    tags: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
    )

    # Linked items
    linked_items: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Array of {type, id} objects",
    )

    # Case association (optional)
    case_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("cases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Author
    author_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author: Mapped["User"] = relationship("User")

    # Visibility
    visibility: Mapped[NoteVisibility] = mapped_column(
        ENUM(
            NoteVisibility,
            name="note_visibility",
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=NoteVisibility.PRIVATE,
    )

    # Team context
    team_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Pinned notes appear at top
    is_pinned: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )

    # Archive instead of delete
    is_archived: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        index=True,
    )

    # Mentions
    mentions: Mapped[Optional[list]] = mapped_column(
        JSONB,
        nullable=True,
        comment="User IDs mentioned in note",
    )

    __table_args__ = (
        Index("idx_note_author_archived", "author_id", "is_archived"),
        Index("idx_note_team_archived", "team_id", "is_archived"),
        Index("idx_note_case", "case_id"),
    )

    def __repr__(self) -> str:
        title = self.title or self.content[:30]
        return f"<AnalystNote {self.id}: {title}...>"


class SourceReliability(Base, TimestampMixin):
    """Source reliability rating using Admiralty System."""

    __tablename__ = "source_reliability"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Source identification
    source_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
        comment="RSS source ID or URL domain",
    )
    source_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        comment="rss | social | government | wire | blog",
    )

    # Admiralty rating (A-F for reliability, 1-6 for credibility)
    reliability_rating: Mapped[str] = mapped_column(
        String(1),
        nullable=False,
        default="E",
        comment="A=Completely reliable, B=Usually reliable, C=Fairly reliable, D=Not usually reliable, E=Unreliable, F=Cannot be judged",
    )
    credibility_rating: Mapped[int] = mapped_column(
        nullable=False,
        default=5,
        comment="1=Confirmed, 2=Probably true, 3=Possibly true, 4=Doubtful, 5=Improbable, 6=Cannot be judged",
    )

    # Composite confidence (0-100)
    confidence_score: Mapped[int] = mapped_column(
        nullable=False,
        default=50,
    )

    # Statistics
    total_stories: Mapped[int] = mapped_column(default=0)
    verified_true: Mapped[int] = mapped_column(default=0)
    verified_false: Mapped[int] = mapped_column(default=0)
    corrections_needed: Mapped[int] = mapped_column(default=0)

    # Community ratings
    total_ratings: Mapped[int] = mapped_column(default=0)
    average_user_rating: Mapped[Optional[float]] = mapped_column(
        nullable=True,
        comment="Average of user ratings (1-5)",
    )

    # Notes
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )

    # Last updated by
    last_rated_by_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    last_rated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    __table_args__ = (
        Index("idx_source_reliability_rating", "reliability_rating", "confidence_score"),
    )

    def __repr__(self) -> str:
        return f"<SourceReliability {self.source_id}: {self.reliability_rating}{self.credibility_rating}>"

    @property
    def admiralty_code(self) -> str:
        """Return the combined Admiralty code (e.g., 'B2')."""
        return f"{self.reliability_rating}{self.credibility_rating}"
