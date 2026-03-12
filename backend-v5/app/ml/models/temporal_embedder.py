"""GRU-based temporal embedder for sequence similarity."""
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
    logger.warning("PyTorch not available - TemporalEmbedder will use fallback")


@dataclass
class TemporalSimilarityResult:
    """Result of temporal similarity computation."""
    similarity: float  # 0.0 to 1.0
    temporal_distance: float  # Time-adjusted distance
    embedding1: Optional[List[float]] = None
    embedding2: Optional[List[float]] = None


class GRUEncoder(nn.Module if TORCH_AVAILABLE else object):
    """
    GRU-based sequence encoder for temporal patterns.

    Processes a sequence of story embeddings over time to create
    a temporal-aware representation.
    """

    def __init__(
        self,
        input_dim: int,
        hidden_dim: int,
        num_layers: int = 2,
        dropout: float = 0.2,
    ):
        if not TORCH_AVAILABLE:
            return
        super().__init__()

        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        self.gru = nn.GRU(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
            bidirectional=True,
        )

        # Project bidirectional output to hidden_dim
        self.projection = nn.Linear(hidden_dim * 2, hidden_dim)

    def forward(
        self,
        x: "torch.Tensor",
        lengths: Optional["torch.Tensor"] = None,
    ) -> "torch.Tensor":
        """
        Encode a sequence.

        Args:
            x: (batch, seq_len, input_dim) sequence of embeddings
            lengths: (batch,) actual sequence lengths for packing

        Returns:
            (batch, hidden_dim) temporal embedding
        """
        if lengths is not None:
            # Pack padded sequence
            packed = nn.utils.rnn.pack_padded_sequence(
                x, lengths.cpu(), batch_first=True, enforce_sorted=False
            )
            output, hidden = self.gru(packed)
            # Unpack
            output, _ = nn.utils.rnn.pad_packed_sequence(output, batch_first=True)
        else:
            output, hidden = self.gru(x)

        # Use final hidden states from both directions
        # hidden: (num_layers * 2, batch, hidden_dim)
        forward_h = hidden[-2]  # Last forward hidden
        backward_h = hidden[-1]  # Last backward hidden

        # Concatenate and project
        combined = torch.cat([forward_h, backward_h], dim=1)  # (batch, hidden*2)
        temporal_embedding = self.projection(combined)  # (batch, hidden)

        return temporal_embedding


class TemporalEmbedder:
    """
    Temporal embedding model using GRU.

    Creates temporal-aware representations that capture:
    - Sequence of events over time
    - Temporal patterns and trends
    - Time-based similarity between story sequences

    Used to boost clustering similarity for stories that are
    part of the same developing story arc.
    """

    DEFAULT_INPUT_DIM = 384  # MiniLM embedding dim
    DEFAULT_HIDDEN_DIM = 128

    def __init__(
        self,
        input_dim: int = DEFAULT_INPUT_DIM,
        hidden_dim: int = DEFAULT_HIDDEN_DIM,
        num_layers: int = 2,
        dropout: float = 0.2,
        max_seq_length: int = 20,  # Max stories in a sequence
    ):
        """
        Initialize the temporal embedder.

        Args:
            input_dim: Dimension of input embeddings
            hidden_dim: Hidden dimension
            num_layers: Number of GRU layers
            dropout: Dropout probability
            max_seq_length: Maximum sequence length
        """
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.dropout = dropout
        self.max_seq_length = max_seq_length

        self.model: Optional[GRUEncoder] = None
        self._initialized = False
        self._device = "cpu"

    def initialize(self, device: str = "cpu"):
        """Initialize the model."""
        if not TORCH_AVAILABLE:
            logger.warning("PyTorch not available, using fallback")
            self._initialized = True
            return

        self._device = device
        self.model = GRUEncoder(
            input_dim=self.input_dim,
            hidden_dim=self.hidden_dim,
            num_layers=self.num_layers,
            dropout=self.dropout,
        ).to(device)

        self._initialized = True
        logger.info(f"TemporalEmbedder initialized on {device}")

    def embed_sequence(
        self,
        embeddings: List[List[float]],
        timestamps: Optional[List[float]] = None,
    ) -> List[float]:
        """
        Create temporal embedding for a sequence of story embeddings.

        Args:
            embeddings: List of story embeddings in chronological order
            timestamps: Optional list of timestamps (for temporal features)

        Returns:
            Temporal embedding vector
        """
        if not self._initialized:
            self.initialize()

        if not embeddings:
            return [0.0] * self.hidden_dim

        if not TORCH_AVAILABLE or self.model is None:
            return self._fallback_embed(embeddings)

        # Prepare input
        seq_len = min(len(embeddings), self.max_seq_length)
        embeddings = embeddings[:seq_len]

        # Pad to input_dim if needed
        padded_embeddings = []
        for emb in embeddings:
            if len(emb) < self.input_dim:
                emb = list(emb) + [0.0] * (self.input_dim - len(emb))
            padded_embeddings.append(emb[:self.input_dim])

        self.model.eval()
        with torch.no_grad():
            x = torch.tensor(padded_embeddings, dtype=torch.float32).unsqueeze(0)
            x = x.to(self._device)
            lengths = torch.tensor([seq_len])

            temporal_emb = self.model(x, lengths)
            return temporal_emb.cpu().numpy()[0].tolist()

    def _fallback_embed(self, embeddings: List[List[float]]) -> List[float]:
        """Fallback embedding without model."""
        # Simple mean pooling
        if not embeddings:
            return [0.0] * self.hidden_dim

        arr = np.array(embeddings)
        mean = np.mean(arr, axis=0)

        # Pad/truncate to hidden_dim
        if len(mean) < self.hidden_dim:
            mean = np.concatenate([mean, np.zeros(self.hidden_dim - len(mean))])
        else:
            mean = mean[:self.hidden_dim]

        return mean.tolist()

    def compute_similarity(
        self,
        seq1_embeddings: List[List[float]],
        seq2_embeddings: List[List[float]],
        time_decay: float = 0.1,
    ) -> TemporalSimilarityResult:
        """
        Compute temporal-aware similarity between two sequences.

        Args:
            seq1_embeddings: First sequence of embeddings
            seq2_embeddings: Second sequence of embeddings
            time_decay: Decay factor for temporal distance

        Returns:
            TemporalSimilarityResult with similarity score
        """
        # Get temporal embeddings
        temp_emb1 = self.embed_sequence(seq1_embeddings)
        temp_emb2 = self.embed_sequence(seq2_embeddings)

        # Compute cosine similarity
        vec1 = np.array(temp_emb1)
        vec2 = np.array(temp_emb2)

        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)

        if norm1 < 1e-8 or norm2 < 1e-8:
            similarity = 0.0
        else:
            similarity = float(np.dot(vec1, vec2) / (norm1 * norm2))
            similarity = max(0.0, similarity)  # Clamp negative

        # Compute temporal distance (sequence length difference)
        len_diff = abs(len(seq1_embeddings) - len(seq2_embeddings))
        temporal_distance = len_diff * time_decay

        return TemporalSimilarityResult(
            similarity=similarity,
            temporal_distance=temporal_distance,
            embedding1=temp_emb1,
            embedding2=temp_emb2,
        )

    def compute_story_similarity_boost(
        self,
        story_embedding: List[float],
        cluster_embeddings: List[List[float]],
        base_similarity: float,
    ) -> float:
        """
        Compute boosted similarity considering temporal context.

        If a story fits well with the temporal pattern of a cluster,
        its similarity score gets a boost.

        Args:
            story_embedding: Embedding of the new story
            cluster_embeddings: Historical embeddings from the cluster
            base_similarity: Base similarity score

        Returns:
            Boosted similarity score
        """
        if not cluster_embeddings:
            return base_similarity

        # Get temporal embedding of cluster
        cluster_temp = self.embed_sequence(cluster_embeddings)

        # Get temporal embedding of cluster + new story
        extended = cluster_embeddings + [story_embedding]
        extended_temp = self.embed_sequence(extended)

        # Compute how much the new story changes the temporal pattern
        vec1 = np.array(cluster_temp)
        vec2 = np.array(extended_temp)

        # Similarity between original and extended temporal embeddings
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)

        if norm1 < 1e-8 or norm2 < 1e-8:
            pattern_fit = 0.5
        else:
            pattern_fit = float(np.dot(vec1, vec2) / (norm1 * norm2))
            pattern_fit = max(0.0, pattern_fit)

        # Boost based on pattern fit
        # High pattern_fit means story continues the trend -> boost
        boost_factor = 0.1 * pattern_fit  # Max 10% boost

        return min(1.0, base_similarity + boost_factor)

    def train_step(
        self,
        positive_pairs: List[Tuple[List[List[float]], List[List[float]]]],
        negative_pairs: List[Tuple[List[List[float]], List[List[float]]]],
        learning_rate: float = 0.001,
    ) -> float:
        """
        Train using contrastive learning.

        Args:
            positive_pairs: Pairs of sequences that should be similar
            negative_pairs: Pairs of sequences that should be different
            learning_rate: Learning rate

        Returns:
            Loss value
        """
        if not TORCH_AVAILABLE or self.model is None:
            return 0.0

        self.model.train()
        optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)

        total_loss = 0.0
        margin = 0.5

        # Process positive pairs
        for seq1, seq2 in positive_pairs:
            if not seq1 or not seq2:
                continue

            # Get embeddings
            emb1 = self._encode_sequence(seq1)
            emb2 = self._encode_sequence(seq2)

            # Positive loss: minimize distance
            positive_loss = F.mse_loss(emb1, emb2)
            total_loss += positive_loss.item()

            optimizer.zero_grad()
            positive_loss.backward()
            optimizer.step()

        # Process negative pairs
        for seq1, seq2 in negative_pairs:
            if not seq1 or not seq2:
                continue

            emb1 = self._encode_sequence(seq1)
            emb2 = self._encode_sequence(seq2)

            # Negative loss: maximize distance (up to margin)
            distance = F.pairwise_distance(emb1.unsqueeze(0), emb2.unsqueeze(0))
            negative_loss = F.relu(margin - distance).mean()
            total_loss += negative_loss.item()

            optimizer.zero_grad()
            negative_loss.backward()
            optimizer.step()

        return total_loss

    def _encode_sequence(self, embeddings: List[List[float]]) -> "torch.Tensor":
        """Encode a sequence to tensor."""
        seq_len = min(len(embeddings), self.max_seq_length)
        embeddings = embeddings[:seq_len]

        padded = []
        for emb in embeddings:
            if len(emb) < self.input_dim:
                emb = list(emb) + [0.0] * (self.input_dim - len(emb))
            padded.append(emb[:self.input_dim])

        x = torch.tensor(padded, dtype=torch.float32).unsqueeze(0).to(self._device)
        lengths = torch.tensor([seq_len])

        return self.model(x, lengths).squeeze(0)

    def save(self, path: Path):
        """Save model weights."""
        if self.model is not None and TORCH_AVAILABLE:
            torch.save(self.model.state_dict(), path)
            logger.info(f"Saved TemporalEmbedder to {path}")

    def load(self, path: Path):
        """Load model weights."""
        if TORCH_AVAILABLE and path.exists():
            self.initialize()
            if self.model is not None:
                self.model.load_state_dict(torch.load(path, map_location=self._device))
                logger.info(f"Loaded TemporalEmbedder from {path}")
