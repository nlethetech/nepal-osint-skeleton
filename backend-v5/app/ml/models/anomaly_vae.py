"""Variational Autoencoder for anomaly detection in news patterns."""
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available - AnomalyVAE will use fallback")


@dataclass
class AnomalyResult:
    """Result of anomaly detection."""
    is_anomaly: bool
    anomaly_score: float  # 0.0 to 1.0, higher = more anomalous
    reconstruction_error: float
    threshold: float


class VAEEncoder(nn.Module if TORCH_AVAILABLE else object):
    """VAE encoder network."""

    def __init__(self, input_dim: int, hidden_dim: int, latent_dim: int):
        if not TORCH_AVAILABLE:
            return
        super().__init__()

        self.fc1 = nn.Linear(input_dim, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, hidden_dim // 2)
        self.fc_mu = nn.Linear(hidden_dim // 2, latent_dim)
        self.fc_logvar = nn.Linear(hidden_dim // 2, latent_dim)

    def forward(self, x: "torch.Tensor") -> Tuple["torch.Tensor", "torch.Tensor"]:
        h = F.relu(self.fc1(x))
        h = F.relu(self.fc2(h))
        return self.fc_mu(h), self.fc_logvar(h)


class VAEDecoder(nn.Module if TORCH_AVAILABLE else object):
    """VAE decoder network."""

    def __init__(self, latent_dim: int, hidden_dim: int, output_dim: int):
        if not TORCH_AVAILABLE:
            return
        super().__init__()

        self.fc1 = nn.Linear(latent_dim, hidden_dim // 2)
        self.fc2 = nn.Linear(hidden_dim // 2, hidden_dim)
        self.fc3 = nn.Linear(hidden_dim, output_dim)

    def forward(self, z: "torch.Tensor") -> "torch.Tensor":
        h = F.relu(self.fc1(z))
        h = F.relu(self.fc2(h))
        return self.fc3(h)  # No activation - raw reconstruction


class VAE(nn.Module if TORCH_AVAILABLE else object):
    """
    Variational Autoencoder for anomaly detection.

    Learns to reconstruct normal patterns. Anomalies have high reconstruction error.
    """

    def __init__(self, input_dim: int, hidden_dim: int, latent_dim: int):
        if not TORCH_AVAILABLE:
            return
        super().__init__()

        self.encoder = VAEEncoder(input_dim, hidden_dim, latent_dim)
        self.decoder = VAEDecoder(latent_dim, hidden_dim, input_dim)

    def reparameterize(self, mu: "torch.Tensor", logvar: "torch.Tensor") -> "torch.Tensor":
        """Reparameterization trick for sampling."""
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        return mu + eps * std

    def forward(self, x: "torch.Tensor") -> Tuple["torch.Tensor", "torch.Tensor", "torch.Tensor"]:
        mu, logvar = self.encoder(x)
        z = self.reparameterize(mu, logvar)
        recon = self.decoder(z)
        return recon, mu, logvar

    def reconstruction_loss(self, x: "torch.Tensor", recon: "torch.Tensor") -> "torch.Tensor":
        """Mean squared reconstruction error."""
        return F.mse_loss(recon, x, reduction='none').mean(dim=1)

    def kl_loss(self, mu: "torch.Tensor", logvar: "torch.Tensor") -> "torch.Tensor":
        """KL divergence from standard normal."""
        return -0.5 * torch.sum(1 + logvar - mu.pow(2) - logvar.exp(), dim=1)


class AnomalyVAE:
    """
    Anomaly detection using Variational Autoencoder.

    Detects unusual news patterns by measuring reconstruction error.
    Normal patterns are learned during training; anomalies have high error.

    Use cases:
    - Detecting unusual story combinations
    - Identifying outlier news patterns
    - Flagging stories that don't fit established categories
    """

    DEFAULT_INPUT_DIM = 384 + 5 + 4  # Embedding + category one-hot + severity one-hot
    DEFAULT_LATENT_DIM = 32

    def __init__(
        self,
        input_dim: int = DEFAULT_INPUT_DIM,
        hidden_dim: int = 128,
        latent_dim: int = DEFAULT_LATENT_DIM,
        anomaly_threshold: float = 0.9,  # Percentile threshold
    ):
        """
        Initialize the anomaly VAE.

        Args:
            input_dim: Dimension of input features
            hidden_dim: Hidden layer dimension
            latent_dim: Latent space dimension
            anomaly_threshold: Percentile threshold for anomaly detection
        """
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.latent_dim = latent_dim
        self.anomaly_threshold = anomaly_threshold

        self.model: Optional[VAE] = None
        self._initialized = False
        self._device = "cpu"

        # Running statistics for threshold calculation
        self._reconstruction_errors: List[float] = []
        self._threshold_value: float = 0.1  # Default threshold

    def initialize(self, device: str = "cpu"):
        """Initialize the model."""
        if not TORCH_AVAILABLE:
            logger.warning("PyTorch not available, using fallback")
            self._initialized = True
            return

        self._device = device
        self.model = VAE(
            input_dim=self.input_dim,
            hidden_dim=self.hidden_dim,
            latent_dim=self.latent_dim,
        ).to(device)

        self._initialized = True
        logger.info(f"AnomalyVAE initialized on {device}")

    def extract_features(
        self,
        embedding: List[float],
        category: Optional[str] = None,
        severity: Optional[str] = None,
    ) -> np.ndarray:
        """
        Extract features for anomaly detection.

        Args:
            embedding: Story embedding (384-dim)
            category: Story category
            severity: Story severity

        Returns:
            Feature vector
        """
        features = []

        # Embedding
        if embedding:
            features.extend(embedding[:384])  # Ensure 384 dims
        else:
            features.extend([0.0] * 384)

        # Pad if needed
        while len(features) < 384:
            features.append(0.0)

        # Category one-hot (5 dims)
        categories = ["political", "economic", "security", "disaster", "social"]
        cat_idx = categories.index(category) if category in categories else -1
        features.extend([1.0 if i == cat_idx else 0.0 for i in range(5)])

        # Severity one-hot (4 dims)
        severities = ["low", "medium", "high", "critical"]
        sev_idx = severities.index(severity) if severity in severities else 0
        features.extend([1.0 if i == sev_idx else 0.0 for i in range(4)])

        return np.array(features, dtype=np.float32)

    def detect_anomaly(
        self,
        features: np.ndarray,
    ) -> AnomalyResult:
        """
        Detect if the input is anomalous.

        Args:
            features: Feature vector

        Returns:
            AnomalyResult with anomaly score and decision
        """
        if not self._initialized:
            self.initialize()

        if not TORCH_AVAILABLE or self.model is None:
            return self._fallback_detect(features)

        self.model.eval()
        with torch.no_grad():
            x = torch.from_numpy(features).unsqueeze(0).to(self._device)
            recon, mu, logvar = self.model(x)
            recon_error = self.model.reconstruction_loss(x, recon).item()

        # Normalize to 0-1 score
        anomaly_score = min(1.0, recon_error / (self._threshold_value * 2 + 0.001))

        return AnomalyResult(
            is_anomaly=recon_error > self._threshold_value,
            anomaly_score=anomaly_score,
            reconstruction_error=recon_error,
            threshold=self._threshold_value,
        )

    def _fallback_detect(self, features: np.ndarray) -> AnomalyResult:
        """Fallback detection without model."""
        # Simple heuristic: flag if embedding is mostly zeros
        embedding = features[:384]
        zero_ratio = np.sum(np.abs(embedding) < 0.01) / 384

        is_anomaly = zero_ratio > 0.9
        anomaly_score = zero_ratio

        return AnomalyResult(
            is_anomaly=is_anomaly,
            anomaly_score=anomaly_score,
            reconstruction_error=0.0,
            threshold=0.9,
        )

    def train_step(
        self,
        batch: np.ndarray,
        learning_rate: float = 0.001,
        beta: float = 1.0,
    ) -> float:
        """
        Single training step.

        Args:
            batch: Batch of feature vectors (N, input_dim)
            learning_rate: Learning rate
            beta: KL divergence weight (beta-VAE)

        Returns:
            Total loss value
        """
        if not TORCH_AVAILABLE or self.model is None:
            return 0.0

        self.model.train()
        x = torch.from_numpy(batch).to(self._device)

        # Forward pass
        recon, mu, logvar = self.model(x)

        # Compute losses
        recon_loss = self.model.reconstruction_loss(x, recon).mean()
        kl_loss = self.model.kl_loss(mu, logvar).mean()
        total_loss = recon_loss + beta * kl_loss

        # Backward pass
        optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)
        optimizer.zero_grad()
        total_loss.backward()
        optimizer.step()

        # Update reconstruction error statistics
        with torch.no_grad():
            errors = self.model.reconstruction_loss(x, recon).cpu().numpy()
            self._reconstruction_errors.extend(errors.tolist())

            # Keep only recent errors for threshold calculation
            if len(self._reconstruction_errors) > 10000:
                self._reconstruction_errors = self._reconstruction_errors[-10000:]

            # Update threshold
            if len(self._reconstruction_errors) >= 100:
                self._threshold_value = float(np.percentile(
                    self._reconstruction_errors,
                    self.anomaly_threshold * 100,
                ))

        return total_loss.item()

    def update_threshold(self, errors: List[float]):
        """
        Update anomaly threshold from reconstruction errors.

        Args:
            errors: List of reconstruction errors from validation set
        """
        if errors:
            self._threshold_value = float(np.percentile(
                errors,
                self.anomaly_threshold * 100,
            ))
            logger.info(f"Updated anomaly threshold to {self._threshold_value:.4f}")

    def save(self, path: Path):
        """Save model weights and threshold."""
        if self.model is not None and TORCH_AVAILABLE:
            state = {
                "model_state": self.model.state_dict(),
                "threshold": self._threshold_value,
                "recent_errors": self._reconstruction_errors[-1000:],
            }
            torch.save(state, path)
            logger.info(f"Saved AnomalyVAE to {path}")

    def load(self, path: Path):
        """Load model weights and threshold."""
        if TORCH_AVAILABLE and path.exists():
            self.initialize()
            if self.model is not None:
                state = torch.load(path, map_location=self._device)
                self.model.load_state_dict(state["model_state"])
                self._threshold_value = state.get("threshold", 0.1)
                self._reconstruction_errors = state.get("recent_errors", [])
                logger.info(f"Loaded AnomalyVAE from {path}")
