"""
Thread-safe multilingual text embedder with E5-Large support.

Supports multiple embedding models:
- E5-Large (1024d): Best multilingual quality, recommended for production
- E5-Base (768d): Good balance of quality and speed
- MiniLM (384d): Fastest, legacy compatibility
"""

import hashlib
import logging
import threading
from typing import Dict, List, Optional, Any

import numpy as np
import httpx

logger = logging.getLogger(__name__)

# Global singleton instances (one per model key)
_embedder_instances: Dict[str, "MultilingualTextEmbedder"] = {}
_embedder_lock = threading.Lock()


# Model configurations
MODEL_CONFIGS = {
    "e5-large": {
        "name": "intfloat/multilingual-e5-large",
        "dim": 1024,
        "max_seq": 512,
        "instruction_prefix": "query: ",  # E5 uses instruction prefixes
        "passage_prefix": "passage: ",
    },
    "e5-base": {
        "name": "intfloat/multilingual-e5-base",
        "dim": 768,
        "max_seq": 512,
        "instruction_prefix": "query: ",
        "passage_prefix": "passage: ",
    },
    "minilm": {
        "name": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "dim": 384,
        "max_seq": 256,
        "instruction_prefix": "",
        "passage_prefix": "",
    },
    "openai-3-large": {
        "name": "text-embedding-3-large",
        "dim": 1024,
        "max_seq": 8192,
        "instruction_prefix": "",
        "passage_prefix": "",
    },
}

# Default model key (can be overridden via config)
DEFAULT_MODEL_KEY = "e5-large"


class MultilingualTextEmbedder:
    """
    Thread-safe multilingual text embedder with Nepali preprocessing.

    Supports E5-Large (1024d), E5-Base (768d), and MiniLM (384d) models.
    E5 models use instruction prefixes for better retrieval quality.
    """

    def __init__(self, model_key: str = DEFAULT_MODEL_KEY):
        """
        Initialize the embedder.

        Args:
            model_key: One of 'e5-large', 'e5-base', or 'minilm'
        """
        if model_key not in MODEL_CONFIGS:
            logger.warning(f"Unknown model key '{model_key}', falling back to '{DEFAULT_MODEL_KEY}'")
            model_key = DEFAULT_MODEL_KEY

        self.model_key = model_key
        self.config = MODEL_CONFIGS[model_key]
        self._model = None
        self._model_lock = threading.Lock()
        self._initialized = False
        self._device = None

        # Lazy-load preprocessor
        self._preprocessor = None

    @property
    def preprocessor(self):
        """Lazy-load Nepali preprocessor."""
        if self._preprocessor is None:
            try:
                from app.services.nlp.nepali_preprocessor import NepaliPreprocessor
                self._preprocessor = NepaliPreprocessor()
            except ImportError:
                logger.warning("NepaliPreprocessor not available, using passthrough")
                self._preprocessor = None
        return self._preprocessor

    def _ensure_initialized(self):
        """Lazy initialize the model on first use."""
        if self._initialized:
            return

        with self._model_lock:
            if self._initialized:
                return

            try:
                from sentence_transformers import SentenceTransformer
                import torch

                logger.info(f"Loading embedding model: {self.config['name']}")

                # Determine device
                if torch.cuda.is_available():
                    self._device = "cuda"
                elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                    self._device = "mps"
                else:
                    self._device = "cpu"

                logger.info(f"Using device: {self._device}")

                self._model = SentenceTransformer(
                    self.config["name"],
                    device=self._device
                )
                self._model.max_seq_length = self.config["max_seq"]
                self._initialized = True

                logger.info(
                    f"Model loaded successfully: {self.model_key} "
                    f"(dim={self.config['dim']}, max_seq={self.config['max_seq']})"
                )

            except Exception as e:
                logger.exception(f"Failed to load embedding model: {e}")
                raise

    def _preprocess(self, text: str) -> str:
        """Apply Nepali preprocessing if available."""
        if not text:
            return ""

        if self.preprocessor is not None:
            try:
                return self.preprocessor.normalize(text)
            except Exception:
                pass

        return text

    def embed_text(
        self,
        text: str,
        is_query: bool = False,
        preprocess: bool = True,
    ) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Input text to embed
            is_query: If True, use query prefix (for E5 models)
            preprocess: Whether to apply Nepali preprocessing

        Returns:
            Embedding vector as list of floats
        """
        self._ensure_initialized()

        if not text or not text.strip():
            return [0.0] * self.config["dim"]

        try:
            # Preprocess
            if preprocess:
                text = self._preprocess(text)

            # Add instruction prefix for E5 models
            prefix = self.config["instruction_prefix"] if is_query else self.config["passage_prefix"]
            if prefix:
                text = prefix + text

            embedding = self._model.encode(
                text,
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            return embedding.tolist()

        except Exception as e:
            logger.exception(f"Failed to embed text: {e}")
            return [0.0] * self.config["dim"]

    def embed_texts(
        self,
        texts: List[str],
        batch_size: int = 32,
        is_query: bool = False,
        preprocess: bool = True,
    ) -> List[List[float]]:
        """
        Generate embeddings for multiple texts efficiently.

        Args:
            texts: List of texts to embed
            batch_size: Batch size for processing
            is_query: If True, use query prefix (for E5 models)
            preprocess: Whether to apply Nepali preprocessing

        Returns:
            List of embedding vectors
        """
        self._ensure_initialized()

        if not texts:
            return []

        # Preprocess and add prefixes
        prefix = self.config["instruction_prefix"] if is_query else self.config["passage_prefix"]

        processed_texts = []
        valid_indices = []

        for i, text in enumerate(texts):
            if text and text.strip():
                if preprocess:
                    text = self._preprocess(text)
                if prefix:
                    text = prefix + text
                processed_texts.append(text)
                valid_indices.append(i)

        # Generate embeddings for valid texts
        embeddings = []
        try:
            if processed_texts:
                batch_embeddings = self._model.encode(
                    processed_texts,
                    batch_size=batch_size,
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                )
                embeddings = [emb.tolist() for emb in batch_embeddings]
        except Exception as e:
            logger.exception(f"Failed to embed texts: {e}")
            embeddings = [[0.0] * self.config["dim"]] * len(processed_texts)

        # Build result with zeros for empty texts
        result = [[0.0] * self.config["dim"]] * len(texts)
        for i, idx in enumerate(valid_indices):
            result[idx] = embeddings[i]

        return result

    def compute_similarity(self, embedding1: List[float], embedding2: List[float]) -> float:
        """
        Compute cosine similarity between two embeddings.

        Args:
            embedding1: First embedding vector
            embedding2: Second embedding vector

        Returns:
            Cosine similarity score (0.0 to 1.0, higher = more similar)
        """
        if not embedding1 or not embedding2:
            return 0.0

        vec1 = np.array(embedding1)
        vec2 = np.array(embedding2)

        # Embeddings are already normalized, so dot product = cosine similarity
        similarity = float(np.dot(vec1, vec2))

        # Clamp to [0, 1] (should already be in range due to normalization)
        return max(0.0, min(1.0, similarity))

    @staticmethod
    def compute_text_hash(text: str) -> str:
        """
        Compute SHA-256 hash of text for cache validation.

        Args:
            text: Input text

        Returns:
            64-character hex hash string
        """
        if not text:
            return hashlib.sha256(b"").hexdigest()
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @property
    def model_name(self) -> str:
        """Get the model name."""
        return self.config["name"]

    @property
    def model_version(self) -> str:
        """Get the model version (includes model key for compatibility tracking)."""
        return f"2.0.0-{self.model_key}"

    @property
    def embedding_dim(self) -> int:
        """Get the embedding dimension."""
        return self.config["dim"]


class OpenAITextEmbedder(MultilingualTextEmbedder):
    """OpenAI embedding adapter with the same interface as local embedders."""

    def __init__(self):
        super().__init__(model_key="openai-3-large")
        from app.config import get_settings

        self.settings = get_settings()
        self._initialized = True

    def _ensure_initialized(self):
        """OpenAI embeddings do not require local model initialization."""
        return

    def _post_embeddings(self, inputs: List[str]) -> List[List[float]]:
        response = httpx.post(
            f"{self.settings.openai_base_url.rstrip('/')}/embeddings",
            headers={
                "Authorization": f"Bearer {self.settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.settings.openai_embedding_model,
                "input": inputs,
                "dimensions": self.settings.openai_embedding_dimensions,
            },
            timeout=60.0,
        )
        response.raise_for_status()
        payload = response.json()
        return [row["embedding"] for row in payload.get("data", [])]

    def embed_text(
        self,
        text: str,
        is_query: bool = False,
        preprocess: bool = True,
    ) -> List[float]:
        embeddings = self.embed_texts([text], is_query=is_query, preprocess=preprocess)
        return embeddings[0] if embeddings else [0.0] * self.config["dim"]

    def embed_texts(
        self,
        texts: List[str],
        batch_size: int = 32,
        is_query: bool = False,
        preprocess: bool = True,
    ) -> List[List[float]]:
        if not texts:
            return []

        if not self.settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")

        prefix = self.config["instruction_prefix"] if is_query else self.config["passage_prefix"]
        processed_texts = []
        valid_indices = []

        for i, text in enumerate(texts):
            if text and text.strip():
                if preprocess:
                    text = self._preprocess(text)
                if prefix:
                    text = prefix + text
                processed_texts.append(text)
                valid_indices.append(i)

        embeddings: List[List[float]] = []
        try:
            for start in range(0, len(processed_texts), batch_size):
                embeddings.extend(self._post_embeddings(processed_texts[start:start + batch_size]))
        except Exception as e:
            logger.exception("Failed to embed texts via OpenAI: %s", e)
            embeddings = [[0.0] * self.config["dim"]] * len(processed_texts)

        result = [[0.0] * self.config["dim"] for _ in texts]
        for i, idx in enumerate(valid_indices):
            if i < len(embeddings):
                result[idx] = embeddings[i]
        return result

    @property
    def model_name(self) -> str:
        return self.settings.openai_embedding_model

    @property
    def model_version(self) -> str:
        return f"openai-{self.settings.openai_embedding_dimensions}"


# ============================================================
# Legacy Compatibility: TextEmbedder alias
# ============================================================

class TextEmbedder(MultilingualTextEmbedder):
    """
    Legacy TextEmbedder for backward compatibility.

    Uses MiniLM by default for existing code that expects 384-dim vectors.
    New code should use MultilingualTextEmbedder with 'e5-large'.
    """

    MODEL_NAME = MODEL_CONFIGS["minilm"]["name"]
    EMBEDDING_DIM = MODEL_CONFIGS["minilm"]["dim"]
    MAX_SEQ_LENGTH = MODEL_CONFIGS["minilm"]["max_seq"]

    def __init__(self):
        """Initialize with MiniLM for backward compatibility."""
        super().__init__(model_key="minilm")


# ============================================================
# Singleton Getters
# ============================================================

def get_embedder(model_key: str = "minilm") -> MultilingualTextEmbedder:
    """
    Get the global TextEmbedder singleton.

    For backward compatibility, defaults to MiniLM (384-dim).
    Use get_multilingual_embedder() for E5-Large.

    Thread-safe initialization ensures only one instance per model key.

    Args:
        model_key: Model to use ('minilm', 'e5-base', 'e5-large')

    Returns:
        MultilingualTextEmbedder instance
    """
    global _embedder_instances

    if model_key in _embedder_instances:
        return _embedder_instances[model_key]

    with _embedder_lock:
        if model_key not in _embedder_instances:
            if model_key == "openai-3-large":
                _embedder_instances[model_key] = OpenAITextEmbedder()
            else:
                _embedder_instances[model_key] = MultilingualTextEmbedder(model_key=model_key)

    return _embedder_instances[model_key]


def get_multilingual_embedder(model_key: str = "e5-large") -> MultilingualTextEmbedder:
    """
    Get the multilingual embedder singleton (recommended).

    Defaults to E5-Large (1024-dim) for best multilingual quality.

    Args:
        model_key: Model to use ('e5-large', 'e5-base', 'minilm')

    Returns:
        MultilingualTextEmbedder instance
    """
    return get_embedder(model_key)


# ============================================================
# Utility Functions
# ============================================================

def embedding_to_bytes(embedding: List[float]) -> bytes:
    """Convert embedding list to bytes for storage."""
    return np.array(embedding, dtype=np.float32).tobytes()


def bytes_to_embedding(data: bytes) -> List[float]:
    """Convert bytes back to embedding list."""
    return np.frombuffer(data, dtype=np.float32).tolist()


def embedding_to_pgvector_literal(embedding: List[float]) -> str:
    """
    Convert embedding to pgvector literal format.

    Returns string like '[0.1,0.2,0.3,...]' for use in SQL queries.
    """
    return "[" + ",".join(str(x) for x in embedding) + "]"


def get_model_info(model_key: str = DEFAULT_MODEL_KEY) -> Dict[str, Any]:
    """
    Get information about a model configuration.

    Args:
        model_key: Model key to get info for

    Returns:
        Dict with model name, dimension, max sequence length
    """
    if model_key not in MODEL_CONFIGS:
        return {"error": f"Unknown model key: {model_key}"}

    config = MODEL_CONFIGS[model_key]
    return {
        "model_key": model_key,
        "model_name": config["name"],
        "embedding_dim": config["dim"],
        "max_seq_length": config["max_seq"],
        "uses_instruction_prefix": bool(config["instruction_prefix"]),
    }
