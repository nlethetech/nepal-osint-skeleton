"""Shared feature extraction helpers for ML feedback + training."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

import numpy as np

from app.ml.inference.predictor import RLPredictor


def build_story_text(title: str, summary: Optional[str] = None) -> str:
    """Build a compact text representation for classification/embedding."""
    parts = [title.strip() if title else ""]
    if summary:
        parts.append(summary.strip())
    return " ".join(p for p in parts if p)


def extract_tokens(text: str) -> list[str]:
    """
    Extract unicode word tokens from text.

    Works for English + Nepali (Devanagari), and keeps digits.
    """
    if not text:
        return []
    return re.findall(r"\w+", text.lower())


def extract_severity_tokens(title: str, summary: Optional[str] = None) -> list[str]:
    """Tokens used by the priority model for keyword-count features."""
    return extract_tokens(build_story_text(title, summary))


def build_priority_features(
    predictor: RLPredictor,
    *,
    category: Optional[str],
    source_id: Optional[str],
    published_at: Optional[datetime],
    severity_tokens: list[str],
    entity_count: int = 0,
) -> list[float]:
    """
    Build the 14-dim priority context feature vector used by PriorityBandit.
    """
    source_conf = 0.5
    if source_id:
        try:
            source_conf = predictor.get_source_confidence(source_id).confidence
        except Exception:
            source_conf = 0.5

    if published_at is None:
        now = datetime.now()
        hour_of_day = now.hour
        day_of_week = now.weekday()
        is_weekend = now.weekday() >= 5
    else:
        hour_of_day = published_at.hour
        day_of_week = published_at.weekday()
        is_weekend = day_of_week >= 5

    context = predictor.priority_bandit.extract_context_features(
        category=category,
        severity_keywords=severity_tokens,
        source_confidence=source_conf,
        entity_count=entity_count,
        hour_of_day=hour_of_day,
        day_of_week=day_of_week,
        is_weekend=is_weekend,
    )

    # Ensure plain JSON-serializable floats
    return np.asarray(context, dtype=np.float32).tolist()

