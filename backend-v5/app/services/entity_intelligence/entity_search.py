"""EntitySearchService - Fuzzy search with alias resolution."""
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any, Tuple
from uuid import UUID
import logging
import re

from sqlalchemy import select, func, or_, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.political_entity import PoliticalEntity, EntityType

logger = logging.getLogger(__name__)


class EntitySearchService:
    """
    Provides fuzzy entity search with alias resolution.

    Features:
    - Fuzzy name matching using trigram similarity
    - Alias expansion and resolution
    - Nepali/Devanagari support
    - Type and party filtering
    - Autocomplete suggestions
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def search(
        self,
        query: str,
        entity_types: Optional[List[EntityType]] = None,
        party: Optional[str] = None,
        min_mentions: int = 0,
        include_inactive: bool = False,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Search for entities by name with fuzzy matching.

        Uses PostgreSQL trigram similarity for fuzzy matching.
        """
        if not query or len(query) < 2:
            return []

        # Normalize query
        normalized_query = self._normalize_query(query)

        # Build search pattern
        pattern = f"%{normalized_query}%"

        # Base query with ILIKE matching
        base_query = select(PoliticalEntity).where(
            or_(
                PoliticalEntity.name_en.ilike(pattern),
                PoliticalEntity.name_ne.ilike(pattern),
                PoliticalEntity.canonical_id.ilike(pattern),
                # Search in aliases JSON array
                func.jsonb_array_elements_text(
                    func.coalesce(PoliticalEntity.aliases, '[]')
                ).op('ILIKE')(pattern),
            )
        )

        # Apply filters
        if not include_inactive:
            base_query = base_query.where(PoliticalEntity.is_active == True)

        if entity_types:
            base_query = base_query.where(PoliticalEntity.entity_type.in_(entity_types))

        if party:
            base_query = base_query.where(PoliticalEntity.party.ilike(f"%{party}%"))

        if min_mentions > 0:
            base_query = base_query.where(PoliticalEntity.total_mentions >= min_mentions)

        # Order by relevance (mentions + recency)
        base_query = base_query.order_by(
            # Exact match boost
            func.case(
                (PoliticalEntity.name_en.ilike(normalized_query), 1000),
                (PoliticalEntity.canonical_id == normalized_query.lower(), 1000),
                else_=0
            ).desc(),
            # Starts with boost
            func.case(
                (PoliticalEntity.name_en.ilike(f"{normalized_query}%"), 500),
                else_=0
            ).desc(),
            # Recent activity
            PoliticalEntity.mentions_24h.desc(),
            PoliticalEntity.total_mentions.desc(),
        ).limit(limit)

        result = await self.db.execute(base_query)
        entities = result.scalars().all()

        return [self._serialize_search_result(e, normalized_query) for e in entities]

    async def autocomplete(
        self,
        prefix: str,
        limit: int = 10,
    ) -> List[Dict[str, str]]:
        """
        Get autocomplete suggestions for entity names.

        Optimized for fast prefix matching.
        """
        if not prefix or len(prefix) < 2:
            return []

        normalized_prefix = self._normalize_query(prefix)
        pattern = f"{normalized_prefix}%"

        result = await self.db.execute(
            select(PoliticalEntity.id, PoliticalEntity.name_en, PoliticalEntity.entity_type)
            .where(
                PoliticalEntity.is_active == True,
                or_(
                    PoliticalEntity.name_en.ilike(pattern),
                    PoliticalEntity.canonical_id.ilike(pattern),
                )
            )
            .order_by(PoliticalEntity.mentions_24h.desc())
            .limit(limit)
        )

        return [
            {
                "id": str(row.id),
                "name": row.name_en,
                "type": row.entity_type.value,
            }
            for row in result.all()
        ]

    async def resolve_alias(self, alias: str) -> Optional[PoliticalEntity]:
        """
        Resolve an alias to its canonical entity.

        Searches through the aliases JSONB array.
        """
        normalized = self._normalize_query(alias)

        # First check canonical_id and exact name match
        result = await self.db.execute(
            select(PoliticalEntity).where(
                or_(
                    PoliticalEntity.canonical_id == normalized.lower(),
                    func.lower(PoliticalEntity.name_en) == normalized.lower(),
                )
            )
        )
        entity = result.scalar_one_or_none()
        if entity:
            return entity

        # Search in aliases
        result = await self.db.execute(
            select(PoliticalEntity).where(
                PoliticalEntity.aliases.contains([alias])
            )
        )
        entity = result.scalar_one_or_none()
        if entity:
            return entity

        # Fuzzy alias search (case-insensitive)
        result = await self.db.execute(
            select(PoliticalEntity).where(
                func.exists(
                    select(func.jsonb_array_elements_text(PoliticalEntity.aliases))
                    .where(
                        func.lower(func.jsonb_array_elements_text(PoliticalEntity.aliases)) ==
                        normalized.lower()
                    )
                )
            )
        )
        return result.scalar_one_or_none()

    async def find_similar_entities(
        self,
        entity_id: UUID,
        threshold: float = 0.3,
        limit: int = 10,
    ) -> List[Tuple[PoliticalEntity, float]]:
        """
        Find entities with similar names (potential duplicates).

        Uses trigram similarity for fuzzy matching.
        """
        # Get target entity
        result = await self.db.execute(
            select(PoliticalEntity).where(PoliticalEntity.id == entity_id)
        )
        target = result.scalar_one_or_none()

        if not target:
            return []

        # Use trigram similarity (requires pg_trgm extension)
        try:
            result = await self.db.execute(
                text("""
                    SELECT id, name_en, name_ne, entity_type, party,
                           similarity(name_en, :target_name) as sim_score
                    FROM political_entities
                    WHERE id != :target_id
                      AND is_active = true
                      AND similarity(name_en, :target_name) > :threshold
                    ORDER BY sim_score DESC
                    LIMIT :limit
                """),
                {
                    "target_id": entity_id,
                    "target_name": target.name_en,
                    "threshold": threshold,
                    "limit": limit,
                }
            )

            similar = []
            for row in result.all():
                entity_result = await self.db.execute(
                    select(PoliticalEntity).where(PoliticalEntity.id == row.id)
                )
                entity = entity_result.scalar_one_or_none()
                if entity:
                    similar.append((entity, row.sim_score))

            return similar

        except Exception as e:
            # Fallback if pg_trgm not available
            logger.warning(f"Trigram similarity not available: {e}")
            return await self._fallback_similar_search(target, threshold, limit)

    async def _fallback_similar_search(
        self,
        target: PoliticalEntity,
        threshold: float,
        limit: int,
    ) -> List[Tuple[PoliticalEntity, float]]:
        """Fallback similarity search without pg_trgm."""
        # Simple prefix matching
        name_parts = target.name_en.split()
        if not name_parts:
            return []

        # Search for entities sharing name parts
        conditions = [
            PoliticalEntity.name_en.ilike(f"%{part}%")
            for part in name_parts
            if len(part) > 2
        ]

        if not conditions:
            return []

        result = await self.db.execute(
            select(PoliticalEntity)
            .where(
                PoliticalEntity.id != target.id,
                PoliticalEntity.is_active == True,
                or_(*conditions),
            )
            .limit(limit)
        )

        entities = result.scalars().all()

        # Calculate simple similarity score
        similar = []
        for entity in entities:
            score = self._simple_similarity(target.name_en, entity.name_en)
            if score >= threshold:
                similar.append((entity, score))

        return sorted(similar, key=lambda x: x[1], reverse=True)[:limit]

    def _simple_similarity(self, s1: str, s2: str) -> float:
        """Calculate simple similarity between two strings."""
        s1_lower = s1.lower()
        s2_lower = s2.lower()

        # Jaccard similarity of character trigrams
        def trigrams(s: str) -> set:
            return {s[i:i+3] for i in range(len(s) - 2)} if len(s) >= 3 else {s}

        t1 = trigrams(s1_lower)
        t2 = trigrams(s2_lower)

        intersection = len(t1 & t2)
        union = len(t1 | t2)

        return intersection / union if union > 0 else 0.0

    def _normalize_query(self, query: str) -> str:
        """Normalize search query for matching."""
        # Remove extra whitespace
        normalized = ' '.join(query.split())

        # Handle common variations
        # e.g., "K.P." -> "KP", "K P" -> "KP" for initials
        normalized = re.sub(r'(\w)\.\s*(\w)', r'\1\2', normalized)

        return normalized

    def _serialize_search_result(
        self,
        entity: PoliticalEntity,
        query: str,
    ) -> Dict[str, Any]:
        """Serialize entity for search results."""
        # Determine match type
        match_type = "fuzzy"
        query_lower = query.lower()

        if entity.canonical_id == query_lower:
            match_type = "canonical"
        elif entity.name_en.lower() == query_lower:
            match_type = "exact"
        elif entity.name_en.lower().startswith(query_lower):
            match_type = "prefix"

        return {
            "id": str(entity.id),
            "canonical_id": entity.canonical_id,
            "name_en": entity.name_en,
            "name_ne": entity.name_ne,
            "entity_type": entity.entity_type.value,
            "party": entity.party,
            "role": entity.role,
            "total_mentions": entity.total_mentions,
            "mentions_24h": entity.mentions_24h,
            "trend": entity.trend.value,
            "match_type": match_type,
            "image_url": entity.image_url,
        }

    async def get_trending_entities(
        self,
        hours: int = 24,
        entity_types: Optional[List[EntityType]] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Get entities with the most mentions in the time window."""
        query = select(PoliticalEntity).where(
            PoliticalEntity.is_active == True,
            PoliticalEntity.mentions_24h > 0,
        )

        if entity_types:
            query = query.where(PoliticalEntity.entity_type.in_(entity_types))

        # Order by recent mentions and trend
        query = query.order_by(
            # Rising trend bonus
            func.case(
                (PoliticalEntity.trend == 'rising', 100),
                else_=0
            ).desc(),
            PoliticalEntity.mentions_24h.desc(),
        ).limit(limit)

        result = await self.db.execute(query)
        entities = result.scalars().all()

        return [
            {
                "id": str(e.id),
                "canonical_id": e.canonical_id,
                "name_en": e.name_en,
                "entity_type": e.entity_type.value,
                "party": e.party,
                "mentions_24h": e.mentions_24h,
                "trend": e.trend.value,
                "image_url": e.image_url,
            }
            for e in entities
        ]

    async def get_entities_by_party(
        self,
        party: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Get all entities belonging to a political party."""
        result = await self.db.execute(
            select(PoliticalEntity)
            .where(
                PoliticalEntity.is_active == True,
                PoliticalEntity.party.ilike(f"%{party}%"),
            )
            .order_by(PoliticalEntity.total_mentions.desc())
            .limit(limit)
        )

        entities = result.scalars().all()

        return [
            {
                "id": str(e.id),
                "canonical_id": e.canonical_id,
                "name_en": e.name_en,
                "role": e.role,
                "total_mentions": e.total_mentions,
                "trend": e.trend.value,
            }
            for e in entities
        ]
