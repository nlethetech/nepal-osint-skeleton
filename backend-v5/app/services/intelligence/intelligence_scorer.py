"""
Intelligence Scorer - Palantir-grade intelligence scoring for story clusters.

Computes weighted intelligence scores based on:
- Source credibility (20%)
- Corroboration (25%)
- Recency (15%)
- Severity (25%)
- Nepal relevance (15%)

Score range: 0-100
Actionability levels: immediate | monitor | archive
"""
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, Any, TYPE_CHECKING, List

if TYPE_CHECKING:
    from app.models.story_cluster import StoryCluster
    from app.services.corroboration.corroboration_service import CorroborationResult

logger = logging.getLogger(__name__)


@dataclass
class IntelligenceScore:
    """
    Intelligence score for a story cluster.

    Attributes:
        overall_score: Weighted score (0-100)
        components: Individual component scores (0-1)
        actionability: Classification: immediate | monitor | archive
        reasoning: Human-readable explanation
    """
    overall_score: float
    components: Dict[str, float]
    actionability: str
    reasoning: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "overall_score": round(self.overall_score, 1),
            "components": {k: round(v, 3) for k, v in self.components.items()},
            "actionability": self.actionability,
            "reasoning": self.reasoning,
        }


class IntelligenceScorer:
    """
    Palantir-grade intelligence scoring service.

    Formula: INTEL = SOURCE × CORROBORATION × RECENCY × SEVERITY × RELEVANCE
    (Weighted sum, normalized to 0-100)

    Weights:
    - source_credibility: 0.20 (quality of sources)
    - corroboration: 0.25 (multi-source verification)
    - recency: 0.15 (time decay)
    - severity: 0.25 (impact level)
    - nepal_relevance: 0.15 (direct vs indirect)
    """

    # Component weights (must sum to 1.0)
    WEIGHTS = {
        "source_credibility": 0.20,
        "corroboration": 0.25,
        "recency": 0.15,
        "severity": 0.25,
        "nepal_relevance": 0.15,
    }

    # Source tier scores (0-1)
    SOURCE_TIER_SCORES = {
        "tier1_wire": 0.95,      # AFP, Reuters, AP
        "tier2_national": 0.85,  # Kathmandu Post, Republica
        "tier3_regional": 0.70,  # Local newspapers
        "tier4_social": 0.50,    # Twitter, Facebook
        "tier5_unverified": 0.30,
    }

    # Severity scores (0-1)
    SEVERITY_SCORES = {
        "critical": 1.0,
        "high": 0.75,
        "medium": 0.50,
        "low": 0.25,
    }

    # Nepal relevance scores (0-1)
    RELEVANCE_SCORES = {
        "NEPAL_DOMESTIC": 1.0,
        "direct": 1.0,
        "NEPAL_NEIGHBOR": 0.75,
        "indirect": 0.50,
        "peripheral": 0.25,
        "none": 0.0,
    }

    # Recency half-life in hours (score halves every N hours)
    RECENCY_HALF_LIFE_HOURS = 6

    # Actionability thresholds
    IMMEDIATE_THRESHOLD = 70
    MONITOR_THRESHOLD = 40

    def __init__(self):
        """Initialize intelligence scorer."""
        pass

    def score(
        self,
        cluster: Any,  # StoryCluster or dict
        corroboration: Optional[Any] = None,  # CorroborationResult or dict
        current_time: Optional[datetime] = None,
    ) -> IntelligenceScore:
        """
        Compute intelligence score for a cluster.

        Args:
            cluster: StoryCluster object or dict with cluster data
            corroboration: Optional CorroborationResult (will compute if not provided)
            current_time: Current time for recency calculation (default: now)

        Returns:
            IntelligenceScore with overall score, components, and actionability
        """
        if current_time is None:
            current_time = datetime.now(timezone.utc)

        components = {}

        # 1. Source credibility
        components["source_credibility"] = self._compute_source_credibility(cluster, corroboration)

        # 2. Corroboration
        components["corroboration"] = self._compute_corroboration_score(cluster, corroboration)

        # 3. Recency
        components["recency"] = self._compute_recency_score(cluster, current_time)

        # 4. Severity
        components["severity"] = self._compute_severity_score(cluster)

        # 5. Nepal relevance
        components["nepal_relevance"] = self._compute_relevance_score(cluster)

        # Weighted sum
        overall = sum(
            self.WEIGHTS[k] * components[k]
            for k in self.WEIGHTS
        ) * 100  # Scale to 0-100

        # Determine actionability
        actionability = self._determine_actionability(overall, components)

        # Generate reasoning
        reasoning = self._generate_reasoning(components, overall, actionability)

        return IntelligenceScore(
            overall_score=overall,
            components=components,
            actionability=actionability,
            reasoning=reasoning,
        )

    def _compute_source_credibility(
        self,
        cluster: Any,
        corroboration: Optional[Any],
    ) -> float:
        """
        Compute average source tier score.

        Uses the highest-tier source if multiple sources exist.
        """
        # Get source types from corroboration if available
        source_types = {}
        if corroboration:
            if hasattr(corroboration, 'source_types'):
                source_types = corroboration.source_types
            elif isinstance(corroboration, dict):
                source_types = corroboration.get('source_types', {})

        if not source_types:
            # Fallback: use source_count to estimate
            source_count = 1
            if hasattr(cluster, 'source_count'):
                source_count = cluster.source_count or 1
            elif isinstance(cluster, dict):
                source_count = cluster.get('source_count', 1)

            # Default to tier3 for unknown
            return self.SOURCE_TIER_SCORES.get("tier3_regional", 0.70)

        # Use weighted average with bonus for higher tiers
        total_score = 0
        total_weight = 0

        for tier, count in source_types.items():
            tier_score = self.SOURCE_TIER_SCORES.get(tier, 0.50)
            # Give more weight to higher-tier sources
            weight = count * (1 + tier_score)
            total_score += tier_score * weight
            total_weight += weight

        if total_weight == 0:
            return 0.50

        return total_score / total_weight

    def _compute_corroboration_score(
        self,
        cluster: Any,
        corroboration: Optional[Any],
    ) -> float:
        """
        Compute corroboration score based on source count and diversity.

        Formula: 0.4 * min(source_count/5, 1) + 0.6 * diversity_score
        """
        source_count = 1
        diversity_score = 0.0

        if corroboration:
            if hasattr(corroboration, 'source_count'):
                source_count = corroboration.source_count or 1
                diversity_score = corroboration.diversity_score or 0.0
            elif isinstance(corroboration, dict):
                source_count = corroboration.get('source_count', 1)
                diversity_score = corroboration.get('diversity_score', 0.0)
        else:
            # Fallback to cluster fields
            if hasattr(cluster, 'source_count'):
                source_count = cluster.source_count or 1
            elif isinstance(cluster, dict):
                source_count = cluster.get('source_count', 1)

            if hasattr(cluster, 'diversity_score'):
                diversity_score = cluster.diversity_score or 0.0
            elif isinstance(cluster, dict):
                diversity_score = cluster.get('diversity_score', 0.0)

        # Combine: source count (capped at 5) + diversity
        count_score = min(source_count / 5.0, 1.0)
        return 0.4 * count_score + 0.6 * diversity_score

    def _compute_recency_score(
        self,
        cluster: Any,
        current_time: datetime,
    ) -> float:
        """
        Compute recency score with exponential decay.

        Score = exp(-ln(2) * age_hours / half_life)
        Half-life of 6 hours means score halves every 6 hours.
        """
        first_published = None

        if hasattr(cluster, 'first_published'):
            first_published = cluster.first_published
        elif isinstance(cluster, dict):
            first_published = cluster.get('first_published')

        if first_published is None:
            return 0.5  # Default for unknown age

        # Ensure timezone awareness
        if first_published.tzinfo is None:
            first_published = first_published.replace(tzinfo=timezone.utc)

        age_hours = (current_time - first_published).total_seconds() / 3600
        age_hours = max(0, age_hours)  # No negative ages

        # Exponential decay: ln(2) ≈ 0.693
        decay = math.exp(-0.693 * age_hours / self.RECENCY_HALF_LIFE_HOURS)

        return decay

    def _compute_severity_score(self, cluster: Any) -> float:
        """Compute severity score from cluster severity level."""
        severity = None

        if hasattr(cluster, 'severity'):
            severity = cluster.severity
        elif isinstance(cluster, dict):
            severity = cluster.get('severity')

        if severity is None:
            return 0.50  # Default to medium

        return self.SEVERITY_SCORES.get(severity.lower(), 0.50)

    def _compute_relevance_score(self, cluster: Any) -> float:
        """Compute Nepal relevance score."""
        relevance = None

        # Try nepal_relevance first
        if hasattr(cluster, 'nepal_relevance'):
            relevance = cluster.nepal_relevance
        elif isinstance(cluster, dict):
            relevance = cluster.get('nepal_relevance')

        if relevance is None:
            # Assume domestic if Nepal-related content
            return 0.75

        return self.RELEVANCE_SCORES.get(relevance, 0.50)

    def _determine_actionability(
        self,
        overall_score: float,
        components: Dict[str, float],
    ) -> str:
        """
        Determine actionability based on score and severity.

        Rules:
        - immediate: score >= 70 AND severity >= 0.75 (high/critical)
        - monitor: score >= 40
        - archive: score < 40
        """
        severity = components.get("severity", 0.50)

        if overall_score >= self.IMMEDIATE_THRESHOLD and severity >= 0.75:
            return "immediate"
        elif overall_score >= self.MONITOR_THRESHOLD:
            return "monitor"
        else:
            return "archive"

    def _generate_reasoning(
        self,
        components: Dict[str, float],
        overall: float,
        actionability: str,
    ) -> str:
        """Generate human-readable reasoning for the score."""
        reasons = []

        # Identify strongest components
        sorted_components = sorted(
            components.items(),
            key=lambda x: x[1],
            reverse=True
        )

        top = sorted_components[0]
        bottom = sorted_components[-1]

        # Build reasoning
        if components["severity"] >= 0.75:
            reasons.append("High-severity event")
        elif components["severity"] <= 0.25:
            reasons.append("Low-severity routine news")

        if components["corroboration"] >= 0.7:
            reasons.append("well-corroborated by multiple sources")
        elif components["corroboration"] <= 0.3:
            reasons.append("single source, needs verification")

        if components["recency"] >= 0.8:
            reasons.append("breaking/recent")
        elif components["recency"] <= 0.3:
            reasons.append("aging story")

        if components["source_credibility"] >= 0.9:
            reasons.append("from tier-1 sources")

        # Actionability explanation
        if actionability == "immediate":
            reasons.append("requires immediate attention")
        elif actionability == "monitor":
            reasons.append("monitor for developments")
        else:
            reasons.append("can be archived")

        return "; ".join(reasons) if reasons else "Standard news item"

    def score_batch(
        self,
        clusters: List[Any],
        corroborations: Optional[List[Any]] = None,
    ) -> List[IntelligenceScore]:
        """
        Score multiple clusters efficiently.

        Args:
            clusters: List of StoryCluster objects or dicts
            corroborations: Optional list of CorroborationResults (1:1 with clusters)

        Returns:
            List of IntelligenceScore objects
        """
        current_time = datetime.now(timezone.utc)
        scores = []

        for i, cluster in enumerate(clusters):
            corr = None
            if corroborations and i < len(corroborations):
                corr = corroborations[i]

            score = self.score(cluster, corr, current_time)
            scores.append(score)

        return scores


# Singleton instance
_scorer_instance: Optional[IntelligenceScorer] = None


def get_intelligence_scorer() -> IntelligenceScorer:
    """Get or create the intelligence scorer singleton."""
    global _scorer_instance
    if _scorer_instance is None:
        _scorer_instance = IntelligenceScorer()
    return _scorer_instance
