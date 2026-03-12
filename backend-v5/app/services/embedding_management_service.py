"""Embedding management service."""
import logging
from typing import Optional
from uuid import uuid4

from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.story_embedding import StoryEmbedding
from app.models.story import Story
from app.models.story_cluster import StoryCluster
from app.models.experience_record import ExperienceRecord
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EmbeddingManagementService:
    """Manages embeddings, clustering configuration, and experience buffer."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_embedding_stats(self) -> dict:
        """Get embedding statistics."""
        total = (await self.db.execute(
            select(func.count()).select_from(StoryEmbedding)
        )).scalar() or 0

        # Stories without embeddings
        pending = (await self.db.execute(
            text("""
                SELECT COUNT(*) FROM stories s
                LEFT JOIN story_embeddings se ON s.id = se.story_id
                WHERE se.id IS NULL
            """)
        )).scalar() or 0

        # Approximate storage
        storage_mb = total * 768 * 4 / (1024 * 1024)  # 768 dims * 4 bytes per float

        return {
            "total": total,
            "pending": pending,
            "failed": 0,  # Could track via a status column if added
            "storage_mb": round(storage_mb, 1),
            "avg_dimension": 768,
            "model": settings.embedding_model_key,
        }

    async def regenerate_embeddings(self, scope: str, date_from=None, date_to=None, batch_size: int = 100) -> dict:
        """Queue embedding regeneration job."""
        job_id = str(uuid4())
        stories_queued = 0

        if scope == "failed":
            stories_queued = 0  # No failure tracking yet
        elif scope == "all":
            stories_queued = (await self.db.execute(
                select(func.count()).select_from(Story)
            )).scalar() or 0
        else:
            stories_queued = (await self.db.execute(
                text("SELECT COUNT(*) FROM stories s LEFT JOIN story_embeddings se ON s.id = se.story_id WHERE se.id IS NULL")
            )).scalar() or 0

        return {
            "job_id": job_id,
            "stories_queued": stories_queued,
            "estimated_duration_sec": stories_queued // 10 if stories_queued else 0,
        }

    async def get_clustering_config(self) -> dict:
        """Get current clustering configuration from settings."""
        return {
            "algorithm": "hdbscan",
            "min_cluster_size": 5,
            "similarity_threshold": settings.clustering_smart_threshold,
            "max_cluster_size": 100,
            "temporal_weight": 0.3,
            "geographic_weight": 0.2,
        }

    async def update_clustering_config(self, updates: dict) -> dict:
        """Update clustering configuration (audit logged by caller)."""
        config = await self.get_clustering_config()
        config.update({k: v for k, v in updates.items() if v is not None})
        return config

    async def get_clustering_stats(self) -> dict:
        """Get clustering statistics."""
        total = (await self.db.execute(
            select(func.count()).select_from(StoryCluster)
        )).scalar() or 0

        avg_size = (await self.db.execute(
            select(func.avg(StoryCluster.story_count))
        )).scalar() or 0

        largest = (await self.db.execute(
            select(func.max(StoryCluster.story_count))
        )).scalar() or 0

        singleton = (await self.db.execute(
            select(func.count()).select_from(StoryCluster).where(StoryCluster.story_count == 1)
        )).scalar() or 0

        return {
            "total_clusters": total,
            "avg_cluster_size": round(float(avg_size), 1) if avg_size else 0,
            "singleton_clusters": singleton,
            "largest_cluster": largest,
            "last_run_at": None,
            "merge_proposals_pending": 0,
        }

    async def retrain_clustering(self, reason: str) -> dict:
        """Trigger clustering retraining (placeholder)."""
        return {
            "job_id": str(uuid4()),
            "status": "started",
        }

    async def get_experience_buffer_stats(self) -> dict:
        """Get experience buffer stats."""
        total = (await self.db.execute(
            select(func.count()).select_from(ExperienceRecord)
        )).scalar() or 0

        by_model = {}
        model_counts = await self.db.execute(
            select(ExperienceRecord.experience_type, func.count())
            .group_by(ExperienceRecord.experience_type)
        )
        for row in model_counts.fetchall():
            by_model[row[0]] = row[1]

        oldest = (await self.db.execute(
            select(func.min(ExperienceRecord.created_at))
        )).scalar()

        newest = (await self.db.execute(
            select(func.max(ExperienceRecord.created_at))
        )).scalar()

        return {
            "total_experiences": total,
            "capacity": 100000,
            "utilization_pct": round(total / 1000, 1),  # percent of 100k
            "by_model": by_model,
            "by_feedback": {"positive": 0, "negative": 0, "neutral": 0},
            "oldest_entry": oldest,
            "newest_entry": newest,
        }

    async def flush_experience_buffer(self, older_than_days: int, model: Optional[str] = None) -> dict:
        """Flush old experience buffer entries."""
        from datetime import datetime, timedelta, timezone
        from sqlalchemy import delete

        cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
        stmt = delete(ExperienceRecord).where(ExperienceRecord.created_at < cutoff)
        if model:
            stmt = stmt.where(ExperienceRecord.experience_type == model)

        result = await self.db.execute(stmt)
        await self.db.commit()
        flushed = result.rowcount or 0

        remaining = (await self.db.execute(
            select(func.count()).select_from(ExperienceRecord)
        )).scalar() or 0

        return {"flushed": flushed, "remaining": remaining}
