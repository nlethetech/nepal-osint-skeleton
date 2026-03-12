"""Unified RL predictor for inference."""
import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.ml.config import get_ml_config, MLConfig
from app.ml.models.story_classifier import StoryClassifier, ClassificationResult
from app.ml.models.embedding_linear_classifier import EmbeddingLinearClassifier
from app.ml.models.priority_bandit import PriorityBandit, PriorityPrediction
from app.ml.models.source_confidence import SourceConfidenceModel, SourceConfidenceResult
from app.ml.models.anomaly_vae import AnomalyVAE, AnomalyResult
from app.ml.models.temporal_embedder import TemporalEmbedder, TemporalSimilarityResult

logger = logging.getLogger(__name__)


@dataclass
class ModelStatus:
    """Status of an RL model."""
    model_type: str
    is_loaded: bool
    version: Optional[str] = None
    accuracy: Optional[float] = None
    last_trained: Optional[str] = None


@dataclass
class UnifiedPrediction:
    """Combined prediction from all models."""
    category: str
    category_confidence: float
    priority: str
    priority_confidence: float
    source_confidence: float
    is_anomaly: bool
    anomaly_score: float


class RLPredictor:
    """
    Unified interface for all RL model predictions.

    Manages:
    - StoryClassifier: Category prediction
    - PriorityBandit: Priority/severity prediction
    - SourceConfidenceModel: Source reliability
    - AnomalyVAE: Anomaly detection
    - TemporalEmbedder: Temporal similarity
    """

    def __init__(self, config: Optional[MLConfig] = None):
        """Initialize the predictor with all models."""
        self.config = config or get_ml_config()

        # Initialize models
        self.story_classifier = StoryClassifier(
            embedding_dim=self.config.embedding_dim,
            hidden_dim=self.config.story_classifier.hidden_dim,
            dropout=self.config.story_classifier.dropout,
        )
        self.embedding_story_classifier = EmbeddingLinearClassifier(
            labels=self.config.categories,
            embedding_dim=self.config.embedding_dim,
        )

        self.priority_bandit = PriorityBandit(
            hidden_dim=self.config.priority_bandit.hidden_dim,
            dropout=self.config.priority_bandit.dropout,
        )

        self.source_confidence = SourceConfidenceModel(
            prior_alpha=self.config.source_prior_alpha,
            prior_beta=self.config.source_prior_beta,
        )

        self.anomaly_vae = AnomalyVAE(
            hidden_dim=self.config.anomaly_vae.hidden_dim,
        )

        self.temporal_embedder = TemporalEmbedder(
            hidden_dim=self.config.temporal_embedder.hidden_dim,
        )

        self._initialized = False
        self._init_lock = threading.Lock()

    def initialize(self, device: str = "cpu", load_weights: bool = True):
        """
        Initialize all models.

        Args:
            device: Device to use (cpu, cuda, mps)
            load_weights: Whether to load saved weights
        """
        with self._init_lock:
            if self._initialized:
                return

            logger.info(f"Initializing RLPredictor on {device}")

            # Initialize models
            self.story_classifier.initialize(device)
            self.priority_bandit.initialize(device)
            self.anomaly_vae.initialize(device)
            self.temporal_embedder.initialize(device)

            # Load weights if available
            if load_weights:
                self._load_models()

            self._initialized = True
            logger.info("RLPredictor initialized")

    def _load_models(self):
        """Load saved model weights."""
        models_dir = self.config.models_dir

        # Story classifier
        classifier_path = models_dir / "story_classifier" / "latest.pt"
        if classifier_path.exists():
            self.story_classifier.load(classifier_path)

        embedding_classifier_path = models_dir / "story_classifier" / "embedding_latest.pt"
        if embedding_classifier_path.exists():
            self.embedding_story_classifier.load(embedding_classifier_path)

        # Priority bandit
        bandit_path = models_dir / "priority_bandit" / "latest.pt"
        if bandit_path.exists():
            self.priority_bandit.load(bandit_path)

        # Source confidence
        source_path = models_dir / "source_confidence" / "latest.json"
        if source_path.exists():
            self.source_confidence.load(source_path)

        # Anomaly VAE
        vae_path = models_dir / "anomaly_vae" / "latest.pt"
        if vae_path.exists():
            self.anomaly_vae.load(vae_path)

        # Temporal embedder
        temporal_path = models_dir / "temporal_embedder" / "latest.pt"
        if temporal_path.exists():
            self.temporal_embedder.load(temporal_path)

    def save_models(self):
        """Save all model weights."""
        models_dir = self.config.models_dir

        # Ensure directories exist
        for subdir in ["story_classifier", "priority_bandit", "source_confidence",
                       "anomaly_vae", "temporal_embedder"]:
            (models_dir / subdir).mkdir(parents=True, exist_ok=True)

        self.story_classifier.save(models_dir / "story_classifier" / "latest.pt")
        self.priority_bandit.save(models_dir / "priority_bandit" / "latest.pt")
        self.source_confidence.save(models_dir / "source_confidence" / "latest.json")
        self.anomaly_vae.save(models_dir / "anomaly_vae" / "latest.pt")
        self.temporal_embedder.save(models_dir / "temporal_embedder" / "latest.pt")

    def classify_story(
        self,
        title: str,
        content: Optional[str] = None,
    ) -> ClassificationResult:
        """
        Classify a story into a category.

        Args:
            title: Story title
            content: Story content

        Returns:
            ClassificationResult with category and confidence
        """
        if not self._initialized:
            self.initialize()

        rule_result = self.story_classifier.classify(title, content)
        if not self.embedding_story_classifier.is_loaded:
            return rule_result

        from app.config import get_settings
        if not get_settings().ml_enable_embedding_classifier:
            return rule_result

        # Fast path: keyword-based match is confident enough.
        if rule_result.confidence >= 0.6:
            return rule_result

        try:
            from app.ml.feature_extraction import build_story_text
            from app.services.embeddings import get_embedder

            text = build_story_text(title, content)
            emb = get_embedder().embed_text(text)
            emb_result = self.embedding_story_classifier.predict(emb)

            # Only override if the trained model is more confident.
            if emb_result.confidence > rule_result.confidence:
                return ClassificationResult(
                    category=emb_result.label,
                    confidence=emb_result.confidence,
                    all_probabilities=emb_result.probabilities,
                )
        except Exception:
            # Never fail ingestion/prediction due to ML inference issues.
            return rule_result

        return rule_result

    def predict_priority(
        self,
        category: Optional[str] = None,
        severity_keywords: List[str] = None,
        source_id: Optional[str] = None,
        entity_count: int = 0,
    ) -> PriorityPrediction:
        """
        Predict priority for a story.

        Args:
            category: Story category
            severity_keywords: Keywords indicating severity
            source_id: Source identifier
            entity_count: Number of named entities

        Returns:
            PriorityPrediction with priority and confidence
        """
        if not self._initialized:
            self.initialize()

        from app.config import get_settings
        if not get_settings().ml_enable_priority_bandit:
            # Keep ingestion stable: return a low-confidence placeholder so callers
            # can decide whether to apply RL output.
            return PriorityPrediction(
                priority="medium",
                confidence=0.0,
                all_scores={"low": 0.25, "medium": 0.25, "high": 0.25, "critical": 0.25},
            )

        # Get source confidence
        source_conf = 0.5
        if source_id:
            source_result = self.source_confidence.get_confidence(source_id)
            source_conf = source_result.confidence

        # Build context features
        from datetime import datetime
        now = datetime.now()

        context = self.priority_bandit.extract_context_features(
            category=category,
            severity_keywords=severity_keywords or [],
            source_confidence=source_conf,
            entity_count=entity_count,
            hour_of_day=now.hour,
            day_of_week=now.weekday(),
            is_weekend=now.weekday() >= 5,
        )

        return self.priority_bandit.predict(context, explore=False)

    def get_source_confidence(self, source_id: str) -> SourceConfidenceResult:
        """
        Get confidence for a news source.

        Args:
            source_id: Source identifier

        Returns:
            SourceConfidenceResult with confidence and uncertainty
        """
        return self.source_confidence.get_confidence(source_id)

    def detect_anomaly(
        self,
        embedding: List[float],
        category: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> AnomalyResult:
        """
        Detect if a story is anomalous.

        Args:
            embedding: Story embedding
            category: Story category
            severity: Story severity

        Returns:
            AnomalyResult with anomaly score
        """
        if not self._initialized:
            self.initialize()

        features = self.anomaly_vae.extract_features(embedding, category, severity)
        return self.anomaly_vae.detect_anomaly(features)

    def compute_temporal_similarity(
        self,
        seq1: List[List[float]],
        seq2: List[List[float]],
    ) -> TemporalSimilarityResult:
        """
        Compute temporal similarity between sequences.

        Args:
            seq1: First sequence of embeddings
            seq2: Second sequence of embeddings

        Returns:
            TemporalSimilarityResult with similarity score
        """
        if not self._initialized:
            self.initialize()

        return self.temporal_embedder.compute_similarity(seq1, seq2)

    def predict_all(
        self,
        title: str,
        content: Optional[str] = None,
        embedding: Optional[List[float]] = None,
        source_id: Optional[str] = None,
    ) -> UnifiedPrediction:
        """
        Run all predictions for a story.

        Args:
            title: Story title
            content: Story content
            embedding: Story embedding
            source_id: Source identifier

        Returns:
            UnifiedPrediction with all model outputs
        """
        if not self._initialized:
            self.initialize()

        # Classify category
        classification = self.classify_story(title, content)

        # Predict priority
        priority = self.predict_priority(
            category=classification.category,
            source_id=source_id,
        )

        # Get source confidence
        source_conf = 0.5
        if source_id:
            source_result = self.get_source_confidence(source_id)
            source_conf = source_result.confidence

        # Detect anomaly
        anomaly = AnomalyResult(is_anomaly=False, anomaly_score=0.0, reconstruction_error=0.0, threshold=0.0)
        if embedding:
            anomaly = self.detect_anomaly(
                embedding,
                classification.category,
                priority.priority,
            )

        return UnifiedPrediction(
            category=classification.category,
            category_confidence=classification.confidence,
            priority=priority.priority,
            priority_confidence=priority.confidence,
            source_confidence=source_conf,
            is_anomaly=anomaly.is_anomaly,
            anomaly_score=anomaly.anomaly_score,
        )

    def get_model_status(self) -> Dict[str, ModelStatus]:
        """Get status of all models."""
        return {
            "story_classifier": ModelStatus(
                model_type="story_classifier",
                is_loaded=self.story_classifier._initialized,
            ),
            "priority_bandit": ModelStatus(
                model_type="priority_bandit",
                is_loaded=self.priority_bandit._initialized,
            ),
            "source_confidence": ModelStatus(
                model_type="source_confidence",
                is_loaded=True,  # Always loaded (no initialization needed)
            ),
            "anomaly_vae": ModelStatus(
                model_type="anomaly_vae",
                is_loaded=self.anomaly_vae._initialized,
            ),
            "temporal_embedder": ModelStatus(
                model_type="temporal_embedder",
                is_loaded=self.temporal_embedder._initialized,
            ),
        }

    def update_source_feedback(
        self,
        source_id: str,
        is_reliable: bool,
    ):
        """Update source confidence with feedback."""
        if is_reliable:
            self.source_confidence.update_reliable(source_id)
        else:
            self.source_confidence.update_unreliable(source_id)


# Global singleton
_predictor_instance: Optional[RLPredictor] = None
_predictor_lock = threading.Lock()


def get_predictor() -> RLPredictor:
    """Get the global RLPredictor singleton."""
    global _predictor_instance

    if _predictor_instance is not None:
        return _predictor_instance

    with _predictor_lock:
        if _predictor_instance is None:
            _predictor_instance = RLPredictor()

    return _predictor_instance
