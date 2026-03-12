"""RelationshipDiscoveryService - Discover co-mention relationships between entities."""
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Tuple
from uuid import UUID, uuid4
import logging

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.political_entity import PoliticalEntity
from app.models.story_entity_link import StoryEntityLink
from app.models.story import Story
from app.models.entity_relationship import (
    EntityRelationship,
    RelationshipType,
)

logger = logging.getLogger(__name__)


class RelationshipDiscoveryService:
    """
    Discovers and maintains relationships between political entities.

    Primary focus is on co-mention relationships - when two entities are
    mentioned in the same story, they likely have some relationship.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def discover_co_mentions_for_story(
        self,
        story_id: UUID,
        min_confidence: float = 0.5,
    ) -> List[EntityRelationship]:
        """
        Discover co-mention relationships from a single story.

        Called during story ingestion to incrementally build the relationship graph.
        """
        # Get all entity links for this story
        result = await self.db.execute(
            select(StoryEntityLink)
            .where(StoryEntityLink.story_id == story_id)
            .where(StoryEntityLink.confidence >= min_confidence)
        )
        links = result.scalars().all()

        if len(links) < 2:
            return []

        # Get story timestamp for temporal tracking
        story_result = await self.db.execute(
            select(Story.published_at).where(Story.id == story_id)
        )
        story_time = story_result.scalar_one_or_none()

        relationships = []

        # Create pairwise relationships
        for i, link1 in enumerate(links):
            for link2 in links[i + 1:]:
                # Skip self-relationships
                if link1.entity_id == link2.entity_id:
                    continue

                # Create bidirectional relationships (lower ID -> higher ID for consistency)
                source_id, target_id = sorted([link1.entity_id, link2.entity_id])

                # Calculate confidence based on mention quality
                confidence = min(link1.confidence or 0.7, link2.confidence or 0.7)

                # Upsert relationship
                rel = await self._upsert_co_mention(
                    source_id=source_id,
                    target_id=target_id,
                    story_id=story_id,
                    story_time=story_time,
                    confidence=confidence,
                )
                if rel:
                    relationships.append(rel)

        return relationships

    async def _upsert_co_mention(
        self,
        source_id: UUID,
        target_id: UUID,
        story_id: UUID,
        story_time: Optional[datetime],
        confidence: float,
    ) -> Optional[EntityRelationship]:
        """Upsert a co-mention relationship, incrementing counts if exists."""
        # Check for existing relationship
        result = await self.db.execute(
            select(EntityRelationship).where(
                EntityRelationship.source_entity_id == source_id,
                EntityRelationship.target_entity_id == target_id,
                EntityRelationship.relationship_type == RelationshipType.CO_MENTION,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing relationship
            existing.co_mention_count += 1
            existing.last_co_mention_at = story_time or datetime.now(timezone.utc)

            # Update evidence story IDs (keep last 10)
            evidence_ids = existing.evidence_story_ids or []
            if story_id not in evidence_ids:
                evidence_ids = evidence_ids[-9:] + [story_id]
                existing.evidence_story_ids = evidence_ids

            # Recalculate strength score (normalized by max co-mentions)
            existing.strength_score = self._calculate_strength(existing.co_mention_count)
            existing.updated_at = datetime.now(timezone.utc)

            return existing
        else:
            # Create new relationship
            now = datetime.now(timezone.utc)
            rel = EntityRelationship(
                id=uuid4(),
                source_entity_id=source_id,
                target_entity_id=target_id,
                relationship_type=RelationshipType.CO_MENTION,
                co_mention_count=1,
                strength_score=self._calculate_strength(1),
                confidence=confidence,
                first_co_mention_at=story_time or now,
                last_co_mention_at=story_time or now,
                evidence_story_ids=[story_id],
                created_at=now,
                updated_at=now,
            )
            self.db.add(rel)
            return rel

    def _calculate_strength(self, co_mention_count: int) -> float:
        """
        Calculate strength score based on co-mention count.

        Uses logarithmic scaling to prevent domination by high-frequency pairs.
        """
        import math
        # Log scale with saturation at ~100 co-mentions
        return min(1.0, math.log(co_mention_count + 1) / math.log(100))

    async def discover_all_co_mentions(
        self,
        hours: int = 720,  # 30 days
        min_confidence: float = 0.5,
        batch_size: int = 100,
    ) -> Dict[str, int]:
        """
        Bulk discover co-mention relationships from recent stories.

        Used for initial population or periodic refresh of the relationship graph.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        # Get all stories with multiple entity mentions
        subquery = (
            select(StoryEntityLink.story_id)
            .where(StoryEntityLink.confidence >= min_confidence)
            .group_by(StoryEntityLink.story_id)
            .having(func.count(StoryEntityLink.entity_id) >= 2)
        )

        result = await self.db.execute(
            select(Story.id)
            .where(Story.published_at >= cutoff)
            .where(Story.id.in_(subquery))
            .order_by(Story.published_at.desc())
        )
        story_ids = [row[0] for row in result.all()]

        stats = {
            "stories_processed": 0,
            "relationships_created": 0,
            "relationships_updated": 0,
        }

        # Process in batches
        for i in range(0, len(story_ids), batch_size):
            batch = story_ids[i:i + batch_size]
            for story_id in batch:
                try:
                    rels = await self.discover_co_mentions_for_story(story_id, min_confidence)
                    stats["relationships_created"] += len([r for r in rels if r.co_mention_count == 1])
                    stats["relationships_updated"] += len([r for r in rels if r.co_mention_count > 1])
                except Exception as e:
                    logger.error(f"Error processing story {story_id}: {e}")

            stats["stories_processed"] += len(batch)
            await self.db.commit()

            if i % 500 == 0:
                logger.info(f"Processed {i + len(batch)}/{len(story_ids)} stories")

        return stats

    async def get_entity_relationships(
        self,
        entity_id: UUID,
        relationship_types: Optional[List[RelationshipType]] = None,
        min_strength: float = 0.0,
        limit: int = 50,
    ) -> List[EntityRelationship]:
        """Get all relationships for a specific entity."""
        query = select(EntityRelationship).where(
            or_(
                EntityRelationship.source_entity_id == entity_id,
                EntityRelationship.target_entity_id == entity_id,
            )
        )

        if relationship_types:
            query = query.where(EntityRelationship.relationship_type.in_(relationship_types))

        if min_strength > 0:
            query = query.where(EntityRelationship.strength_score >= min_strength)

        query = query.order_by(EntityRelationship.strength_score.desc()).limit(limit)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_strongest_relationships(
        self,
        hours: int = 168,  # 7 days
        min_co_mentions: int = 2,
        limit: int = 100,
    ) -> List[EntityRelationship]:
        """Get the strongest co-mention relationships in the time window."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

        result = await self.db.execute(
            select(EntityRelationship)
            .where(EntityRelationship.relationship_type == RelationshipType.CO_MENTION)
            .where(EntityRelationship.last_co_mention_at >= cutoff)
            .where(EntityRelationship.co_mention_count >= min_co_mentions)
            .order_by(EntityRelationship.strength_score.desc())
            .limit(limit)
        )

        return list(result.scalars().all())

    async def add_manual_relationship(
        self,
        source_entity_id: UUID,
        target_entity_id: UUID,
        relationship_type: RelationshipType,
        notes: Optional[str] = None,
        verified_by: Optional[str] = None,
    ) -> EntityRelationship:
        """Add a manually verified relationship between entities."""
        now = datetime.now(timezone.utc)

        # Ensure consistent ordering for non-co-mention relationships
        if relationship_type == RelationshipType.CO_MENTION:
            source_id, target_id = sorted([source_entity_id, target_entity_id])
        else:
            source_id, target_id = source_entity_id, target_entity_id

        # Check for existing
        result = await self.db.execute(
            select(EntityRelationship).where(
                EntityRelationship.source_entity_id == source_id,
                EntityRelationship.target_entity_id == target_id,
                EntityRelationship.relationship_type == relationship_type,
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.notes = notes or existing.notes
            existing.is_verified = True
            existing.verified_by = verified_by
            existing.updated_at = now
            return existing

        rel = EntityRelationship(
            id=uuid4(),
            source_entity_id=source_id,
            target_entity_id=target_id,
            relationship_type=relationship_type,
            co_mention_count=0,
            strength_score=0.8,  # Manual relationships start with high strength
            confidence=1.0,
            notes=notes,
            is_verified=True,
            verified_by=verified_by,
            created_at=now,
            updated_at=now,
        )
        self.db.add(rel)
        return rel
