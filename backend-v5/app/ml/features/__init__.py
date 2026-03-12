"""
ML feature extraction modules.

Provides semantic severity detection and enhanced feature extraction
for the RL-based priority system.
"""

from .semantic_severity import (
    SemanticSeverityDetector,
    get_severity_detector,
)

__all__ = [
    "SemanticSeverityDetector",
    "get_severity_detector",
]
