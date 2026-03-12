"""Repository for story embeddings."""
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, text, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.story import Story
from app.models.story_embedding import StoryEmbedding

logger = logging.getLogger(__name__)


class EmbeddingRepository:
    """Repository for story embedding database operations."""

    def __init__(self, db: AsyncSession):
        """Initialize the repository."""
        self.db = db

    async def get_by_story_id(self, story_id: UUID) -> Optional[StoryEmbedding]:
        """Get embedding by story ID."""
        result = await self.db.execute(
            select(StoryEmbedding).where(StoryEmbedding.story_id == story_id)
        )
        return result.scalar_one_or_none()

    async def exists(self, story_id: UUID) -> bool:
        """Check if embedding exists for story."""
        result = await self.db.scalar(
            select(func.count(StoryEmbedding.story_id))
            .where(StoryEmbedding.story_id == story_id)
        )
        return (result or 0) > 0

    async def create(
        self,
        story_id: UUID,
        text_hash: str,
        model_name: str,
        model_version: Optional[str] = None,
        embedding_vector: Optional[List[float]] = None,
    ) -> StoryEmbedding:
        """Create a new embedding record."""
        record = StoryEmbedding(
            story_id=story_id,
            text_hash=text_hash,
            model_name=model_name,
            model_version=model_version,
        )
        self.db.add(record)
        await self.db.flush()

        # Store vector using raw SQL if provided
        if embedding_vector:
            from app.services.embeddings.text_embedder import embedding_to_pgvector_literal
            await self.db.execute(
                text("""
                    UPDATE story_embeddings
                    SET embedding_vector = CAST(:embedding AS vector)
                    WHERE story_id = :story_id
                """),
                {
                    "story_id": story_id,
                    "embedding": embedding_to_pgvector_literal(embedding_vector),
                },
            )

        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def create_or_update(
        self,
        story_id: UUID,
        text_hash: str,
        model_name: str,
        embedding_vector: List[float],
        model_version: Optional[str] = None,
    ) -> None:
        """Create or update embedding using upsert."""
        from app.services.embeddings.text_embedder import embedding_to_pgvector_literal

        await self.db.execute(
            text("""
                INSERT INTO story_embeddings (story_id, text_hash, model_name, model_version, embedding_vector, created_at, updated_at)
                VALUES (:story_id, :text_hash, :model_name, :model_version, CAST(:embedding AS vector), NOW(), NOW())
                ON CONFLICT (story_id) DO UPDATE SET
                    text_hash = EXCLUDED.text_hash,
                    model_name = EXCLUDED.model_name,
                    model_version = EXCLUDED.model_version,
                    embedding_vector = EXCLUDED.embedding_vector,
                    updated_at = NOW()
            """),
            {
                "story_id": story_id,
                "text_hash": text_hash,
                "model_name": model_name,
                "model_version": model_version,
                "embedding": embedding_to_pgvector_literal(embedding_vector),
            },
        )
        await self.db.commit()

    async def search_similar(
        self,
        query_embedding: List[float],
        hours: int = 24,
        top_k: int = 20,
        min_similarity: float = 0.5,
    ) -> List[Tuple[UUID, float]]:
        """
        Search for similar stories using pgvector.

        Args:
            query_embedding: Query embedding vector
            hours: Time window
            top_k: Maximum results
            min_similarity: Minimum similarity threshold

        Returns:
            List of (story_id, similarity) tuples
        """
        from app.services.embeddings.text_embedder import embedding_to_pgvector_literal

        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            text("""
                SELECT
                    se.story_id,
                    1 - (se.embedding_vector <=> CAST(:query AS vector)) as similarity
                FROM story_embeddings se
                JOIN stories s ON s.id = se.story_id
                WHERE s.created_at >= :cutoff
                  AND se.embedding_vector IS NOT NULL
                ORDER BY se.embedding_vector <=> CAST(:query AS vector)
                LIMIT :limit
            """),
            {
                "query": embedding_to_pgvector_literal(query_embedding),
                "cutoff": cutoff,
                "limit": top_k * 2,
            },
        )

        rows = result.fetchall()

        # Filter by minimum similarity
        results = [
            (row[0], float(row[1]))
            for row in rows
            if float(row[1]) >= min_similarity
        ]

        return results[:top_k]

    async def find_similar_to_story(
        self,
        story_id: UUID,
        hours: int = 72,
        top_k: int = 10,
        min_similarity: float = 0.6,
    ) -> List[Tuple[UUID, float]]:
        """
        Find stories similar to a given story.

        Args:
            story_id: Source story ID
            hours: Time window
            top_k: Maximum results
            min_similarity: Minimum similarity

        Returns:
            List of (story_id, similarity) tuples
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            text("""
                WITH source_embedding AS (
                    SELECT embedding_vector
                    FROM story_embeddings
                    WHERE story_id = :story_id
                )
                SELECT
                    se.story_id,
                    1 - (se.embedding_vector <=> (SELECT embedding_vector FROM source_embedding)) as similarity
                FROM story_embeddings se
                JOIN stories s ON s.id = se.story_id
                WHERE s.created_at >= :cutoff
                  AND se.story_id != :story_id
                  AND se.embedding_vector IS NOT NULL
                ORDER BY se.embedding_vector <=> (SELECT embedding_vector FROM source_embedding)
                LIMIT :limit
            """),
            {
                "story_id": story_id,
                "cutoff": cutoff,
                "limit": top_k * 2,
            },
        )

        rows = result.fetchall()

        results = [
            (row[0], float(row[1]))
            for row in rows
            if float(row[1]) >= min_similarity
        ]

        return results[:top_k]

    async def count_total(self) -> int:
        """Get total embedding count."""
        result = await self.db.scalar(
            text("SELECT COUNT(*) FROM story_embeddings WHERE embedding_vector IS NOT NULL")
        )
        return result or 0

    async def count_recent(self, hours: int = 24) -> int:
        """Get count of embeddings in time window."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.scalar(
            text("""
                SELECT COUNT(*)
                FROM story_embeddings se
                JOIN stories s ON s.id = se.story_id
                WHERE se.embedding_vector IS NOT NULL
                  AND s.created_at >= :cutoff
            """),
            {"cutoff": cutoff},
        )
        return result or 0

    async def get_stories_without_embeddings(
        self,
        hours: int = 72,
        limit: int = 500,
        nepal_only: bool = True,
    ) -> List[Story]:
        """Get stories that don't have embeddings yet."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        query = (
            select(Story)
            .outerjoin(StoryEmbedding, Story.id == StoryEmbedding.story_id)
            .where(
                and_(
                    Story.created_at >= cutoff,
                    or_(
                        StoryEmbedding.story_id.is_(None),
                        StoryEmbedding.embedding_vector.is_(None),
                    ),
                )
            )
        )

        if nepal_only:
            query = query.where(
                Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"])
            )

        query = query.limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def delete_old_embeddings(self, days: int = 30) -> int:
        """Delete embeddings older than specified days."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        result = await self.db.execute(
            text("""
                DELETE FROM story_embeddings
                WHERE created_at < :cutoff
            """),
            {"cutoff": cutoff},
        )
        await self.db.commit()
        return result.rowcount or 0
