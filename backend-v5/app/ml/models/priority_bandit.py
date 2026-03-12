"""
Contextual bandit for priority/severity scoring.

Enhanced version with 32-dimensional semantic feature vector:
- Category one-hot (5)
- Semantic severity scores (4)
- Entity type counts (4)
- Entity importance (1)
- Source confidence (1)
- Text embedding PCA (10)
- Temporal features (4)
- Linguistic features (3)
"""
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available - PriorityBandit will use fallback")


@dataclass
class PriorityPrediction:
    """Result of priority prediction."""
    priority: str
    confidence: float
    all_scores: Dict[str, float]


class ContextualBanditNetwork(nn.Module if TORCH_AVAILABLE else object):
    """
    Neural network for contextual bandit priority scoring.

    Takes context features and outputs scores for each priority level.
    Uses Thompson Sampling for exploration during training.
    """

    def __init__(
        self,
        input_dim: int,
        hidden_dim: int,
        num_actions: int,
        dropout: float = 0.2,
    ):
        if not TORCH_AVAILABLE:
            return
        super().__init__()

        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, hidden_dim)
        self.fc3 = nn.Linear(hidden_dim, num_actions)
        self.dropout = nn.Dropout(dropout)

        # For uncertainty estimation (used in Thompson Sampling)
        self.log_var = nn.Linear(hidden_dim, num_actions)

    def forward(self, x: "torch.Tensor") -> Tuple["torch.Tensor", "torch.Tensor"]:
        """
        Forward pass.

        Args:
            x: (batch, input_dim) context features

        Returns:
            (mean_scores, log_variance) for each action
        """
        x = F.relu(self.fc1(x))
        x = self.dropout(x)
        x = F.relu(self.fc2(x))
        x = self.dropout(x)

        mean = self.fc3(x)
        log_var = self.log_var(x)

        return mean, log_var

    def sample(self, x: "torch.Tensor") -> "torch.Tensor":
        """
        Sample actions using Thompson Sampling.

        Samples from the posterior to balance exploration/exploitation.
        """
        mean, log_var = self.forward(x)
        std = torch.exp(0.5 * log_var)

        # Sample from Gaussian posterior
        eps = torch.randn_like(std)
        sampled = mean + eps * std

        return sampled


class PriorityBandit:
    """
    Contextual bandit for predicting story priority.

    Learns from human feedback to predict:
    - critical: Immediate attention required
    - high: Important, monitor closely
    - medium: Standard priority
    - low: Background monitoring

    Uses Thompson Sampling for exploration during learning.
    """

    PRIORITIES = ["low", "medium", "high", "critical"]
    PRIORITY_VALUES = {"low": 0, "medium": 1, "high": 2, "critical": 3}

    # Enhanced context feature dimensions (v2):
    # Category one-hot (5) + Semantic severity (4) + Entity type counts (4) +
    # Entity importance (1) + Source confidence (1) + Embedding PCA (10) +
    # Temporal features (4) + Linguistic features (3) = 32 features
    DEFAULT_INPUT_DIM = 32

    # Legacy input dimension for backward compatibility
    LEGACY_INPUT_DIM = 14

    # PCA components for embedding projection (pre-trained)
    # Will be initialized lazily when needed
    _pca_matrix: Optional[np.ndarray] = None
    _pca_mean: Optional[np.ndarray] = None

    # Hedging words for certainty detection
    HEDGING_WORDS = {
        "allegedly", "reportedly", "claimed", "unconfirmed", "rumored",
        "possibly", "perhaps", "might", "could", "may", "uncertain",
        "कथित", "अपुष्ट", "सम्भवतः", "हुनसक्छ", "भनिएको",
    }

    # Negative sentiment words (English + Nepali)
    NEGATIVE_WORDS = {
        "killed", "death", "murder", "attack", "violence", "clash", "bomb",
        "explosion", "injured", "wounded", "arrested", "corruption", "fraud",
        "crisis", "disaster", "tragedy", "victims", "casualties", "threat",
        "मृत्यु", "हत्या", "आक्रमण", "हिंसा", "विस्फोट", "घाइते",
        "गिरफ्तार", "भ्रष्टाचार", "संकट", "दुर्घटना", "पीडित",
    }

    # Positive sentiment words (English + Nepali)
    POSITIVE_WORDS = {
        "success", "achievement", "victory", "celebration", "peace",
        "agreement", "progress", "development", "growth", "improvement",
        "सफलता", "उपलब्धि", "जित", "उत्सव", "शान्ति", "सम्झौता",
        "प्रगति", "विकास", "सुधार",
    }

    def __init__(
        self,
        input_dim: int = DEFAULT_INPUT_DIM,
        hidden_dim: int = 64,
        dropout: float = 0.2,
    ):
        """
        Initialize the priority bandit.

        Args:
            input_dim: Dimension of context features
            hidden_dim: Hidden layer dimension
            dropout: Dropout probability
        """
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.dropout = dropout
        self.num_actions = len(self.PRIORITIES)

        self.model: Optional[ContextualBanditNetwork] = None
        self._initialized = False
        self._device = "cpu"

        # Exploration rate (decays over time)
        self.exploration_rate = 1.0
        self.exploration_decay = 0.995
        self.min_exploration = 0.1

    def initialize(self, device: str = "cpu"):
        """Initialize the model."""
        if not TORCH_AVAILABLE:
            logger.warning("PyTorch not available, using rule-based fallback")
            self._initialized = True
            return

        self._device = device
        self.model = ContextualBanditNetwork(
            input_dim=self.input_dim,
            hidden_dim=self.hidden_dim,
            num_actions=self.num_actions,
            dropout=self.dropout,
        ).to(device)

        self._initialized = True
        logger.info(f"PriorityBandit initialized on {device}")

    def extract_context_features(
        self,
        category: Optional[str] = None,
        severity_keywords: List[str] = None,
        source_confidence: float = 0.5,
        entity_count: int = 0,
        hour_of_day: int = 12,
        day_of_week: int = 0,
        is_weekend: bool = False,
    ) -> np.ndarray:
        """
        Extract context features for prediction.

        Args:
            category: Story category
            severity_keywords: Keywords that indicate severity
            source_confidence: Source reliability score
            entity_count: Number of named entities
            hour_of_day: Hour (0-23)
            day_of_week: Day (0-6, Monday=0)
            is_weekend: Whether it's a weekend

        Returns:
            Feature vector
        """
        features = []

        # Category one-hot (5 dims)
        categories = ["political", "economic", "security", "disaster", "social"]
        cat_idx = categories.index(category) if category in categories else -1
        features.extend([1.0 if i == cat_idx else 0.0 for i in range(5)])

        # Severity keyword counts (4 dims)
        severity_keywords = severity_keywords or []
        critical_words = {"killed", "death", "bomb", "explosion", "earthquake"}
        high_words = {"injured", "arrest", "flood", "landslide", "clash", "violence"}
        medium_words = {"protest", "strike", "meeting", "announcement"}
        low_words = {"festival", "culture", "sports"}

        features.append(float(sum(1 for kw in severity_keywords if kw in critical_words)))
        features.append(float(sum(1 for kw in severity_keywords if kw in high_words)))
        features.append(float(sum(1 for kw in severity_keywords if kw in medium_words)))
        features.append(float(sum(1 for kw in severity_keywords if kw in low_words)))

        # Source confidence (1 dim)
        features.append(float(source_confidence))

        # Entity count normalized (1 dim)
        features.append(min(float(entity_count) / 10.0, 1.0))

        # Time features (3 dims)
        features.append(float(hour_of_day) / 24.0)
        features.append(float(day_of_week) / 7.0)
        features.append(1.0 if is_weekend else 0.0)

        return np.array(features, dtype=np.float32)

    def extract_context_features_v2(
        self,
        text: str,
        category: Optional[str] = None,
        source_confidence: float = 0.5,
        entities: Optional[List[Dict[str, Any]]] = None,
        published_at: Optional[datetime] = None,
        embedder=None,
        severity_detector=None,
    ) -> np.ndarray:
        """
        Extract enhanced 32-dimensional context features.

        This is the v2 feature extractor that uses:
        - Semantic severity detection (embedding-based)
        - Entity type analysis
        - Text embedding compression
        - Linguistic features

        Args:
            text: Story text (title + content)
            category: Story category
            source_confidence: Source reliability (0-1)
            entities: List of entity dicts from HybridNER
            published_at: Publication timestamp
            embedder: MultilingualTextEmbedder instance (optional, lazy-loaded)
            severity_detector: SemanticSeverityDetector instance (optional, lazy-loaded)

        Returns:
            32-dimensional feature vector
        """
        features = []
        entities = entities or []
        published_at = published_at or datetime.now()

        # === 1. Category one-hot (5 dims) ===
        categories = ["political", "economic", "security", "disaster", "social"]
        cat_idx = categories.index(category) if category in categories else -1
        features.extend([1.0 if i == cat_idx else 0.0 for i in range(5)])

        # === 2. Semantic severity scores (4 dims) ===
        if severity_detector is None:
            try:
                from app.ml.features.semantic_severity import get_severity_detector
                severity_detector = get_severity_detector()
            except ImportError:
                logger.warning("SemanticSeverityDetector not available")
                severity_detector = None

        if severity_detector is not None and text:
            try:
                _, _, severity_probs = severity_detector.detect_severity(text)
                features.extend([
                    severity_probs.get("critical", 0.0),
                    severity_probs.get("high", 0.0),
                    severity_probs.get("medium", 0.0),
                    severity_probs.get("low", 0.0),
                ])
            except Exception as e:
                logger.debug(f"Severity detection failed: {e}")
                features.extend([0.0, 0.0, 0.5, 0.5])  # Neutral default
        else:
            features.extend([0.0, 0.0, 0.5, 0.5])

        # === 3. Entity type counts (4 dims) ===
        entity_counts = {"PERSON": 0, "ORGANIZATION": 0, "LOCATION": 0, "OTHER": 0}
        for ent in entities:
            etype = ent.get("type", "OTHER")
            if etype in entity_counts:
                entity_counts[etype] += 1
            else:
                entity_counts["OTHER"] += 1

        features.extend([
            min(entity_counts["PERSON"] / 3.0, 1.0),
            min(entity_counts["ORGANIZATION"] / 2.0, 1.0),
            min(entity_counts["LOCATION"] / 3.0, 1.0),
            min(entity_counts["OTHER"] / 2.0, 1.0),
        ])

        # === 4. Entity importance (1 dim) ===
        # Rule-based entities are "known" important entities
        known_entity_count = sum(
            1 for e in entities if e.get("source") == "rule_based"
        )
        features.append(min(known_entity_count / 2.0, 1.0))

        # === 5. Source confidence (1 dim) ===
        features.append(float(source_confidence))

        # === 6. Text embedding PCA projection (10 dims) ===
        embedding_features = self._extract_embedding_features(text, embedder)
        features.extend(embedding_features)

        # === 7. Temporal features (4 dims) ===
        hour = published_at.hour / 24.0
        day = published_at.weekday() / 7.0
        is_weekend = 1.0 if published_at.weekday() >= 5 else 0.0

        # Recency: how recent relative to now (decays over 48 hours)
        age_hours = (datetime.now() - published_at).total_seconds() / 3600
        recency = max(0.0, 1.0 - age_hours / 48.0)

        features.extend([hour, day, is_weekend, recency])

        # === 8. Linguistic features (3 dims) ===
        text_length = min(len(text) / 1000.0, 1.0) if text else 0.0
        certainty = self._compute_certainty(text)
        sentiment = self._compute_sentiment(text)

        features.extend([text_length, certainty, sentiment])

        return np.array(features, dtype=np.float32)

    def _extract_embedding_features(
        self,
        text: str,
        embedder=None,
        n_components: int = 10,
    ) -> List[float]:
        """
        Extract compressed embedding features via PCA-like projection.

        Args:
            text: Input text
            embedder: Text embedder instance
            n_components: Number of output dimensions

        Returns:
            List of n_components floats
        """
        if not text or not text.strip():
            return [0.0] * n_components

        # Lazy-load embedder if not provided
        if embedder is None:
            try:
                from app.services.embeddings.text_embedder import get_multilingual_embedder
                embedder = get_multilingual_embedder(model_key="e5-large")
            except ImportError:
                logger.debug("Embedder not available for feature extraction")
                return [0.0] * n_components

        try:
            # Get embedding
            embedding = np.array(
                embedder.embed_text(text, is_query=True, preprocess=True)
            )

            # Use simple projection: take first n dimensions and normalize
            # This is a simpler alternative to PCA that doesn't require
            # pre-computed components, but still captures variance
            if len(embedding) >= n_components:
                # Take strided samples across the embedding
                step = len(embedding) // n_components
                projected = embedding[::step][:n_components]

                # Normalize to [-1, 1] range
                norm = np.linalg.norm(projected)
                if norm > 0:
                    projected = projected / norm

                return projected.tolist()
            else:
                return embedding.tolist() + [0.0] * (n_components - len(embedding))

        except Exception as e:
            logger.debug(f"Embedding feature extraction failed: {e}")
            return [0.0] * n_components

    def _compute_certainty(self, text: str) -> float:
        """
        Compute certainty score based on hedging language.

        Returns:
            Float from 0.0 (uncertain) to 1.0 (certain)
        """
        if not text:
            return 0.5

        text_lower = text.lower()
        words = set(re.findall(r'\w+', text_lower))

        hedging_count = len(words & self.HEDGING_WORDS)

        # More hedging words = less certainty
        certainty = max(0.0, 1.0 - hedging_count * 0.15)
        return certainty

    def _compute_sentiment(self, text: str) -> float:
        """
        Compute simple sentiment score.

        Returns:
            Float from 0.0 (negative) to 1.0 (positive)
        """
        if not text:
            return 0.5

        text_lower = text.lower()
        words = set(re.findall(r'\w+', text_lower))

        negative_count = len(words & self.NEGATIVE_WORDS)
        positive_count = len(words & self.POSITIVE_WORDS)

        total = negative_count + positive_count
        if total == 0:
            return 0.5  # Neutral

        # Compute sentiment ratio
        sentiment = positive_count / total
        return sentiment

    def predict(
        self,
        context: np.ndarray,
        explore: bool = False,
    ) -> PriorityPrediction:
        """
        Predict priority for given context.

        Args:
            context: Context feature vector
            explore: Whether to use exploration (Thompson Sampling)

        Returns:
            PriorityPrediction with priority and confidence
        """
        if not self._initialized:
            self.initialize()

        if not TORCH_AVAILABLE or self.model is None:
            return self._rule_based_predict(context)

        self.model.eval()
        with torch.no_grad():
            x = torch.from_numpy(context).unsqueeze(0).to(self._device)

            if explore and np.random.random() < self.exploration_rate:
                # Thompson Sampling for exploration
                scores = self.model.sample(x)
            else:
                # Greedy prediction
                scores, _ = self.model(x)

            probs = F.softmax(scores, dim=1).cpu().numpy()[0]

        # Get best priority
        best_idx = np.argmax(probs)
        priority = self.PRIORITIES[best_idx]
        confidence = float(probs[best_idx])

        return PriorityPrediction(
            priority=priority,
            confidence=confidence,
            all_scores={p: float(probs[i]) for i, p in enumerate(self.PRIORITIES)},
        )

    def _rule_based_predict(self, context: np.ndarray) -> PriorityPrediction:
        """
        Rule-based fallback for priority prediction.

        Supports both v1 (14-dim) and v2 (32-dim) feature vectors.
        """
        context_len = len(context)

        # Detect feature version based on dimension
        if context_len >= 32:
            # V2 features: indices 5-8 are semantic severity scores
            critical_prob = context[5]
            high_prob = context[6]
            medium_prob = context[7]
            low_prob = context[8]

            # Combine with entity importance (index 13)
            entity_importance = context[13] if context_len > 13 else 0

            # Use semantic severity probabilities directly
            all_scores = {
                "critical": float(critical_prob),
                "high": float(high_prob),
                "medium": float(medium_prob),
                "low": float(low_prob),
            }

            # Boost severity if important entities are mentioned
            if entity_importance > 0.5:
                all_scores["critical"] *= 1.2
                all_scores["high"] *= 1.1
                total = sum(all_scores.values())
                all_scores = {k: v / total for k, v in all_scores.items()}

            best_priority = max(all_scores, key=all_scores.get)
            confidence = all_scores[best_priority]

            return PriorityPrediction(
                priority=best_priority,
                confidence=confidence,
                all_scores=all_scores,
            )

        else:
            # V1 features (legacy): indices 5-8 are keyword counts
            critical_count = context[5] if context_len > 5 else 0
            high_count = context[6] if context_len > 6 else 0
            medium_count = context[7] if context_len > 7 else 0
            low_count = context[8] if context_len > 8 else 0

            # Simple scoring
            if critical_count > 0:
                return PriorityPrediction(
                    priority="critical",
                    confidence=0.8,
                    all_scores={"critical": 0.7, "high": 0.2, "medium": 0.08, "low": 0.02},
                )
            elif high_count > 0:
                return PriorityPrediction(
                    priority="high",
                    confidence=0.7,
                    all_scores={"critical": 0.1, "high": 0.7, "medium": 0.15, "low": 0.05},
                )
            elif medium_count > 0 or (context_len > 9 and context[9] > 0.6):
                return PriorityPrediction(
                    priority="medium",
                    confidence=0.6,
                    all_scores={"critical": 0.05, "high": 0.2, "medium": 0.6, "low": 0.15},
                )
            else:
                return PriorityPrediction(
                    priority="low",
                    confidence=0.5,
                    all_scores={"critical": 0.02, "high": 0.08, "medium": 0.3, "low": 0.6},
                )

    def update(
        self,
        context: np.ndarray,
        action: str,
        reward: float,
        learning_rate: float = 0.01,
    ):
        """
        Update model with feedback.

        Args:
            context: Context features when action was taken
            action: The priority that was assigned
            reward: Reward signal (-1 to 1)
            learning_rate: Learning rate for update
        """
        if not TORCH_AVAILABLE or self.model is None:
            return

        action_idx = self.PRIORITIES.index(action)

        # Prepare tensors
        x = torch.from_numpy(context).unsqueeze(0).to(self._device)
        target = torch.zeros(1, self.num_actions, device=self._device)
        target[0, action_idx] = 1.0 if reward > 0 else 0.0

        # Forward pass
        self.model.train()
        mean, log_var = self.model(x)

        # Compute loss (negative reward = wrong, positive = correct)
        # Use MSE loss with reward-weighted target
        probs = F.softmax(mean, dim=1)
        loss = F.mse_loss(probs, target) * abs(reward)

        # Backward pass
        optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        # Decay exploration rate
        self.exploration_rate = max(
            self.min_exploration,
            self.exploration_rate * self.exploration_decay,
        )

    def save(self, path: Path):
        """Save model weights."""
        if self.model is not None and TORCH_AVAILABLE:
            state = {
                "model_state": self.model.state_dict(),
                "exploration_rate": self.exploration_rate,
            }
            torch.save(state, path)
            logger.info(f"Saved PriorityBandit to {path}")

    def load(self, path: Path):
        """Load model weights."""
        if TORCH_AVAILABLE and path.exists():
            self.initialize()
            if self.model is not None:
                state = torch.load(path, map_location=self._device)
                self.model.load_state_dict(state["model_state"])
                self.exploration_rate = state.get("exploration_rate", 0.1)
                logger.info(f"Loaded PriorityBandit from {path}")

    def predict_from_story(
        self,
        text: str,
        category: Optional[str] = None,
        source_confidence: float = 0.5,
        entities: Optional[List[Dict[str, Any]]] = None,
        published_at: Optional[datetime] = None,
        explore: bool = False,
    ) -> PriorityPrediction:
        """
        High-level API to predict priority from story data.

        Uses the v2 feature extractor with semantic features.

        Args:
            text: Story text (title + content)
            category: Story category
            source_confidence: Source reliability (0-1)
            entities: List of entity dicts from NER
            published_at: Publication timestamp
            explore: Whether to use exploration

        Returns:
            PriorityPrediction
        """
        context = self.extract_context_features_v2(
            text=text,
            category=category,
            source_confidence=source_confidence,
            entities=entities,
            published_at=published_at,
        )

        return self.predict(context, explore=explore)

    def get_feature_names(self, version: str = "v2") -> List[str]:
        """
        Get names of features in the context vector.

        Useful for debugging and feature importance analysis.

        Args:
            version: "v1" (14-dim) or "v2" (32-dim)

        Returns:
            List of feature names
        """
        if version == "v1":
            return [
                "cat_political", "cat_economic", "cat_security", "cat_disaster", "cat_social",
                "kw_critical", "kw_high", "kw_medium", "kw_low",
                "source_confidence", "entity_count",
                "hour", "day", "is_weekend",
            ]
        else:  # v2
            return [
                # Category one-hot (5)
                "cat_political", "cat_economic", "cat_security", "cat_disaster", "cat_social",
                # Semantic severity (4)
                "sev_critical", "sev_high", "sev_medium", "sev_low",
                # Entity counts (4)
                "ent_person", "ent_org", "ent_location", "ent_other",
                # Entity importance (1)
                "ent_importance",
                # Source confidence (1)
                "source_confidence",
                # Embedding PCA (10)
                "emb_0", "emb_1", "emb_2", "emb_3", "emb_4",
                "emb_5", "emb_6", "emb_7", "emb_8", "emb_9",
                # Temporal (4)
                "hour", "day", "is_weekend", "recency",
                # Linguistic (3)
                "text_length", "certainty", "sentiment",
            ]


# Singleton instance
_priority_bandit: Optional[PriorityBandit] = None


def get_priority_bandit(
    input_dim: int = PriorityBandit.DEFAULT_INPUT_DIM,
) -> PriorityBandit:
    """
    Get singleton PriorityBandit instance.

    Args:
        input_dim: Feature dimension (32 for v2, 14 for v1)

    Returns:
        PriorityBandit instance
    """
    global _priority_bandit
    if _priority_bandit is None:
        _priority_bandit = PriorityBandit(input_dim=input_dim)
    return _priority_bandit
