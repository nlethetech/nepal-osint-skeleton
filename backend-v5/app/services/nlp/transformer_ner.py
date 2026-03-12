"""
Transformer-based Named Entity Recognition for Nepal OSINT.

Uses XLM-RoBERTa fine-tuned on NER tasks for multilingual entity extraction.
Supports both English and Nepali (Devanagari) text.
"""

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class TransformerNER:
    """
    Transformer-based NER for Nepali and English.

    Uses XLM-RoBERTa fine-tuned for NER, which supports:
    - English, Hindi, and other high-resource languages
    - Reasonable zero-shot performance on Nepali (similar to Hindi)

    Entity types extracted:
    - PERSON: People names
    - ORGANIZATION: Companies, institutions, parties
    - LOCATION: Places, cities, districts
    - OTHER: Miscellaneous entities
    """

    # Model options - HuggingFace model identifiers
    MODELS = {
        # XLM-RoBERTa for high-resource languages (best multilingual)
        "xlm-roberta-ner": "Davlan/xlm-roberta-base-ner-hrl",
        # BERT multilingual NER (lighter weight)
        "bert-multilingual-ner": "dslim/bert-base-NER",
        # XLM-RoBERTa large (better accuracy, slower)
        "xlm-roberta-large-ner": "Davlan/xlm-roberta-large-ner-hrl",
    }

    # Entity type mapping to our schema
    # Maps model output labels to standardized types
    ENTITY_TYPE_MAP = {
        # Standard NER tags
        "PER": "PERSON",
        "PERSON": "PERSON",
        "ORG": "ORGANIZATION",
        "ORGANIZATION": "ORGANIZATION",
        "LOC": "LOCATION",
        "LOCATION": "LOCATION",
        "GPE": "LOCATION",  # Geo-political entity
        "FAC": "LOCATION",  # Facility
        "MISC": "OTHER",
        "EVENT": "OTHER",
        "PRODUCT": "OTHER",
        "WORK_OF_ART": "OTHER",
        "LAW": "OTHER",
        "LANGUAGE": "OTHER",
        "DATE": "OTHER",
        "TIME": "OTHER",
        "MONEY": "OTHER",
        "QUANTITY": "OTHER",
        "ORDINAL": "OTHER",
        "CARDINAL": "OTHER",
        "PERCENT": "OTHER",
        "NORP": "ORGANIZATION",  # Nationalities, religious/political groups
    }

    def __init__(
        self,
        model_key: str = "xlm-roberta-ner",
        confidence_threshold: float = 0.5,
        max_length: int = 512,
    ):
        """
        Initialize transformer NER.

        Args:
            model_key: Key from MODELS dict or direct HuggingFace model name
            confidence_threshold: Minimum confidence to include entity
            max_length: Maximum sequence length for tokenization
        """
        self.model_name = self.MODELS.get(model_key, model_key)
        self.confidence_threshold = confidence_threshold
        self.max_length = max_length
        self._pipeline = None
        self._device = None
        self._initialized = False

    def _load_pipeline(self):
        """
        Lazy load NER pipeline.

        Uses HuggingFace pipeline with automatic device detection.
        """
        if self._pipeline is not None:
            return self._pipeline

        try:
            import torch
            from transformers import pipeline

            # Device detection
            if torch.cuda.is_available():
                self._device = 0  # First CUDA device
                logger.info(f"TransformerNER using CUDA device 0")
            elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                self._device = "mps"
                logger.info("TransformerNER using Apple MPS")
            else:
                self._device = -1  # CPU
                logger.info("TransformerNER using CPU")

            # Create pipeline
            self._pipeline = pipeline(
                "ner",
                model=self.model_name,
                tokenizer=self.model_name,
                aggregation_strategy="simple",  # Merge subword tokens
                device=self._device if self._device != "mps" else -1,  # MPS not fully supported
            )

            self._initialized = True
            logger.info(f"TransformerNER loaded: {self.model_name}")

        except ImportError as e:
            logger.warning(f"transformers not available: {e}")
            self._pipeline = None
        except Exception as e:
            logger.error(f"Failed to load NER model: {e}")
            self._pipeline = None

        return self._pipeline

    @property
    def is_available(self) -> bool:
        """Check if NER pipeline is available."""
        if not self._initialized:
            self._load_pipeline()
        return self._pipeline is not None

    def extract_entities(self, text: str) -> List[Dict[str, Any]]:
        """
        Extract named entities from text.

        Args:
            text: Input text (English or Nepali)

        Returns:
            List of entity dicts with:
            - text: Entity text
            - type: Entity type (PERSON, ORGANIZATION, LOCATION, OTHER)
            - start: Start character position
            - end: End character position
            - confidence: Model confidence score
            - source: Always "transformer"
        """
        if not text or len(text.strip()) < 3:
            return []

        pipe = self._load_pipeline()
        if pipe is None:
            return []

        try:
            # Handle long texts by truncating
            if len(text) > self.max_length * 4:  # Rough char estimate
                text = text[:self.max_length * 4]

            raw_entities = pipe(text)

        except Exception as e:
            logger.warning(f"NER extraction failed: {e}")
            return []

        # Process and filter entities
        entities = []
        seen_spans = set()  # Avoid duplicates

        for ent in raw_entities:
            # Skip low-confidence entities
            score = float(ent.get("score", 0))
            if score < self.confidence_threshold:
                continue

            # Map entity type
            raw_type = ent.get("entity_group", "MISC")
            entity_type = self.ENTITY_TYPE_MAP.get(raw_type, "OTHER")

            # Get entity text (handle subword tokenization artifacts)
            entity_text = ent.get("word", "").strip()
            if not entity_text:
                continue

            # Clean up common tokenization artifacts
            entity_text = self._clean_entity_text(entity_text)
            if not entity_text or len(entity_text) < 2:
                continue

            # Create span key for deduplication
            span_key = (ent.get("start", 0), ent.get("end", 0))
            if span_key in seen_spans:
                continue
            seen_spans.add(span_key)

            entities.append({
                "text": entity_text,
                "type": entity_type,
                "start": ent.get("start", 0),
                "end": ent.get("end", 0),
                "confidence": score,
                "source": "transformer",
            })

        return entities

    def _clean_entity_text(self, text: str) -> str:
        """
        Clean up entity text from tokenization artifacts.

        Handles:
        - Leading/trailing ## from subword tokenization
        - Extra whitespace
        - Common artifacts
        """
        # Remove subword markers
        text = text.replace("##", "")

        # Remove leading/trailing punctuation (but keep internal)
        text = text.strip(" \t\n\r.,;:!?\"'")

        # Collapse whitespace
        text = " ".join(text.split())

        return text

    def extract_entities_batch(
        self,
        texts: List[str],
        batch_size: int = 8,
    ) -> List[List[Dict[str, Any]]]:
        """
        Extract entities from multiple texts.

        Args:
            texts: List of input texts
            batch_size: Processing batch size

        Returns:
            List of entity lists (one per input text)
        """
        results = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            for text in batch:
                entities = self.extract_entities(text)
                results.append(entities)

        return results

    def extract_people(self, text: str) -> List[str]:
        """Extract just person names from text."""
        entities = self.extract_entities(text)
        return [e["text"] for e in entities if e["type"] == "PERSON"]

    def extract_organizations(self, text: str) -> List[str]:
        """Extract just organization names from text."""
        entities = self.extract_entities(text)
        return [e["text"] for e in entities if e["type"] == "ORGANIZATION"]

    def extract_locations(self, text: str) -> List[str]:
        """Extract just location names from text."""
        entities = self.extract_entities(text)
        return [e["text"] for e in entities if e["type"] == "LOCATION"]

    def get_entity_summary(self, text: str) -> Dict[str, List[str]]:
        """
        Get summary of all entities by type.

        Returns:
            Dict mapping entity types to lists of entity texts
        """
        entities = self.extract_entities(text)

        summary: Dict[str, List[str]] = {
            "PERSON": [],
            "ORGANIZATION": [],
            "LOCATION": [],
            "OTHER": [],
        }

        for ent in entities:
            etype = ent["type"]
            if etype in summary:
                summary[etype].append(ent["text"])

        return summary


# Singleton instance
_transformer_ner: Optional[TransformerNER] = None


def get_transformer_ner(model_key: str = "xlm-roberta-ner") -> TransformerNER:
    """
    Get singleton transformer NER instance.

    Args:
        model_key: Model to use (ignored if already initialized)

    Returns:
        TransformerNER instance
    """
    global _transformer_ner
    if _transformer_ner is None:
        _transformer_ner = TransformerNER(model_key=model_key)
    return _transformer_ner
