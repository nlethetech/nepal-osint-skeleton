"""StoryCluster repository for database operations."""
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.story import Story
from app.models.story_cluster import StoryCluster


class StoryClusterRepository:
    """Repository for StoryCluster database operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, cluster_id: UUID) -> Optional[StoryCluster]:
        """Get cluster by ID with stories loaded."""
        result = await self.db.execute(
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.id == cluster_id)
        )
        return result.scalar_one_or_none()

    async def create(self, cluster: StoryCluster) -> StoryCluster:
        """Create a new cluster."""
        self.db.add(cluster)
        await self.db.commit()
        await self.db.refresh(cluster)
        return cluster

    async def update(self, cluster: StoryCluster) -> StoryCluster:
        """Update a cluster."""
        await self.db.commit()
        await self.db.refresh(cluster)
        return cluster

    async def delete(self, cluster_id: UUID) -> bool:
        """Delete a cluster and unlink its stories."""
        # First unlink stories
        await self.db.execute(
            Story.__table__.update()
            .where(Story.cluster_id == cluster_id)
            .values(cluster_id=None)
        )

        # Delete cluster
        result = await self.db.execute(
            delete(StoryCluster).where(StoryCluster.id == cluster_id)
        )
        await self.db.commit()
        return result.rowcount > 0

    async def list_clusters(
        self,
        hours: int = 72,
        category: Optional[str] = None,
        severity: Optional[str] = None,
        published_only: bool = False,
        limit: int = 100,
    ) -> list[StoryCluster]:
        """List clusters within time window with optional filters.

        Filters by first_published (when stories were actually published)
        not created_at (when cluster record was created).
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        query = (
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.first_published >= cutoff)
        )

        if published_only:
            query = query.where(StoryCluster.is_published == True)  # noqa: E712

        if category:
            query = query.where(StoryCluster.category == category)
        if severity:
            query = query.where(StoryCluster.severity == severity)

        query = (
            query
            .order_by(StoryCluster.last_updated.desc().nullslast())
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_recent(
        self,
        hours: int = 24,
        limit: int = 50,
    ) -> list[StoryCluster]:
        """Get recent clusters with stories (by publication date)."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(StoryCluster)
            .options(selectinload(StoryCluster.stories))
            .where(StoryCluster.first_published >= cutoff)
            .order_by(StoryCluster.first_published.desc().nullslast())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def count_total(self, hours: Optional[int] = None) -> int:
        """Count total clusters, optionally within time window."""
        query = select(func.count(StoryCluster.id))

        if hours:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            query = query.where(StoryCluster.created_at >= cutoff)

        return await self.db.scalar(query) or 0

    async def count_by_category(self, hours: int = 72) -> dict[str, int]:
        """Get cluster count by category within time window."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(StoryCluster.category, func.count(StoryCluster.id))
            .where(
                and_(
                    StoryCluster.created_at >= cutoff,
                    StoryCluster.category.isnot(None),
                )
            )
            .group_by(StoryCluster.category)
        )

        return {row[0]: row[1] for row in result.all()}

    async def count_by_severity(self, hours: int = 72) -> dict[str, int]:
        """Get cluster count by severity within time window."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(StoryCluster.severity, func.count(StoryCluster.id))
            .where(
                and_(
                    StoryCluster.created_at >= cutoff,
                    StoryCluster.severity.isnot(None),
                )
            )
            .group_by(StoryCluster.severity)
        )

        return {row[0]: row[1] for row in result.all()}

    async def delete_old_clusters(self, hours: int = 168) -> int:
        """Delete clusters older than specified hours. Returns count deleted."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Get old cluster IDs
        result = await self.db.execute(
            select(StoryCluster.id)
            .where(StoryCluster.created_at < cutoff)
        )
        old_ids = [row[0] for row in result.all()]

        if not old_ids:
            return 0

        # Unlink stories
        await self.db.execute(
            Story.__table__.update()
            .where(Story.cluster_id.in_(old_ids))
            .values(cluster_id=None)
        )

        # Delete clusters
        result = await self.db.execute(
            delete(StoryCluster).where(StoryCluster.id.in_(old_ids))
        )
        await self.db.commit()
        return result.rowcount

    async def get_unclustered_stories(
        self,
        hours: int = 72,
        limit: int = 100,
    ) -> list[Story]:
        """Get Nepal-relevant stories that are not in any cluster."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(Story)
            .where(
                and_(
                    Story.created_at >= cutoff,
                    Story.cluster_id.is_(None),
                    Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
                )
            )
            .order_by(Story.published_at.desc().nullslast())
            .limit(limit)
        )
        return list(result.scalars().all())
