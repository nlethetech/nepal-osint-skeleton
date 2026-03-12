"""StoryEmbedding model - vector embeddings for semantic search."""
from datetime import datetime
from typing import Optional, TYPE_CHECKING
from uuid import UUID

from sqlalchemy import String, DateTime, ForeignKey, LargeBinary, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import UserDefinedType

try:
    from pgvector.sqlalchemy import Vector
except Exception:
    class Vector(UserDefinedType):
        """Fallback type for environments without pgvector installed."""

        cache_ok = True

        def __init__(self, *args, **kwargs):
            super().__init__()

        def get_col_spec(self, **kw):
            return "VECTOR"

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.story import Story


class StoryEmbedding(Base):
    """Vector embedding for a story, used for semantic similarity search."""

    __tablename__ = "story_embeddings"

    # Primary key (same as story_id)
    story_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Embedding data (stored as bytes, used with pgvector)
    embedding: Mapped[Optional[bytes]] = mapped_column(
        LargeBinary,
        nullable=True,
        comment="Raw embedding bytes (backup storage)",
    )

    # Primary vector column used for similarity search (pgvector)
    # NOTE: Keep in sync with Alembic migrations.
    embedding_vector: Mapped[Optional[list[float]]] = mapped_column(
        Vector(1024),
        nullable=True,
        comment="Embedding vector for semantic search (E5-Large, normalized)",
    )

    # Cache validation
    text_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="SHA-256 hash of text used to generate embedding",
    )

    # Model info
    model_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        comment="Model used to generate embedding",
    )
    model_version: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationship
    story: Mapped["Story"] = relationship(
        "Story",
        back_populates="embedding",
    )

    def __repr__(self) -> str:
        return f"<StoryEmbedding story_id={self.story_id} model={self.model_name}>"
