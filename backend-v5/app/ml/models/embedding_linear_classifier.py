"""Tiny trainable classifier over 384-dim text embeddings."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover
    TORCH_AVAILABLE = False


@dataclass
class EmbeddingClassificationResult:
    label: str
    confidence: float
    probabilities: dict[str, float]


class EmbeddingLinearClassifier:
    """
    Multiclass linear classifier trained on normalized embeddings.

    Intended as the first "real" trainable classifier in v5 (replaces TODO trainer).
    """

    FILE_FORMAT = "embedding_linear_v1"

    def __init__(self, labels: list[str], embedding_dim: int = 384):
        self.labels = list(labels)
        self.embedding_dim = embedding_dim
        self.num_labels = len(self.labels)

        self.model: Optional["nn.Module"] = None
        self._initialized = False
        self._device = "cpu"

    @property
    def is_loaded(self) -> bool:
        return bool(self._initialized and TORCH_AVAILABLE and self.model is not None)

    def initialize(self, device: str = "cpu") -> None:
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch is required for EmbeddingLinearClassifier")

        self._device = device
        self.model = nn.Linear(self.embedding_dim, self.num_labels).to(device)
        self._initialized = True

    def predict(self, embedding: list[float]) -> EmbeddingClassificationResult:
        if not self.is_loaded:
            self.initialize(self._device)

        vec = np.asarray(embedding, dtype=np.float32)
        if vec.shape != (self.embedding_dim,):
            raise ValueError(f"Expected embedding dim {self.embedding_dim}, got {vec.shape}")
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm

        with torch.no_grad():
            x = torch.from_numpy(vec).unsqueeze(0).to(self._device)
            logits = self.model(x)  # type: ignore[operator]
            probs = F.softmax(logits, dim=1).cpu().numpy()[0]

        best_idx = int(np.argmax(probs))
        return EmbeddingClassificationResult(
            label=self.labels[best_idx],
            confidence=float(probs[best_idx]),
            probabilities={self.labels[i]: float(probs[i]) for i in range(self.num_labels)},
        )

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        *,
        epochs: int = 15,
        learning_rate: float = 0.01,
        batch_size: int = 32,
        weight_decay: float = 0.0,
    ) -> dict:
        if not TORCH_AVAILABLE:
            raise RuntimeError("PyTorch is required for EmbeddingLinearClassifier")

        if not self.is_loaded:
            self.initialize(self._device)

        X = np.asarray(X, dtype=np.float32)
        y = np.asarray(y, dtype=np.int64)

        if X.ndim != 2 or X.shape[1] != self.embedding_dim:
            raise ValueError(f"Expected X shape (N,{self.embedding_dim}), got {X.shape}")
        if y.ndim != 1 or y.shape[0] != X.shape[0]:
            raise ValueError("y must be 1D and match X rows")

        # L2-normalize embeddings for stability and better linear separability.
        norms = np.linalg.norm(X, axis=1, keepdims=True)
        norms = np.where(norms > 0, norms, 1.0)
        X = X / norms

        # Inverse-frequency class weights (helps minority classes like security/disaster).
        counts = np.bincount(y, minlength=self.num_labels).astype(np.float32)
        total = float(counts.sum()) if counts.sum() else 1.0
        weights = np.where(counts > 0, total / (self.num_labels * counts), 0.0)
        class_weights = torch.tensor(weights, dtype=torch.float32, device=self._device)

        ds = torch.utils.data.TensorDataset(
            torch.from_numpy(X),
            torch.from_numpy(y),
        )
        dl = torch.utils.data.DataLoader(ds, batch_size=batch_size, shuffle=True)

        self.model.train()  # type: ignore[union-attr]
        opt = torch.optim.AdamW(self.model.parameters(), lr=learning_rate, weight_decay=weight_decay)  # type: ignore[union-attr]

        losses: list[float] = []
        for _ in range(max(1, epochs)):
            for xb, yb in dl:
                xb = xb.to(self._device)
                yb = yb.to(self._device)
                logits = self.model(xb)  # type: ignore[operator]
                loss = F.cross_entropy(logits, yb, weight=class_weights)

                opt.zero_grad()
                loss.backward()
                opt.step()

                losses.append(float(loss.detach().cpu().item()))

        return {
            "loss_avg": float(sum(losses) / len(losses)) if losses else 0.0,
            "steps": len(losses),
        }

    def save(self, path: Path) -> None:
        if not self.is_loaded:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        state = {
            "format": self.FILE_FORMAT,
            "embedding_dim": self.embedding_dim,
            "labels": self.labels,
            "state_dict": self.model.state_dict(),  # type: ignore[union-attr]
        }
        torch.save(state, path)  # type: ignore[name-defined]
        logger.info(f"Saved EmbeddingLinearClassifier to {path}")

    def load(self, path: Path) -> bool:
        if not TORCH_AVAILABLE or not path.exists():
            return False

        state = torch.load(path, map_location=self._device)  # type: ignore[name-defined]
        if not isinstance(state, dict) or state.get("format") != self.FILE_FORMAT:
            return False

        labels = state.get("labels")
        embedding_dim = state.get("embedding_dim")
        sd = state.get("state_dict")
        if not isinstance(labels, list) or not isinstance(embedding_dim, int) or not isinstance(sd, dict):
            return False

        self.labels = list(labels)
        self.embedding_dim = int(embedding_dim)
        self.num_labels = len(self.labels)

        self.initialize(self._device)
        self.model.load_state_dict(sd)  # type: ignore[union-attr]
        logger.info(f"Loaded EmbeddingLinearClassifier from {path}")
        return True
