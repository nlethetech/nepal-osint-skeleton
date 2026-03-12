"""
Corroboration Service - Multi-source verification and tracking.

Provides Palantir-grade corroboration metrics for story clusters:
- Source count and diversity
- Simpson Diversity Index for source heterogeneity
- Confirmation chain (chronological source sequence)
- Confidence level classification
- Source agreement metrics
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Dict, Optional, Any, TYPE_CHECKING
from collections import Counter

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

if TYPE_CHECKING:
    from app.models.story_cluster import StoryCluster
    from app.models.story import Story

logger = logging.getLogger(__name__)


@dataclass
class SourceInfo:
    """Information about a source in a cluster."""
    name: str
    source_type: Optional[str] = None  # wire, national, regional, social, govt
    tier: Optional[str] = None  # tier1_wire, tier2_national, etc.
    count: int = 1


@dataclass
class ConfirmationChainEntry:
    """Entry in the confirmation chain (chronological source sequence)."""
    source: str
    source_type: Optional[str]
    timestamp: str  # ISO format
    snippet: str  # First 100 chars of title
    language: Optional[str] = None


@dataclass
class CorroborationResult:
    """
    Comprehensive corroboration metrics for a story cluster.

    Attributes:
        source_count: Number of unique sources reporting this story
        unique_sources: List of unique source names
        diversity_score: Simpson Diversity Index (0-1, higher = more diverse)
        confirmation_chain: Chronological list of source reports
        confidence_level: Classification based on source count/diversity
        source_types: Breakdown by source type (wire, local, social, etc.)
        languages: List of languages in the cluster
        cross_lingual: Whether cluster contains multiple languages
        agreement_metrics: Agreement between sources on key facts
    """
    source_count: int
    unique_sources: List[str]
    diversity_score: float  # Simpson Diversity Index
    confirmation_chain: List[ConfirmationChainEntry]
    confidence_level: str  # single_source | corroborated | well_corroborated | highly_corroborated
    source_types: Dict[str, int] = field(default_factory=dict)
    languages: List[str] = field(default_factory=list)
    cross_lingual: bool = False
    agreement_metrics: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "source_count": self.source_count,
            "unique_sources": self.unique_sources,
            "diversity_score": round(self.diversity_score, 3),
            "confidence_level": self.confidence_level,
            "confirmation_chain": [
                {
                    "source": entry.source,
                    "source_type": entry.source_type,
                    "timestamp": entry.timestamp,
                    "snippet": entry.snippet,
                    "language": entry.language,
                }
                for entry in self.confirmation_chain
            ],
            "source_types": self.source_types,
            "languages": self.languages,
            "cross_lingual": self.cross_lingual,
            "agreement_metrics": {
                k: round(v, 3) for k, v in self.agreement_metrics.items()
            },
        }


class CorroborationService:
    """
    Service for computing and tracking multi-source corroboration.

    Key features:
    - Simpson Diversity Index for measuring source heterogeneity
    - Confirmation chain tracking (who reported when)
    - Source agreement metrics
    - Cross-lingual detection
    """

    # Source tier mappings for credibility weighting
    SOURCE_TIERS = {
        "tier1_wire": ["reuters", "afp", "ap", "xinhua"],
        "tier2_national": ["kathmandu_post", "republica", "himalayan_times", "ekantipur"],
        "tier3_regional": ["nagarik", "gorkhapatra", "annapurna_post"],
        "tier4_social": ["twitter", "facebook", "youtube"],
        "tier5_unverified": [],
    }

    def __init__(self, db: Optional[AsyncSession] = None):
        """Initialize corroboration service."""
        self.db = db

    def compute_corroboration(
        self,
        stories: List[Any],  # List of Story objects or dicts
    ) -> CorroborationResult:
        """
        Compute corroboration metrics for a list of stories.

        This is the main method for computing how well-corroborated a story cluster is.

        Args:
            stories: List of Story objects or dicts with source_id, published_at, title, language

        Returns:
            CorroborationResult with all metrics
        """
        if not stories:
            return CorroborationResult(
                source_count=0,
                unique_sources=[],
                diversity_score=0.0,
                confirmation_chain=[],
                confidence_level="single_source",
            )

        # Extract source information
        sources = []
        source_counts: Counter = Counter()
        source_types: Counter = Counter()
        languages = set()

        for story in stories:
            # Handle both Story objects and dicts
            if hasattr(story, 'source_id'):
                source_id = story.source_id or "unknown"
                source_name = getattr(story, 'source_name', None) or source_id
                published_at = story.published_at
                title = story.title
                language = getattr(story, 'language', None)
                source_type = self._get_source_type(source_id)
            else:
                source_id = story.get('source_id', 'unknown')
                source_name = story.get('source_name', source_id)
                published_at = story.get('published_at')
                title = story.get('title', '')
                language = story.get('language')
                source_type = self._get_source_type(source_id)

            sources.append({
                'source': source_name,
                'source_type': source_type,
                'timestamp': published_at.isoformat() if published_at else '',
                'snippet': (title or '')[:100],
                'language': language,
            })

            source_counts[source_name] += 1
            source_types[source_type] += 1
            if language:
                languages.add(language)

        # Compute unique sources
        unique_sources = list(source_counts.keys())
        source_count = len(unique_sources)

        # Compute Simpson Diversity Index
        diversity_score = self._compute_simpson_diversity(source_counts)

        # Build confirmation chain (chronological order)
        confirmation_chain = sorted(
            [
                ConfirmationChainEntry(
                    source=s['source'],
                    source_type=s['source_type'],
                    timestamp=s['timestamp'],
                    snippet=s['snippet'],
                    language=s['language'],
                )
                for s in sources
            ],
            key=lambda x: x.timestamp,
        )

        # Determine confidence level
        confidence_level = self._determine_confidence_level(source_count, diversity_score)

        # Detect cross-lingual
        cross_lingual = len(languages) > 1

        # Compute agreement metrics
        agreement_metrics = self._compute_agreement_metrics(stories)

        return CorroborationResult(
            source_count=source_count,
            unique_sources=unique_sources,
            diversity_score=diversity_score,
            confirmation_chain=confirmation_chain,
            confidence_level=confidence_level,
            source_types=dict(source_types),
            languages=list(languages),
            cross_lingual=cross_lingual,
            agreement_metrics=agreement_metrics,
        )

    def _compute_simpson_diversity(self, source_counts: Counter) -> float:
        """
        Compute Simpson Diversity Index.

        Formula: D = 1 - Σ(p_i²)

        Where p_i is the proportion of stories from source i.
        Range: 0 (no diversity, single source) to approaching 1 (high diversity)

        A higher score means sources are more evenly distributed,
        which indicates better corroboration.
        """
        total = sum(source_counts.values())
        if total <= 1:
            return 0.0

        sum_squared = sum(
            (count / total) ** 2
            for count in source_counts.values()
        )

        return 1.0 - sum_squared

    def _determine_confidence_level(
        self,
        source_count: int,
        diversity_score: float,
    ) -> str:
        """
        Determine confidence level based on source count and diversity.

        Levels:
        - single_source: Only 1 source
        - corroborated: 2 sources
        - well_corroborated: 3-4 sources
        - highly_corroborated: 5+ sources OR 3+ sources with high diversity
        """
        if source_count == 1:
            return "single_source"
        elif source_count == 2:
            return "corroborated"
        elif source_count <= 4:
            # 3-4 sources with high diversity = highly corroborated
            if diversity_score >= 0.7:
                return "highly_corroborated"
            return "well_corroborated"
        else:
            return "highly_corroborated"

    def _get_source_type(self, source_id: str) -> str:
        """Determine source type from source ID."""
        source_lower = source_id.lower()

        for tier, sources in self.SOURCE_TIERS.items():
            for source_name in sources:
                if source_name in source_lower:
                    return tier

        # Default heuristics
        if any(term in source_lower for term in ['twitter', 'x.com', 'facebook', 'youtube']):
            return "tier4_social"
        elif any(term in source_lower for term in ['govt', 'government', 'ministry', 'official']):
            return "tier2_national"
        else:
            return "tier3_regional"

    def _compute_agreement_metrics(self, stories: List[Any]) -> Dict[str, float]:
        """
        Compute agreement metrics between sources on key facts.

        Metrics:
        - entity_agreement: Jaccard overlap of entities across stories
        - severity_agreement: Proportion agreeing on severity level
        - category_agreement: Proportion agreeing on category
        """
        if len(stories) < 2:
            return {
                "entity_agreement": 1.0,
                "severity_agreement": 1.0,
                "category_agreement": 1.0,
                "overall_agreement": 1.0,
            }

        # Extract attributes safely
        entities_list = []
        severities = []
        categories = []

        for story in stories:
            if hasattr(story, 'entities'):
                entities_list.append(set(story.entities or []))
            elif isinstance(story, dict):
                entities_list.append(set(story.get('entities') or []))

            if hasattr(story, 'severity'):
                severities.append(story.severity)
            elif isinstance(story, dict):
                severities.append(story.get('severity'))

            if hasattr(story, 'category'):
                categories.append(story.category)
            elif isinstance(story, dict):
                categories.append(story.get('category'))

        # Entity agreement (Jaccard)
        entity_agreement = 1.0
        if len(entities_list) >= 2 and any(entities_list):
            non_empty = [e for e in entities_list if e]
            if len(non_empty) >= 2:
                intersection = set.intersection(*non_empty)
                union = set.union(*non_empty)
                entity_agreement = len(intersection) / max(len(union), 1)

        # Severity agreement (majority vote)
        severity_agreement = 1.0
        valid_severities = [s for s in severities if s]
        if len(valid_severities) >= 2:
            majority = Counter(valid_severities).most_common(1)[0]
            severity_agreement = majority[1] / len(valid_severities)

        # Category agreement (majority vote)
        category_agreement = 1.0
        valid_categories = [c for c in categories if c]
        if len(valid_categories) >= 2:
            majority = Counter(valid_categories).most_common(1)[0]
            category_agreement = majority[1] / len(valid_categories)

        # Overall agreement
        overall = (entity_agreement + severity_agreement + category_agreement) / 3

        return {
            "entity_agreement": entity_agreement,
            "severity_agreement": severity_agreement,
            "category_agreement": category_agreement,
            "overall_agreement": overall,
        }

    async def compute_for_cluster(
        self,
        cluster_id: str,
    ) -> CorroborationResult:
        """
        Compute corroboration for a cluster by ID.

        Fetches stories from database and computes corroboration.
        """
        if not self.db:
            raise RuntimeError("Database session required for cluster lookup")

        from app.models.story import Story
        from app.models.story_cluster import StoryCluster

        # Fetch cluster with stories
        result = await self.db.execute(
            select(Story).where(Story.cluster_id == cluster_id)
        )
        stories = result.scalars().all()

        return self.compute_corroboration(list(stories))


# Singleton instance
_corroboration_service: Optional[CorroborationService] = None


def get_corroboration_service(db: Optional[AsyncSession] = None) -> CorroborationService:
    """Get or create the corroboration service singleton."""
    global _corroboration_service
    if _corroboration_service is None or db is not None:
        _corroboration_service = CorroborationService(db=db)
    return _corroboration_service
