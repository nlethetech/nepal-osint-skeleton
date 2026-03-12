"""High-level embedding operations service."""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, text, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.story import Story
from app.models.story_embedding import StoryEmbedding
from app.repositories.embedding import EmbeddingRepository
from app.services.embeddings.text_embedder import (
    TextEmbedder,
    get_multilingual_embedder,
    embedding_to_pgvector_literal,
)

logger = logging.getLogger(__name__)

# Thread pool for CPU-bound embedding operations
_embedding_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="embedding")


class EmbeddingService:
    """
    Service for managing story embeddings.

    Handles:
    - Generating embeddings for stories
    - Caching embeddings in the database
    - Semantic similarity search using pgvector
    """

    def __init__(self, db: AsyncSession, embedder: Optional[TextEmbedder] = None):
        """
        Initialize the embedding service.

        Args:
            db: Database session
            embedder: Optional TextEmbedder instance (defaults to singleton)
        """
        self.db = db
        settings = get_settings()
        self.embedder = embedder or get_multilingual_embedder(settings.embedding_model_key)
        self.repo = EmbeddingRepository(db)
        self._db_vector_dim: Optional[int] = None

    async def _get_db_embedding_dim(self) -> Optional[int]:
        """
        Detect the configured pgvector dimension for story_embeddings.embedding_vector.

        Returns None if the column is missing (or pgvector isn't available yet).
        """
        if self._db_vector_dim is not None:
            return self._db_vector_dim

        try:
            result = await self.db.execute(
                text(
                    """
                    SELECT a.atttypmod AS dim
                    FROM pg_attribute a
                    JOIN pg_class c ON c.oid = a.attrelid
                    WHERE c.relname = 'story_embeddings'
                      AND a.attname = 'embedding_vector'
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                    LIMIT 1
                    """
                )
            )
            dim = result.scalar_one_or_none()
            if dim is None or int(dim) <= 0:
                self._db_vector_dim = None
            else:
                self._db_vector_dim = int(dim)
            return self._db_vector_dim
        except Exception:
            # Likely during early migrations or when pgvector isn't installed yet.
            return None

    async def _ensure_embedder_matches_schema(self) -> None:
        """
        Ensure the runtime embedder matches the DB column dimension.

        This prevents hard failures when the configured model key doesn't match the migrated schema.
        """
        dim = await self._get_db_embedding_dim()
        if not dim:
            return

        if getattr(self.embedder, "embedding_dim", None) == dim:
            return

        dim_to_key = {1024: "e5-large", 768: "e5-base", 384: "minilm"}
        fallback_key = dim_to_key.get(dim)
        if not fallback_key:
            logger.warning(
                "story_embeddings.embedding_vector dim=%s does not match embedder dim=%s and has no known fallback",
                dim,
                getattr(self.embedder, "embedding_dim", None),
            )
            return

        logger.warning(
            "Embedding model dim mismatch (db=%s, configured=%s). Falling back to %s for compatibility.",
            dim,
            getattr(self.embedder, "embedding_dim", None),
            fallback_key,
        )
        self.embedder = get_multilingual_embedder(fallback_key)

    def _get_story_text(self, title: str, summary: Optional[str], content: Optional[str]) -> str:
        """
        Combine story fields into text for embedding.

        Prioritizes title and summary for news relevance.
        """
        parts = [title]

        if summary:
            parts.append(summary[:500])  # Limit summary length

        if content:
            # Add some body context (kept short to avoid drowning the headline)
            parts.append(content[:800])

        return " ".join(parts)

    async def ensure_story_embedding(
        self,
        story_id: UUID,
        title: str,
        summary: Optional[str] = None,
        content: Optional[str] = None,
        force: bool = False,
    ) -> Optional[StoryEmbedding]:
        """
        Ensure a story has an up-to-date embedding.

        Checks if embedding exists and matches current content hash.
        If not, generates a new embedding.

        Args:
            story_id: Story UUID
            title: Story title
            summary: Story summary
            content: Story content
            force: If True, regenerate even if cached

        Returns:
            StoryEmbedding record or None if generation failed
        """
        await self._ensure_embedder_matches_schema()
        text = self._get_story_text(title, summary, content)
        text_hash = self.embedder.compute_text_hash(text)

        # Check for existing embedding
        if not force:
            result = await self.db.execute(
                select(StoryEmbedding).where(StoryEmbedding.story_id == story_id)
            )
            existing = result.scalar_one_or_none()

            if existing and existing.text_hash == text_hash and existing.embedding_vector is not None:
                # Embedding is up-to-date and usable
                return existing

        # Generate new embedding (run in thread pool to avoid blocking)
        try:
            loop = asyncio.get_running_loop()
            embedding = await loop.run_in_executor(
                _embedding_executor, self.embedder.embed_text, text
            )

            if not embedding or all(x == 0.0 for x in embedding):
                logger.warning(f"Generated zero embedding for story {story_id}")
                return None

            await self.repo.create_or_update(
                story_id=story_id,
                text_hash=text_hash,
                model_name=self.embedder.model_name,
                model_version=self.embedder.model_version,
                embedding_vector=embedding,
            )
            logger.debug(f"Stored embedding for story {story_id}")
            return await self.repo.get_by_story_id(story_id)

        except Exception as e:
            logger.exception(f"Failed to generate embedding for story {story_id}: {e}")
            await self.db.rollback()
            return None

    async def batch_generate_embeddings(
        self,
        hours: int = 72,
        limit: int = 500,
        nepal_only: bool = True,
    ) -> dict:
        """
        Generate embeddings for stories that don't have them.

        Args:
            hours: Process stories from last N hours
            limit: Maximum number to process
            nepal_only: Only process Nepal-relevant stories

        Returns:
            Stats dict with counts
        """
        await self._ensure_embedder_matches_schema()
        stats = {
            "processed": 0,
            "created": 0,
            "skipped": 0,
            "failed": 0,
        }

        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Find stories without embeddings
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
        stories = result.scalars().all()

        logger.info(f"Found {len(stories)} stories without embeddings")

        if not stories:
            return stats

        # Phase 1: Collect all texts and IDs
        all_texts = []
        all_story_ids = []

        for story in stories:
            stats["processed"] += 1
            text_for_embedding = self._get_story_text(story.title, story.summary, story.content)
            all_texts.append(text_for_embedding)
            all_story_ids.append(story.id)

        # Phase 2: Generate ALL embeddings in thread pool (blocking, but in separate thread)
        loop = asyncio.get_running_loop()
        all_embeddings = await loop.run_in_executor(
            _embedding_executor, self.embedder.embed_texts, all_texts
        )

        # Phase 3: Store all embeddings to database (executemany)
        params = []
        for story_id, text_content, embedding in zip(all_story_ids, all_texts, all_embeddings):
            if all(x == 0.0 for x in embedding):
                stats["failed"] += 1
                continue

            stats["created"] += 1
            params.append(
                {
                    "story_id": story_id,
                    "text_hash": self.embedder.compute_text_hash(text_content),
                    "model_name": self.embedder.model_name,
                    "model_version": self.embedder.model_version,
                    "embedding": embedding_to_pgvector_literal(embedding),
                }
            )

        if params:
            await self.db.execute(
                text(
                    """
                    INSERT INTO story_embeddings (story_id, text_hash, model_name, model_version, embedding_vector, created_at, updated_at)
                    VALUES (:story_id, :text_hash, :model_name, :model_version, CAST(:embedding AS vector), NOW(), NOW())
                    ON CONFLICT (story_id) DO UPDATE SET
                        text_hash = EXCLUDED.text_hash,
                        model_name = EXCLUDED.model_name,
                        model_version = EXCLUDED.model_version,
                        embedding_vector = EXCLUDED.embedding_vector,
                        updated_at = NOW()
                    """
                ),
                params,
            )
            await self.db.commit()

        logger.info(
            f"Embedding batch complete: {stats['created']} created, {stats['failed']} failed"
        )

        return stats

    async def search_similar(
        self,
        query_text: str,
        hours: int = 24,
        top_k: int = 20,
        min_similarity: float = 0.5,
    ) -> List[Tuple[UUID, float]]:
        """
        Search for similar stories using semantic similarity.

        Args:
            query_text: Text to find similar stories for
            hours: Search within last N hours
            top_k: Return top K results
            min_similarity: Minimum similarity threshold

        Returns:
            List of (story_id, similarity_score) tuples
        """
        await self._ensure_embedder_matches_schema()
        # Generate embedding for query (run in thread pool)
        loop = asyncio.get_running_loop()
        query_embedding = await loop.run_in_executor(
            _embedding_executor, lambda: self.embedder.embed_text(query_text, is_query=True)
        )

        if all(x == 0.0 for x in query_embedding):
            return []

        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        query_embedding_literal = embedding_to_pgvector_literal(query_embedding)

        # Use pgvector cosine similarity search
        result = await self.db.execute(
            text(
                """
                SELECT
                    se.story_id,
                    1 - (se.embedding_vector <=> CAST(:query AS vector)) as similarity
                FROM story_embeddings se
                JOIN stories s ON s.id = se.story_id
                WHERE s.created_at >= :cutoff
                  AND se.embedding_vector IS NOT NULL
                ORDER BY se.embedding_vector <=> CAST(:query AS vector)
                LIMIT :limit
                """
            ),
            {
                "cutoff": cutoff,
                "query": query_embedding_literal,
                "limit": top_k * 2,  # Fetch extra to filter by threshold
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
            story_id: Source story UUID
            hours: Search within last N hours
            top_k: Return top K results (excluding the source story)
            min_similarity: Minimum similarity threshold

        Returns:
            List of (story_id, similarity_score) tuples
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Get similar stories using the stored embedding
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

        # Filter by minimum similarity
        results = [
            (row[0], float(row[1]))
            for row in rows
            if float(row[1]) >= min_similarity
        ]

        return results[:top_k]

    async def get_embedding_stats(self) -> dict:
        """Get statistics about embeddings in the database."""
        total = await self.db.scalar(
            text("SELECT COUNT(*) FROM story_embeddings WHERE embedding_vector IS NOT NULL")
        )

        recent = await self.db.scalar(
            text("""
                SELECT COUNT(*)
                FROM story_embeddings se
                JOIN stories s ON s.id = se.story_id
                WHERE se.embedding_vector IS NOT NULL
                  AND s.created_at >= NOW() - INTERVAL '24 hours'
            """)
        )

        return {
            "total_embeddings": total or 0,
            "recent_24h": recent or 0,
            "model": self.embedder.model_name,
            "embedding_dim": self.embedder.embedding_dim,
        }
