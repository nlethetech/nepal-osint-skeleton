"""Embeddings service for semantic similarity."""
from app.services.embeddings.text_embedder import TextEmbedder, get_embedder
from app.services.embeddings.service import EmbeddingService

__all__ = ["TextEmbedder", "get_embedder", "EmbeddingService"]
