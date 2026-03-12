"""
Database-Driven Entity Extractor - Production implementation.

Features:
- 6,600+ patterns from election/parliament database
- Aho-Corasick O(n) matching
- Context-based confidence scoring
- Cross-lingual canonical resolution
- False positive reduction via boundary validation
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.nlp.entity_patterns import EntityPattern, EntityMatch, ExtractedEntity
from app.services.nlp.entity_index_generator import EntityIndexGenerator
from app.services.nlp.aho_corasick_matcher import AhoCorasickEntityMatcher
from app.services.nlp.boundary_validator import BoundaryValidator
from app.services.nlp.context_scorer import ContextScorer, OverlapResolver

logger = logging.getLogger(__name__)


class CrossLingualLinker:
    """
    Links English and Nepali mentions to same canonical entity.
    """

    def __init__(self):
        self._en_to_canonical: Dict[str, str] = {}
        self._ne_to_canonical: Dict[str, str] = {}
        self._canonical_to_info: Dict[str, Dict[str, Any]] = {}

    def _is_devanagari(self, text: str) -> bool:
        """Check if text contains Devanagari characters."""
        return any('\u0900' <= c <= '\u097F' for c in text)

    def build_from_patterns(self, patterns: Dict[str, EntityPattern]):
        """Build cross-lingual index from patterns."""
        self._en_to_canonical = {}
        self._ne_to_canonical = {}
        self._canonical_to_info = {}

        for pattern_text, pattern in patterns.items():
            canonical = pattern.canonical_id

            if self._is_devanagari(pattern_text):
                self._ne_to_canonical[pattern_text] = canonical
            else:
                self._en_to_canonical[pattern_text.lower()] = canonical

            # Store info about canonical
            if canonical not in self._canonical_to_info:
                self._canonical_to_info[canonical] = {
                    "entity_type": pattern.entity_type,
                    "context_hints": pattern.context_hints,
                    "names": [],
                }
            self._canonical_to_info[canonical]["names"].append(pattern_text)

    def get_canonical(self, text: str) -> Optional[str]:
        """Get canonical ID for text (English or Nepali)."""
        if self._is_devanagari(text):
            return self._ne_to_canonical.get(text)
        else:
            return self._en_to_canonical.get(text.lower())

    def get_info(self, canonical_id: str) -> Optional[Dict[str, Any]]:
        """Get info about canonical entity."""
        return self._canonical_to_info.get(canonical_id)


class EntityDisambiguator:
    """
    Resolves ambiguous entity matches using context clues.
    """

    def __init__(self, cross_linker: CrossLingualLinker):
        self.cross_linker = cross_linker

    async def disambiguate(
        self,
        match: EntityMatch,
        text: str,
        session: Optional[AsyncSession] = None,
    ) -> tuple:
        """
        Resolve ambiguous entity to canonical ID.

        Returns:
            (canonical_id, confidence)
        """
        # If pattern has unique canonical_id, use it
        if match.pattern.canonical_id:
            return match.pattern.canonical_id, match.raw_confidence

        # Try cross-lingual lookup
        canonical = self.cross_linker.get_canonical(match.text)
        if canonical:
            return canonical, match.raw_confidence

        # Generate temporary canonical for unknown entities
        slug = self._slugify(match.text)
        return f"unknown_{slug}", match.raw_confidence * 0.5

    def _slugify(self, text: str) -> str:
        """Convert text to slug for canonical ID."""
        import re
        text = text.lower().strip()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[\s_-]+', '_', text)
        return text[:50]


class DatabaseEntityExtractor:
    """
    Production entity extractor using database patterns.

    Features:
    - 6,600+ patterns from election/parliament database
    - Aho-Corasick O(n) matching
    - Context-based confidence scoring
    - Cross-lingual canonical resolution
    - False positive reduction via boundary validation
    """

    def __init__(self):
        self._index_generator = EntityIndexGenerator()
        self._matcher = AhoCorasickEntityMatcher()
        self._boundary_validator = BoundaryValidator()
        self._context_scorer = ContextScorer()
        self._overlap_resolver = OverlapResolver()
        self._cross_linker = CrossLingualLinker()
        self._disambiguator: Optional[EntityDisambiguator] = None
        self._initialized = False
        self._patterns: Dict[str, EntityPattern] = {}
        self._init_time: Optional[datetime] = None

    @property
    def is_initialized(self) -> bool:
        """Check if extractor is initialized."""
        return self._initialized

    @property
    def pattern_count(self) -> int:
        """Get total number of patterns."""
        return len(self._patterns)

    async def initialize(self, session: AsyncSession):
        """
        Initialize entity extractor from database.
        Should be called on application startup.
        """
        if self._initialized:
            return

        logger.info("Initializing DatabaseEntityExtractor from database...")
        start_time = datetime.now()

        # Generate patterns from database
        self._patterns = await self._index_generator.generate_all_patterns(session)

        # Build Aho-Corasick automaton
        self._matcher.build_from_patterns(self._patterns)

        # Build cross-lingual index
        self._cross_linker.build_from_patterns(self._patterns)

        # Initialize disambiguator
        self._disambiguator = EntityDisambiguator(self._cross_linker)

        self._initialized = True
        self._init_time = datetime.now()

        elapsed = (self._init_time - start_time).total_seconds()
        stats = self._index_generator.get_pattern_stats()

        logger.info(
            f"DatabaseEntityExtractor initialized in {elapsed:.2f}s with {stats['total']} patterns. "
            f"By type: {stats['by_type']}, By source: {stats['by_source']}"
        )

    async def extract(
        self,
        text: str,
        min_confidence: float = 0.5,
        session: Optional[AsyncSession] = None,
        deduplicate: bool = True,
    ) -> List[ExtractedEntity]:
        """
        Extract entities from text.

        Args:
            text: Input text (English or Nepali)
            min_confidence: Minimum confidence threshold
            session: Database session for disambiguation
            deduplicate: If True, return only one entity per canonical_id

        Returns:
            List of ExtractedEntity with canonical IDs
        """
        if not self._initialized:
            raise RuntimeError("Entity extractor not initialized. Call initialize() first.")

        if not text or not text.strip():
            return []

        # Step 1: Find all pattern matches (O(n))
        raw_matches = self._matcher.find_all_matches(text)

        if not raw_matches:
            return []

        # Step 2: Validate word boundaries
        valid_matches = self._boundary_validator.filter_valid_matches(text, raw_matches)

        if not valid_matches:
            return []

        # Step 3: Score with context
        for match in valid_matches:
            match.raw_confidence = self._context_scorer.score_with_context(match, text)

        # Step 4: Resolve overlaps (prefer longer, higher confidence)
        non_overlapping = self._overlap_resolver.resolve_overlaps_by_confidence(valid_matches)

        # Step 5: Filter by confidence threshold
        confident_matches = [m for m in non_overlapping if m.raw_confidence >= min_confidence]

        # Step 6: Create final entities with disambiguation and deduplication
        entities = []
        seen_canonicals: set = set()

        for match in confident_matches:
            # Get canonical ID (with disambiguation if needed)
            canonical_id, confidence = await self._disambiguator.disambiguate(
                match, text, session
            )

            # Deduplicate by canonical_id - keep first (highest confidence) only
            if deduplicate and canonical_id in seen_canonicals:
                continue

            entities.append(ExtractedEntity(
                text=match.text,
                canonical_id=canonical_id,
                entity_type=match.pattern.entity_type,
                confidence=confidence,
                start=match.start,
                end=match.end,
                metadata=match.pattern.context_hints or {},
                source=match.pattern.source,
            ))
            seen_canonicals.add(canonical_id)

        return sorted(entities, key=lambda e: e.start)

    def extract_sync(
        self,
        text: str,
        min_confidence: float = 0.5,
    ) -> List[ExtractedEntity]:
        """
        Synchronous extraction (no disambiguation lookup).

        Args:
            text: Input text
            min_confidence: Minimum confidence threshold

        Returns:
            List of ExtractedEntity
        """
        if not self._initialized:
            raise RuntimeError("Entity extractor not initialized. Call initialize() first.")

        if not text or not text.strip():
            return []

        # Step 1: Find all pattern matches
        raw_matches = self._matcher.find_all_matches(text)

        if not raw_matches:
            return []

        # Step 2: Validate word boundaries
        valid_matches = self._boundary_validator.filter_valid_matches(text, raw_matches)

        if not valid_matches:
            return []

        # Step 3: Score with context
        for match in valid_matches:
            match.raw_confidence = self._context_scorer.score_with_context(match, text)

        # Step 4: Resolve overlaps
        non_overlapping = self._overlap_resolver.resolve_overlaps_by_confidence(valid_matches)

        # Step 5: Filter and create entities
        entities = []
        for match in non_overlapping:
            if match.raw_confidence < min_confidence:
                continue

            entities.append(ExtractedEntity(
                text=match.text,
                canonical_id=match.pattern.canonical_id,
                entity_type=match.pattern.entity_type,
                confidence=match.raw_confidence,
                start=match.start,
                end=match.end,
                metadata=match.pattern.context_hints or {},
                source=match.pattern.source,
            ))

        return sorted(entities, key=lambda e: e.start)

    async def refresh_patterns(self, session: AsyncSession):
        """
        Refresh patterns from database.
        Call when election/parliament data is updated.
        """
        logger.info("Refreshing entity patterns from database...")
        self._initialized = False
        await self.initialize(session)

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the extractor."""
        if not self._initialized:
            return {"initialized": False}

        return {
            "initialized": True,
            "init_time": self._init_time.isoformat() if self._init_time else None,
            "pattern_count": len(self._patterns),
            "pattern_stats": self._index_generator.get_pattern_stats(),
        }


# Global singleton instance
_extractor_instance: Optional[DatabaseEntityExtractor] = None


def get_database_entity_extractor() -> DatabaseEntityExtractor:
    """Get or create the singleton extractor instance."""
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = DatabaseEntityExtractor()
    return _extractor_instance


async def initialize_entity_extractor(session: AsyncSession):
    """Initialize the global entity extractor."""
    extractor = get_database_entity_extractor()
    await extractor.initialize(session)
    return extractor
