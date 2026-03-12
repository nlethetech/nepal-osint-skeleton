"""Text and entity similarity scoring engine."""
import logging
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Optional, List, Dict, Any

from app.services.clustering.feature_extractor import StoryFeatures, get_feature_extractor
from app.services.clustering.minhash import get_minhash_generator

logger = logging.getLogger(__name__)


@dataclass
class HybridSimilarityScore:
    """
    Palantir-grade hybrid similarity score with 3-component weighted formula.

    Components:
    - semantic: E5-Large embedding cosine similarity (45% weight)
    - lexical: MinHash Jaccard similarity (30% weight)
    - structural: Entity overlap + geo + temporal (25% weight)
    """
    overall: float          # 0.0 to 1.0
    semantic: float         # E5-Large embedding similarity
    lexical: float          # MinHash text similarity
    structural: float       # Combined entity/geo/temporal
    # Sub-components for debugging
    entity_overlap: float
    geo_similarity: float
    temporal_proximity: float
    # Metadata
    blocked: bool = False
    block_reason: Optional[str] = None


@dataclass
class SimilarityScore:
    """Similarity score between two stories."""
    overall: float  # 0.0 to 1.0
    title_similarity: float
    entity_overlap: float
    category_match: bool
    temporal_proximity: float  # 0.0 to 1.0 based on time difference
    # New v3 components
    geo_similarity: float = 0.0
    text_similarity: float = 0.0  # MinHash-based


@dataclass
class SmartSimilarityScore:
    """Enhanced similarity score with 4-component weighted formula."""
    overall: float  # 0.0 to 1.0
    geo: float      # Geographic overlap (0.25 weight)
    category: float # Category match (0.15 weight)
    entity: float   # Key term overlap (0.20 weight)
    text: float     # MinHash text similarity (0.40 weight)


class SimilarityEngine:
    """
    Compute similarity between news stories.

    Uses lightweight techniques (no ML dependencies):
    - Title similarity using difflib SequenceMatcher
    - Entity overlap (shared keywords/proper nouns)
    - Category match bonus
    - Temporal proximity (stories within time window)

    Enhanced with v3 features:
    - MinHash for efficient text similarity
    - Geographic entity matching
    - 4-component weighted formula

    Palantir-grade v4 features:
    - Hybrid semantic similarity using E5-Large embeddings
    - 3-component formula: 45% semantic + 30% lexical + 25% structural
    - Cross-lingual support via multilingual embeddings
    """

    # Legacy weights for combining similarity scores
    TITLE_WEIGHT = 0.5
    ENTITY_WEIGHT = 0.3
    CATEGORY_WEIGHT = 0.1
    TEMPORAL_WEIGHT = 0.1

    # Smart clustering weights (v3 formula)
    # Increased TITLE weight to prevent unrelated stories from clustering
    GEO_WEIGHT = 0.20
    CATEGORY_WEIGHT_V3 = 0.15
    ENTITY_WEIGHT_V3 = 0.25  # Increased entity weight
    TEXT_WEIGHT = 0.40

    # ============================================================
    # Palantir-grade v4 Hybrid Weights
    # ============================================================
    # Semantic (E5-Large): Captures meaning across languages
    HYBRID_SEMANTIC_WEIGHT = 0.45
    # Lexical (MinHash): Catches exact quotes and headlines
    HYBRID_LEXICAL_WEIGHT = 0.30
    # Structural: Entity overlap + geo + temporal
    HYBRID_STRUCTURAL_WEIGHT = 0.25

    # Structural sub-component weights (within the 25%)
    STRUCTURAL_ENTITY_WEIGHT = 0.40
    STRUCTURAL_GEO_WEIGHT = 0.30
    STRUCTURAL_TEMPORAL_WEIGHT = 0.30

    # Minimum title similarity required for ANY clustering
    MIN_TITLE_SIMILARITY = 0.25

    # Minimum semantic similarity for hybrid clustering (more lenient than title)
    MIN_SEMANTIC_SIMILARITY = 0.50

    # Time window in hours for clustering
    MAX_TIME_WINDOW_HOURS = 48

    # Minimum word length for entity extraction
    MIN_ENTITY_LENGTH = 4

    # Common words to ignore in entity extraction
    STOP_WORDS = {
        "the", "and", "for", "with", "from", "that", "this", "have", "has",
        "been", "will", "would", "could", "should", "about", "after", "before",
        "into", "over", "under", "again", "further", "then", "once", "here",
        "there", "when", "where", "which", "while", "during", "through",
        "between", "both", "each", "other", "some", "such", "more", "most",
        "very", "just", "also", "only", "even", "back", "being", "their",
        "them", "they", "what", "says", "said", "nepal", "nepali", "nepalese",
        "kathmandu", "news", "report", "reports", "reported", "according",
    }

    def __init__(self):
        """Initialize similarity engine."""
        self._stop_words_lower = {w.lower() for w in self.STOP_WORDS}

    def compute_similarity(
        self,
        title1: str,
        title2: str,
        content1: Optional[str],
        content2: Optional[str],
        category1: Optional[str],
        category2: Optional[str],
        time_diff_hours: float,
    ) -> SimilarityScore:
        """
        Compute overall similarity between two stories.

        Args:
            title1: First story title
            title2: Second story title
            content1: First story content/summary
            content2: Second story content/summary
            category1: First story category
            category2: Second story category
            time_diff_hours: Absolute time difference in hours

        Returns:
            SimilarityScore with overall and component scores
        """
        # Title similarity
        title_sim = self._title_similarity(title1, title2)

        # Entity overlap
        entities1 = self._extract_entities(title1, content1)
        entities2 = self._extract_entities(title2, content2)
        entity_overlap = self._entity_overlap(entities1, entities2)

        # Category match
        category_match = (
            category1 is not None and
            category2 is not None and
            category1 == category2
        )

        # Temporal proximity (linear decay over time window)
        temporal_proximity = max(0.0, 1.0 - (time_diff_hours / self.MAX_TIME_WINDOW_HOURS))

        # Weighted combination
        overall = (
            self.TITLE_WEIGHT * title_sim +
            self.ENTITY_WEIGHT * entity_overlap +
            self.CATEGORY_WEIGHT * (1.0 if category_match else 0.0) +
            self.TEMPORAL_WEIGHT * temporal_proximity
        )

        return SimilarityScore(
            overall=overall,
            title_similarity=title_sim,
            entity_overlap=entity_overlap,
            category_match=category_match,
            temporal_proximity=temporal_proximity,
        )

    def _title_similarity(self, title1: str, title2: str) -> float:
        """
        Compute title similarity using SequenceMatcher.

        Returns value between 0.0 and 1.0.
        """
        # Normalize titles
        t1 = self._normalize_text(title1)
        t2 = self._normalize_text(title2)

        if not t1 or not t2:
            return 0.0

        # Use SequenceMatcher for fuzzy matching
        return SequenceMatcher(None, t1, t2).ratio()

    def _extract_entities(
        self,
        title: str,
        content: Optional[str],
    ) -> set[str]:
        """
        Extract entities (proper nouns, significant words) from text.

        Returns set of lowercase entity strings.
        """
        text = f"{title} {content or ''}"
        entities: set[str] = set()

        # Find capitalized words (likely proper nouns)
        # Match words starting with uppercase after space/punctuation
        capitalized = re.findall(r'\b[A-Z][a-z]+\b', text)
        for word in capitalized:
            word_lower = word.lower()
            if (
                len(word) >= self.MIN_ENTITY_LENGTH and
                word_lower not in self._stop_words_lower
            ):
                entities.add(word_lower)

        # Also extract quoted terms
        quoted = re.findall(r'"([^"]+)"', text)
        for phrase in quoted:
            if len(phrase) >= self.MIN_ENTITY_LENGTH:
                entities.add(phrase.lower())

        # Extract numbers with context (dates, counts, etc.)
        numbers = re.findall(r'\b(\d+(?:\.\d+)?)\s*(?:people|killed|injured|dead|percent|%|rs|npr|million|billion|crore|lakh)', text.lower())
        for num in numbers:
            entities.add(f"num:{num}")

        return entities

    def _entity_overlap(self, entities1: set[str], entities2: set[str]) -> float:
        """
        Compute Jaccard similarity between entity sets.

        Returns value between 0.0 and 1.0.
        """
        if not entities1 or not entities2:
            return 0.0

        intersection = entities1 & entities2
        union = entities1 | entities2

        if not union:
            return 0.0

        return len(intersection) / len(union)

    def _normalize_text(self, text: str) -> str:
        """Normalize text for comparison."""
        # Lowercase
        text = text.lower()
        # Remove punctuation
        text = re.sub(r'[^\w\s]', ' ', text)
        # Collapse whitespace
        text = ' '.join(text.split())
        return text

    def quick_title_match(self, title1: str, title2: str, threshold: float = 0.8) -> bool:
        """
        Quick check if two titles are similar enough.

        Used for initial filtering before full similarity computation.
        """
        return self._title_similarity(title1, title2) >= threshold

    def compute_smart_similarity(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
        category1: Optional[str],
        category2: Optional[str],
    ) -> SmartSimilarityScore:
        """
        Compute similarity using the v3 4-component weighted formula.

        Formula: 0.25*geo + 0.15*category + 0.20*entity + 0.40*text

        Args:
            features1: First story features
            features2: Second story features
            category1: First story category
            category2: Second story category

        Returns:
            SmartSimilarityScore with overall and component scores
        """
        minhash = get_minhash_generator()

        # 1. Geographic similarity (0.25 weight)
        geo_sim = self._compute_geo_similarity(features1, features2)

        # 2. Category match (0.15 weight)
        category_match = 1.0 if (category1 and category2 and category1 == category2) else 0.0

        # 3. Entity/key term overlap (0.20 weight)
        entity_sim = self._compute_entity_similarity(features1, features2)

        # 4. Text similarity via MinHash (0.40 weight)
        text_sim = minhash.estimate_similarity(
            features1.content_minhash,
            features2.content_minhash,
        )

        # Weighted combination
        overall = (
            self.GEO_WEIGHT * geo_sim +
            self.CATEGORY_WEIGHT_V3 * category_match +
            self.ENTITY_WEIGHT_V3 * entity_sim +
            self.TEXT_WEIGHT * text_sim
        )

        return SmartSimilarityScore(
            overall=overall,
            geo=geo_sim,
            category=category_match,
            entity=entity_sim,
            text=text_sim,
        )

    def _compute_geo_similarity(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
    ) -> float:
        """
        Compute geographic similarity between features.

        Returns Jaccard similarity of geographic entities.
        """
        # Combine districts and constituencies
        geo1 = set(features1.districts) | set(features1.constituencies)
        geo2 = set(features2.districts) | set(features2.constituencies)

        # Add title districts
        if features1.title_district:
            geo1.add(features1.title_district)
        if features2.title_district:
            geo2.add(features2.title_district)

        if not geo1 and not geo2:
            # Both have no geography - cannot confirm geographic relation
            # Return 0.0 to prevent unrelated stories from clustering
            return 0.0

        if not geo1 or not geo2:
            # One has geography, other doesn't - low similarity
            return 0.0

        # Jaccard similarity
        intersection = geo1 & geo2
        union = geo1 | geo2

        return len(intersection) / len(union) if union else 0.0

    def _compute_entity_similarity(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
    ) -> float:
        """
        Compute entity/key term similarity between features.

        Combines title tokens and key terms with weighted importance.
        """
        # Title tokens (more weight)
        title1 = set(features1.title_tokens)
        title2 = set(features2.title_tokens)

        title_sim = 0.0
        if title1 and title2:
            title_sim = len(title1 & title2) / len(title1 | title2)

        # Key terms
        terms1 = set(features1.key_terms)
        terms2 = set(features2.key_terms)

        terms_sim = 0.0
        if terms1 and terms2:
            terms_sim = len(terms1 & terms2) / len(terms1 | terms2)

        # Weighted combination (title more important)
        return 0.6 * title_sim + 0.4 * terms_sim

    def compute_similarity_with_features(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
        category1: Optional[str],
        category2: Optional[str],
        time_diff_hours: float,
    ) -> SimilarityScore:
        """
        Compute similarity using pre-extracted features.

        Combines both legacy and smart similarity approaches.

        Args:
            features1: First story features
            features2: Second story features
            category1: First story category
            category2: Second story category
            time_diff_hours: Time difference in hours

        Returns:
            SimilarityScore with all components
        """
        minhash = get_minhash_generator()

        # MinHash text similarity
        text_sim = minhash.estimate_similarity(
            features1.content_minhash,
            features2.content_minhash,
        )

        # Title similarity (from tokens)
        title1 = set(features1.title_tokens)
        title2 = set(features2.title_tokens)
        title_sim = len(title1 & title2) / len(title1 | title2) if (title1 | title2) else 0.0

        # HARD REQUIREMENT: Titles must have SOME similarity to cluster
        # This prevents totally unrelated stories from clustering just because
        # they share some common words in the content
        if title_sim < self.MIN_TITLE_SIMILARITY:
            return SimilarityScore(
                overall=0.0,
                title_similarity=title_sim,
                entity_overlap=0.0,
                category_match=False,
                temporal_proximity=0.0,
                geo_similarity=0.0,
                text_similarity=0.0,
            )

        # Entity overlap from key terms
        terms1 = set(features1.key_terms)
        terms2 = set(features2.key_terms)
        entity_union = terms1 | terms2
        entity_overlap = len(terms1 & terms2) / len(entity_union) if entity_union else 0.0

        # Category match
        category_match = category1 is not None and category2 is not None and category1 == category2

        # Temporal proximity
        temporal_proximity = max(0.0, 1.0 - (time_diff_hours / self.MAX_TIME_WINDOW_HOURS))

        # Geographic similarity
        geo_sim = self._compute_geo_similarity(features1, features2)

        # Availability-aware weighting: don't penalize missing signals.
        # Many Nepal-relevant stories lack extractable districts/constituencies, so
        # we re-normalize weights across the signals that are actually present.
        has_geo1 = bool(features1.districts) or bool(features1.constituencies) or bool(features1.title_district)
        has_geo2 = bool(features2.districts) or bool(features2.constituencies) or bool(features2.title_district)
        geo_available = has_geo1 and has_geo2

        text_available = bool(features1.content_minhash) and bool(features2.content_minhash)
        entity_available = bool(entity_union)
        category_available = bool(category1) and bool(category2)

        w_geo = self.GEO_WEIGHT if geo_available else 0.0
        w_cat = self.CATEGORY_WEIGHT_V3 if category_available else 0.0
        w_ent = self.ENTITY_WEIGHT_V3 if entity_available else 0.0
        w_txt = self.TEXT_WEIGHT if text_available else 0.0

        w_sum = w_geo + w_cat + w_ent + w_txt
        if w_sum <= 0:
            overall = 0.0
        else:
            overall = (
                w_geo * geo_sim +
                w_cat * (1.0 if category_match else 0.0) +
                w_ent * entity_overlap +
                w_txt * text_sim
            ) / w_sum

        return SimilarityScore(
            overall=overall,
            title_similarity=title_sim,
            entity_overlap=entity_overlap,
            category_match=category_match,
            temporal_proximity=temporal_proximity,
            geo_similarity=geo_sim,
            text_similarity=text_sim,
        )

    # ============================================================
    # Palantir-Grade Hybrid Similarity (v4)
    # ============================================================

    def compute_hybrid_similarity(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
        embedding1: Optional[List[float]],
        embedding2: Optional[List[float]],
        time_diff_hours: float,
        category1: Optional[str] = None,
        category2: Optional[str] = None,
    ) -> HybridSimilarityScore:
        """
        Compute Palantir-grade hybrid similarity using 3-component formula.

        Formula: 0.45*semantic + 0.30*lexical + 0.25*structural

        Components:
        - Semantic: E5-Large embedding cosine similarity (cross-lingual capable)
        - Lexical: MinHash Jaccard similarity (catches exact phrases)
        - Structural: Entity overlap + geo similarity + temporal proximity

        Args:
            features1: First story features (MinHash, entities, geo)
            features2: Second story features
            embedding1: First story E5-Large embedding (1024d) or None
            embedding2: Second story E5-Large embedding (1024d) or None
            time_diff_hours: Absolute time difference between stories
            category1: Optional first story category
            category2: Optional second story category

        Returns:
            HybridSimilarityScore with overall and component scores
        """
        import numpy as np

        minhash = get_minhash_generator()

        # ============================================================
        # 1. Semantic Similarity (45% weight) - E5-Large embeddings
        # ============================================================
        semantic_sim = 0.0
        if embedding1 and embedding2 and len(embedding1) > 0 and len(embedding2) > 0:
            vec1 = np.array(embedding1)
            vec2 = np.array(embedding2)
            # Embeddings are normalized, so dot product = cosine similarity
            semantic_sim = float(np.dot(vec1, vec2))
            # Clamp to [0, 1]
            semantic_sim = max(0.0, min(1.0, semantic_sim))

        # ============================================================
        # 2. Lexical Similarity (30% weight) - MinHash
        # ============================================================
        lexical_sim = minhash.estimate_similarity(
            features1.content_minhash,
            features2.content_minhash,
        )

        # ============================================================
        # 3. Structural Similarity (25% weight)
        # ============================================================

        # 3a. Entity overlap (40% of structural)
        entity_overlap = self._compute_entity_similarity(features1, features2)

        # 3b. Geographic similarity (30% of structural)
        geo_sim = self._compute_geo_similarity(features1, features2)

        # 3c. Temporal proximity (30% of structural)
        temporal_proximity = max(0.0, 1.0 - (time_diff_hours / self.MAX_TIME_WINDOW_HOURS))

        # Combine structural components
        structural_sim = (
            self.STRUCTURAL_ENTITY_WEIGHT * entity_overlap +
            self.STRUCTURAL_GEO_WEIGHT * geo_sim +
            self.STRUCTURAL_TEMPORAL_WEIGHT * temporal_proximity
        )

        # ============================================================
        # Combine with hybrid weights
        # ============================================================

        # Handle missing semantic embeddings gracefully
        if embedding1 is None or embedding2 is None or len(embedding1) == 0 or len(embedding2) == 0:
            # Fall back to v3 formula if no embeddings
            overall = (
                self.HYBRID_LEXICAL_WEIGHT * lexical_sim +
                (self.HYBRID_SEMANTIC_WEIGHT + self.HYBRID_STRUCTURAL_WEIGHT) * structural_sim
            ) / (self.HYBRID_LEXICAL_WEIGHT + self.HYBRID_SEMANTIC_WEIGHT + self.HYBRID_STRUCTURAL_WEIGHT)
        else:
            # Full hybrid formula
            overall = (
                self.HYBRID_SEMANTIC_WEIGHT * semantic_sim +
                self.HYBRID_LEXICAL_WEIGHT * lexical_sim +
                self.HYBRID_STRUCTURAL_WEIGHT * structural_sim
            )

        return HybridSimilarityScore(
            overall=overall,
            semantic=semantic_sim,
            lexical=lexical_sim,
            structural=structural_sim,
            entity_overlap=entity_overlap,
            geo_similarity=geo_sim,
            temporal_proximity=temporal_proximity,
            blocked=False,
            block_reason=None,
        )

    def compute_hybrid_similarity_with_blocking(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
        embedding1: Optional[List[float]],
        embedding2: Optional[List[float]],
        time_diff_hours: float,
        category1: Optional[str] = None,
        category2: Optional[str] = None,
    ) -> HybridSimilarityScore:
        """
        Compute hybrid similarity with hard blocking rules applied.

        Applies blocking rules FIRST to prevent obviously different stories
        from being clustered, then computes similarity for non-blocked pairs.

        Blocking rules:
        - Different primary entities in title
        - Contradictory action types (arrest vs release)
        - Different specific locations (district mismatch with specific location)
        - Category mismatch for certain categories

        Returns:
            HybridSimilarityScore with blocked=True if blocked
        """
        # Check hard blocking rules
        blocked, block_reason = self._check_hybrid_blocking(
            features1, features2, category1, category2
        )

        if blocked:
            return HybridSimilarityScore(
                overall=0.0,
                semantic=0.0,
                lexical=0.0,
                structural=0.0,
                entity_overlap=0.0,
                geo_similarity=0.0,
                temporal_proximity=0.0,
                blocked=True,
                block_reason=block_reason,
            )

        # Not blocked, compute similarity
        return self.compute_hybrid_similarity(
            features1, features2, embedding1, embedding2,
            time_diff_hours, category1, category2
        )

    def _check_hybrid_blocking(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
        category1: Optional[str],
        category2: Optional[str],
    ) -> tuple:
        """
        Check hard blocking rules for hybrid clustering.

        Returns:
            (should_block, reason) tuple
        """
        # Title similarity escape hatch: if title tokens share significant content,
        # skip entity/district blocking (handles Nepali cross-referential titles
        # e.g., "धनगढी झडप" vs "कैलालीमा झडप" — same event, different place naming)
        tokens1 = set(features1.title_tokens) if features1.title_tokens else set()
        tokens2 = set(features2.title_tokens) if features2.title_tokens else set()
        shared_tokens = tokens1 & tokens2
        min_tokens = min(len(tokens1), len(tokens2)) if tokens1 and tokens2 else 1
        token_overlap_ratio = len(shared_tokens) / max(min_tokens, 1)
        has_title_overlap = token_overlap_ratio > 0.3 or len(shared_tokens) >= 3

        # Rule 1: Different primary entities in title (skip if titles overlap)
        if not has_title_overlap and features1.title_entities and features2.title_entities:
            entities1 = set(features1.title_entities)
            entities2 = set(features2.title_entities)
            if entities1 and entities2 and not (entities1 & entities2):
                return True, "different_title_entities"

        # Rule 2: Different action types (arrest vs release, death vs injury)
        if features1.title_action and features2.title_action:
            contradictions = {
                ("arrest", "release"), ("release", "arrest"),
                ("death", "injury"), ("injury", "death"),
                ("killed", "injured"), ("injured", "killed"),
            }
            action_pair = (
                features1.title_action.lower(),
                features2.title_action.lower()
            )
            if action_pair in contradictions:
                return True, "contradictory_actions"

        # Rule 3: Different districts (skip if titles overlap — handles city-in-district)
        if not has_title_overlap and features1.title_district and features2.title_district:
            if features1.title_district != features2.title_district:
                return True, "different_title_districts"

        # Rule 4: Category mismatch for disaster vs political
        if category1 and category2:
            incompatible_pairs = {
                ("disaster", "political"), ("political", "disaster"),
                ("disaster", "economic"), ("economic", "disaster"),
            }
            if (category1, category2) in incompatible_pairs:
                return True, "incompatible_categories"

        return False, None
