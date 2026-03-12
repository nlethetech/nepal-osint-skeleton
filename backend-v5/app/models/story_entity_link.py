"""StoryEntityLink model - links stories to political entities."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Boolean, Integer, Float, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.story import Story
    from app.models.political_entity import PoliticalEntity


class StoryEntityLink(Base):
    """
    Links a story to a political entity.

    This is the many-to-many join table between stories and political_entities.
    Created when a story mentions an entity (detected via title_entities in StoryFeature).
    """

    __tablename__ = "story_entity_links"

    # Primary key
    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )

    # Foreign keys
    story_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entity_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("political_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Link metadata
    is_title_mention: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default="true",
        comment="Whether entity was mentioned in title (vs body only)",
    )
    mention_count: Mapped[int] = mapped_column(
        Integer,
        default=1,
        server_default="1",
        comment="Number of times entity mentioned in story",
    )
    confidence: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True,
        comment="Confidence score of entity extraction (0-1)",
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )

    # Relationships
    story: Mapped["Story"] = relationship(
        "Story",
        backref="entity_links",
    )
    entity: Mapped["PoliticalEntity"] = relationship(
        "PoliticalEntity",
        back_populates="story_links",
    )

    # Constraints
    __table_args__ = (
        UniqueConstraint("story_id", "entity_id", name="uq_story_entity"),
    )

    def __repr__(self) -> str:
        return f"<StoryEntityLink story={self.story_id} entity={self.entity_id}>"
