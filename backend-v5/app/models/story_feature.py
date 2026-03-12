"""StoryFeature model - cached clustering features for stories."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, func, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID, ARRAY
from sqlalchemy import Text, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.story import Story


class StoryFeature(Base):
    """Cached clustering features for a story."""

    __tablename__ = "story_features"

    # Primary key (same as story_id)
    story_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # MinHash signature for content similarity (128 hash values)
    content_minhash: Mapped[Optional[list[int]]] = mapped_column(
        ARRAY(Integer),
        nullable=True,
        comment="128-value MinHash signature for content",
    )

    # Tokenized title for matching
    title_tokens: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment="Tokenized and normalized title words",
    )

    # Geographic entities
    districts: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment="Nepal districts mentioned in story",
    )
    constituencies: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment="Nepal constituencies mentioned in story",
    )

    # Key terms for entity matching
    key_terms: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment="Extracted key terms (names, orgs, etc.)",
    )

    # International locations for blocking
    international_countries: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment="International countries/cities mentioned",
    )

    # Topic classification for hard blocking
    topic: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="Topic classification (election, weather, sports, stock_market, etc.)",
    )

    # Title-specific geographic blocking
    title_district: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Primary Nepal district in title for hard blocking",
    )

    title_country: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Primary international country in title for hard blocking",
    )

    # Named entities for PALANTIR-GRADE entity blocking (CRITICAL)
    # Stories about Oli should NEVER cluster with stories about Karki
    title_entities: Mapped[Optional[list[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
        comment="Canonical named entities in title (e.g., ['oli'], ['karki'])",
    )

    # Action/event type for event-based blocking
    # "Oli's clarification" should NOT cluster with "Oli meets ambassador"
    title_action: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="Canonical action type (meeting, clarification, arrest, etc.)",
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )

    # Relationship
    story: Mapped["Story"] = relationship(
        "Story",
        back_populates="features",
    )

    def __repr__(self) -> str:
        return f"<StoryFeature story_id={self.story_id}>"
