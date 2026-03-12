"""ML configuration and hyperparameters."""
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List


@dataclass
class ModelHyperparams:
    """Hyperparameters for a single model."""
    learning_rate: float = 0.001
    batch_size: int = 32
    hidden_dim: int = 128
    dropout: float = 0.3
    epochs: int = 10
    min_samples_to_train: int = 50


@dataclass
class MLConfig:
    """Configuration for the ML module."""

    # Model storage paths
    models_dir: Path = field(default_factory=lambda: Path("data/models"))

    # Categories for classification
    categories: List[str] = field(default_factory=lambda: [
        "political",
        "economic",
        "security",
        "disaster",
        "social",
    ])

    # Priority levels
    priorities: List[str] = field(default_factory=lambda: [
        "critical",
        "high",
        "medium",
        "low",
    ])

    # Extended categories for fine-grained classification (v3)
    extended_categories: List[str] = field(default_factory=lambda: [
        # Political
        "POLITICAL_ELECTION",
        "POLITICAL_GOVERNMENT",
        "POLITICAL_PARTY",
        "POLITICAL_FOREIGN",
        # Economic
        "ECONOMIC_MARKET",
        "ECONOMIC_TRADE",
        "ECONOMIC_FINANCE",
        "ECONOMIC_DEVELOPMENT",
        # Security
        "SECURITY_MILITARY",
        "SECURITY_CRIME",
        "SECURITY_BORDER",
        "SECURITY_TERRORISM",
        # Disaster
        "DISASTER_NATURAL",
        "DISASTER_ACCIDENT",
        "DISASTER_HEALTH",
        # Social
        "SOCIAL_PROTEST",
        "SOCIAL_CULTURE",
        "SOCIAL_EDUCATION",
        "SOCIAL_HEALTH",
    ])

    # Model-specific hyperparameters
    story_classifier: ModelHyperparams = field(default_factory=lambda: ModelHyperparams(
        learning_rate=0.001,
        batch_size=32,
        hidden_dim=256,
        dropout=0.3,
        epochs=15,
        min_samples_to_train=50,
    ))

    priority_bandit: ModelHyperparams = field(default_factory=lambda: ModelHyperparams(
        learning_rate=0.01,
        batch_size=16,
        hidden_dim=64,
        dropout=0.2,
        epochs=5,
        min_samples_to_train=30,
    ))

    anomaly_vae: ModelHyperparams = field(default_factory=lambda: ModelHyperparams(
        learning_rate=0.001,
        batch_size=64,
        hidden_dim=128,
        dropout=0.1,
        epochs=20,
        min_samples_to_train=100,
    ))

    temporal_embedder: ModelHyperparams = field(default_factory=lambda: ModelHyperparams(
        learning_rate=0.001,
        batch_size=32,
        hidden_dim=128,
        dropout=0.2,
        epochs=10,
        min_samples_to_train=200,
    ))

    # Training configuration
    accuracy_improvement_threshold: float = 0.01  # 1% improvement to promote
    training_interval_hours: int = 24  # Nightly training
    max_experience_buffer_size: int = 10000

    # Source confidence
    source_prior_alpha: float = 2.0  # Beta distribution prior
    source_prior_beta: float = 2.0

    # ================================================================
    # Embedding Configuration
    # ================================================================

    # Embedding model: "e5-large" (1024d), "e5-base" (768d), "minilm" (384d)
    embedding_model: str = "e5-large"

    # Feature dimensions (must match embedding_model choice)
    embedding_dim: int = 1024  # E5-Large dimension

    # Legacy dimension for backward compatibility
    legacy_embedding_dim: int = 384  # MiniLM dimension

    # Embedding batch processing
    embedding_batch_size: int = 32
    vocab_size: int = 50000
    max_seq_length: int = 512  # E5 supports 512

    # ================================================================
    # NER Configuration
    # ================================================================

    # Transformer NER model: "xlm-roberta-ner", "bert-multilingual-ner"
    transformer_ner_model: str = "xlm-roberta-ner"

    # NER confidence threshold
    ner_confidence_threshold: float = 0.5

    # Use hybrid NER (transformer + rules) vs transformer-only
    use_hybrid_ner: bool = True

    # ================================================================
    # Priority Bandit Configuration
    # ================================================================

    # Feature version: "v1" (14-dim legacy) or "v2" (32-dim semantic)
    priority_feature_version: str = "v2"

    # Priority feature dimensions
    priority_feature_dim_v1: int = 14
    priority_feature_dim_v2: int = 32

    # Semantic severity detection settings
    severity_temperature: float = 0.2  # Lower = more confident
    severity_min_confidence: float = 0.3

    def __post_init__(self):
        """Ensure models directory exists."""
        self.models_dir.mkdir(parents=True, exist_ok=True)

    def get_model_path(self, model_type: str, version: str) -> Path:
        """Get the path for a model checkpoint."""
        return self.models_dir / model_type / f"v{version}.pt"


@lru_cache
def get_ml_config() -> MLConfig:
    """Get the global ML configuration singleton."""
    # Allow override from environment
    models_dir = os.environ.get("ML_MODELS_DIR", "data/models")
    return MLConfig(models_dir=Path(models_dir))
