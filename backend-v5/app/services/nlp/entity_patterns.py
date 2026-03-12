"""
Entity Pattern definitions for database-driven entity extraction.
"""
from dataclasses import dataclass, field
from typing import Dict, Any, Optional


@dataclass
class EntityPattern:
    """
    Pattern for entity recognition with metadata.

    Attributes:
        canonical_id: Unique identifier for entity resolution
        entity_type: PERSON, ORGANIZATION, LOCATION
        confidence: Base confidence score (0.0-1.0)
        context_hints: Additional context (party, constituency, role)
        source: Where pattern came from (candidate, mp, kb, etc.)
    """
    canonical_id: str
    entity_type: str
    confidence: float = 0.8
    context_hints: Dict[str, Any] = field(default_factory=dict)
    source: str = "unknown"

    def __post_init__(self):
        # Normalize entity type
        self.entity_type = self.entity_type.upper()
        # Clamp confidence
        self.confidence = max(0.0, min(1.0, self.confidence))


@dataclass
class EntityMatch:
    """
    Raw match from pattern matching before validation.

    Attributes:
        text: Matched text from input
        start: Start character position
        end: End character position
        pattern: EntityPattern that matched
        raw_confidence: Initial confidence (may be adjusted)
    """
    text: str
    start: int
    end: int
    pattern: EntityPattern
    raw_confidence: float

    def __post_init__(self):
        if self.raw_confidence == 0:
            self.raw_confidence = self.pattern.confidence


@dataclass
class ExtractedEntity:
    """
    Final extracted entity with full metadata.

    Attributes:
        text: Original matched text
        canonical_id: Resolved canonical identifier
        entity_type: PERSON, ORGANIZATION, LOCATION
        confidence: Final confidence score
        start: Start position in text
        end: End position in text
        metadata: Additional context (party, constituency, etc.)
        source: Extraction source (database, transformer, rule)
    """
    text: str
    canonical_id: str
    entity_type: str
    confidence: float
    start: int
    end: int
    metadata: Dict[str, Any] = field(default_factory=dict)
    source: str = "database"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "text": self.text,
            "canonical_id": self.canonical_id,
            "type": self.entity_type,
            "confidence": self.confidence,
            "start": self.start,
            "end": self.end,
            "metadata": self.metadata,
            "source": self.source,
        }
