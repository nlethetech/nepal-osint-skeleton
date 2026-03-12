"""Bayesian source confidence model using Beta-Binomial."""
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class SourceStats:
    """Statistics for a single source."""
    source_id: str
    alpha: float  # Success count + prior
    beta: float   # Failure count + prior
    total_stories: int = 0
    reliable_count: int = 0
    unreliable_count: int = 0

    @property
    def mean_confidence(self) -> float:
        """Expected value of the Beta distribution."""
        return self.alpha / (self.alpha + self.beta)

    @property
    def variance(self) -> float:
        """Variance of the Beta distribution."""
        total = self.alpha + self.beta
        return (self.alpha * self.beta) / (total ** 2 * (total + 1))

    @property
    def confidence_interval(self) -> Tuple[float, float]:
        """95% credible interval for confidence."""
        try:
            from scipy import stats
            dist = stats.beta(self.alpha, self.beta)
            return (dist.ppf(0.025), dist.ppf(0.975))
        except ImportError:
            # Fallback approximation
            std = self.variance ** 0.5
            return (max(0, self.mean_confidence - 2*std),
                    min(1, self.mean_confidence + 2*std))


@dataclass
class SourceConfidenceResult:
    """Result of source confidence query."""
    source_id: str
    confidence: float
    uncertainty: float  # Standard deviation
    credible_interval: Tuple[float, float]
    sample_size: int


class SourceConfidenceModel:
    """
    Bayesian source reliability tracking.

    Uses Beta-Binomial model to track source reliability:
    - Prior: Beta(alpha_0, beta_0) - uninformative or slightly optimistic
    - Posterior: Beta(alpha_0 + successes, beta_0 + failures)

    Updates are instantaneous (no training required).
    Confidence naturally accounts for uncertainty due to sample size.
    """

    DEFAULT_ALPHA = 2.0  # Prior success count
    DEFAULT_BETA = 2.0   # Prior failure count

    def __init__(
        self,
        prior_alpha: float = DEFAULT_ALPHA,
        prior_beta: float = DEFAULT_BETA,
    ):
        """
        Initialize the source confidence model.

        Args:
            prior_alpha: Prior success count (higher = more optimistic prior)
            prior_beta: Prior failure count (higher = more pessimistic prior)
        """
        self.prior_alpha = prior_alpha
        self.prior_beta = prior_beta

        # Source statistics cache
        self._sources: Dict[str, SourceStats] = {}

    def get_confidence(self, source_id: str) -> SourceConfidenceResult:
        """
        Get confidence estimate for a source.

        Args:
            source_id: Source identifier

        Returns:
            SourceConfidenceResult with confidence and uncertainty
        """
        stats = self._get_or_create_source(source_id)

        return SourceConfidenceResult(
            source_id=source_id,
            confidence=stats.mean_confidence,
            uncertainty=stats.variance ** 0.5,
            credible_interval=stats.confidence_interval,
            sample_size=stats.total_stories,
        )

    def update_reliable(self, source_id: str, count: int = 1):
        """
        Update with reliable story feedback.

        Args:
            source_id: Source identifier
            count: Number of reliable stories (default 1)
        """
        stats = self._get_or_create_source(source_id)
        stats.alpha += count
        stats.reliable_count += count
        stats.total_stories += count

        logger.debug(
            f"Source {source_id} updated: +{count} reliable, "
            f"confidence={stats.mean_confidence:.3f}"
        )

    def update_unreliable(self, source_id: str, count: int = 1):
        """
        Update with unreliable story feedback.

        Args:
            source_id: Source identifier
            count: Number of unreliable stories (default 1)
        """
        stats = self._get_or_create_source(source_id)
        stats.beta += count
        stats.unreliable_count += count
        stats.total_stories += count

        logger.debug(
            f"Source {source_id} updated: +{count} unreliable, "
            f"confidence={stats.mean_confidence:.3f}"
        )

    def update_from_feedback(
        self,
        source_id: str,
        is_reliable: bool,
        weight: float = 1.0,
    ):
        """
        Update from human feedback.

        Args:
            source_id: Source identifier
            is_reliable: Whether the story was reliable
            weight: Feedback weight (0.0 to 1.0)
        """
        if is_reliable:
            self.update_reliable(source_id, int(weight))
        else:
            self.update_unreliable(source_id, int(weight))

    def _get_or_create_source(self, source_id: str) -> SourceStats:
        """Get or create source statistics."""
        if source_id not in self._sources:
            self._sources[source_id] = SourceStats(
                source_id=source_id,
                alpha=self.prior_alpha,
                beta=self.prior_beta,
            )
        return self._sources[source_id]

    def get_all_sources(self) -> Dict[str, SourceConfidenceResult]:
        """Get confidence for all tracked sources."""
        return {
            source_id: self.get_confidence(source_id)
            for source_id in self._sources
        }

    def get_ranked_sources(
        self,
        min_samples: int = 5,
        descending: bool = True,
    ) -> list:
        """
        Get sources ranked by confidence.

        Args:
            min_samples: Minimum sample size to include
            descending: Sort descending (most reliable first)

        Returns:
            List of SourceConfidenceResult sorted by confidence
        """
        results = []
        for source_id, stats in self._sources.items():
            if stats.total_stories >= min_samples:
                results.append(self.get_confidence(source_id))

        results.sort(key=lambda x: x.confidence, reverse=descending)
        return results

    def sample_confidence(self, source_id: str) -> float:
        """
        Sample a confidence value from the posterior.

        Useful for Thompson Sampling in exploration.

        Args:
            source_id: Source identifier

        Returns:
            Sampled confidence value
        """
        import numpy as np

        stats = self._get_or_create_source(source_id)
        return float(np.random.beta(stats.alpha, stats.beta))

    def save(self, path: Path):
        """Save model state to file."""
        state = {
            "prior_alpha": self.prior_alpha,
            "prior_beta": self.prior_beta,
            "sources": {
                source_id: {
                    "alpha": stats.alpha,
                    "beta": stats.beta,
                    "total_stories": stats.total_stories,
                    "reliable_count": stats.reliable_count,
                    "unreliable_count": stats.unreliable_count,
                }
                for source_id, stats in self._sources.items()
            },
        }

        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(state, f, indent=2)

        logger.info(f"Saved SourceConfidenceModel to {path}")

    def load(self, path: Path):
        """Load model state from file."""
        if not path.exists():
            logger.warning(f"Source confidence file not found: {path}")
            return

        with open(path) as f:
            state = json.load(f)

        self.prior_alpha = state.get("prior_alpha", self.DEFAULT_ALPHA)
        self.prior_beta = state.get("prior_beta", self.DEFAULT_BETA)

        for source_id, data in state.get("sources", {}).items():
            self._sources[source_id] = SourceStats(
                source_id=source_id,
                alpha=data["alpha"],
                beta=data["beta"],
                total_stories=data.get("total_stories", 0),
                reliable_count=data.get("reliable_count", 0),
                unreliable_count=data.get("unreliable_count", 0),
            )

        logger.info(f"Loaded SourceConfidenceModel from {path} ({len(self._sources)} sources)")

    def decay_priors(self, decay_factor: float = 0.99):
        """
        Apply decay to all source statistics.

        This prevents old data from dominating and allows adaptation
        to changing source quality.

        Args:
            decay_factor: Multiplicative decay (0.99 = 1% decay)
        """
        for stats in self._sources.values():
            # Decay towards prior
            stats.alpha = self.prior_alpha + (stats.alpha - self.prior_alpha) * decay_factor
            stats.beta = self.prior_beta + (stats.beta - self.prior_beta) * decay_factor
