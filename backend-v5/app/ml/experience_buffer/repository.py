"""Repository for experience records used in RL training."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.experience_record import ExperienceRecord, ExperienceType

logger = logging.getLogger(__name__)


class ExperienceRepository:
    """
    Repository for managing RL experience records.

    Provides methods for:
    - Storing human feedback
    - Retrieving training batches
    - Tracking training usage
    - Computing experience statistics
    """

    def __init__(self, db: AsyncSession):
        """Initialize the repository."""
        self.db = db

    async def create(self, record: ExperienceRecord) -> ExperienceRecord:
        """Create a new experience record."""
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def create_classification_feedback(
        self,
        story_id: UUID,
        system_category: str,
        human_category: str,
        context: Optional[Dict] = None,
    ) -> ExperienceRecord:
        """Create classification feedback record."""
        record = ExperienceRecord.create_classification_feedback(
            story_id=story_id,
            system_category=system_category,
            human_category=human_category,
            context=context,
        )
        return await self.create(record)

    async def create_priority_feedback(
        self,
        story_id: UUID,
        system_priority: str,
        human_priority: str,
        context: Optional[Dict] = None,
    ) -> ExperienceRecord:
        """Create priority feedback record."""
        record = ExperienceRecord.create_priority_feedback(
            story_id=story_id,
            system_priority=system_priority,
            human_priority=human_priority,
            context=context,
        )
        return await self.create(record)

    async def create_source_feedback(
        self,
        source_id: str,
        is_reliable: bool,
        story_id: Optional[UUID] = None,
        context: Optional[Dict] = None,
    ) -> ExperienceRecord:
        """Create source reliability feedback record."""
        record = ExperienceRecord.create_source_feedback(
            source_id=source_id,
            is_reliable=is_reliable,
            story_id=story_id,
            context=context,
        )
        return await self.create(record)

    async def create_clustering_feedback(
        self,
        cluster_id: UUID,
        story_id: UUID,
        should_be_in_cluster: bool,
        context: Optional[Dict] = None,
    ) -> ExperienceRecord:
        """Create clustering feedback record."""
        record = ExperienceRecord.create_clustering_feedback(
            cluster_id=cluster_id,
            story_id=story_id,
            should_be_in_cluster=should_be_in_cluster,
            context=context,
        )
        return await self.create(record)

    async def get_unused_for_training(
        self,
        experience_type: str,
        limit: int = 1000,
    ) -> List[ExperienceRecord]:
        """
        Get experience records not yet used in training.

        Args:
            experience_type: Type of experience to fetch
            limit: Maximum records to return

        Returns:
            List of unused experience records
        """
        result = await self.db.execute(
            select(ExperienceRecord)
            .where(
                and_(
                    ExperienceRecord.experience_type == experience_type,
                    ExperienceRecord.used_in_training == False,
                )
            )
            .order_by(ExperienceRecord.created_at)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def mark_as_used(self, record_ids: List[UUID]):
        """Mark records as used in training."""
        if not record_ids:
            return

        await self.db.execute(
            update(ExperienceRecord)
            .where(ExperienceRecord.id.in_(record_ids))
            .values(used_in_training=True)
        )
        await self.db.commit()

    async def get_recent(
        self,
        experience_type: Optional[str] = None,
        hours: int = 24,
        limit: int = 100,
    ) -> List[ExperienceRecord]:
        """
        Get recent experience records.

        Args:
            experience_type: Optional type filter
            hours: Time window in hours
            limit: Maximum records

        Returns:
            List of recent records
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        query = select(ExperienceRecord).where(ExperienceRecord.created_at >= cutoff)

        if experience_type:
            query = query.where(ExperienceRecord.experience_type == experience_type)

        query = query.order_by(ExperienceRecord.created_at.desc()).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def count_by_type(self) -> Dict[str, int]:
        """Get count of records by experience type."""
        result = await self.db.execute(
            select(
                ExperienceRecord.experience_type,
                func.count(ExperienceRecord.id),
            )
            .group_by(ExperienceRecord.experience_type)
        )

        return {row[0]: row[1] for row in result.all()}

    async def count_unused_by_type(self) -> Dict[str, int]:
        """Get count of unused records by experience type."""
        result = await self.db.execute(
            select(
                ExperienceRecord.experience_type,
                func.count(ExperienceRecord.id),
            )
            .where(ExperienceRecord.used_in_training == False)
            .group_by(ExperienceRecord.experience_type)
        )

        return {row[0]: row[1] for row in result.all()}

    async def get_stats(self) -> Dict:
        """Get comprehensive experience buffer statistics."""
        total_counts = await self.count_by_type()
        unused_counts = await self.count_unused_by_type()

        # Get recent activity
        recent_24h = await self.db.scalar(
            select(func.count(ExperienceRecord.id))
            .where(
                ExperienceRecord.created_at >= datetime.now(timezone.utc) - timedelta(hours=24)
            )
        )

        # Get reward distribution
        avg_rewards = await self.db.execute(
            select(
                ExperienceRecord.experience_type,
                func.avg(ExperienceRecord.reward),
            )
            .group_by(ExperienceRecord.experience_type)
        )
        avg_rewards_dict = {row[0]: float(row[1]) if row[1] else 0.0 for row in avg_rewards.all()}

        return {
            "total_records": sum(total_counts.values()),
            "by_type": total_counts,
            "unused_by_type": unused_counts,
            "recent_24h": recent_24h or 0,
            "average_rewards": avg_rewards_dict,
        }

    async def get_training_batch(
        self,
        experience_type: str,
        batch_size: int = 32,
    ) -> Tuple[List[ExperienceRecord], bool]:
        """
        Get a batch of records for training.

        Args:
            experience_type: Type of experience
            batch_size: Desired batch size

        Returns:
            (records, has_more) tuple
        """
        records = await self.get_unused_for_training(experience_type, limit=batch_size + 1)

        has_more = len(records) > batch_size
        records = records[:batch_size]

        return records, has_more

    async def delete_old_records(self, days: int = 90) -> int:
        """
        Delete old records that have been used in training.

        Args:
            days: Age threshold in days

        Returns:
            Number of records deleted
        """
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        # Only delete used records
        result = await self.db.execute(
            select(ExperienceRecord.id)
            .where(
                and_(
                    ExperienceRecord.created_at < cutoff,
                    ExperienceRecord.used_in_training == True,
                )
            )
        )
        old_ids = [row[0] for row in result.all()]

        if old_ids:
            from sqlalchemy import delete
            await self.db.execute(
                delete(ExperienceRecord).where(ExperienceRecord.id.in_(old_ids))
            )
            await self.db.commit()

        return len(old_ids)
