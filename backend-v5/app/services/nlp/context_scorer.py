"""
Context-based confidence scoring for entity extraction.

Adjusts confidence based on surrounding context to improve precision.
"""
import re
from typing import Set, Dict

from app.services.nlp.entity_patterns import EntityMatch


class ContextScorer:
    """
    Adjusts confidence based on surrounding context.
    Uses context hints from EntityPattern to boost/penalize.
    """

    # Context boost keywords by entity type
    PERSON_CONTEXT_BOOST: Set[str] = {
        # English
        "minister", "mp", "member", "leader", "chairman", "president",
        "chief", "prime", "deputy", "former", "elected", "candidate",
        "politician", "lawmaker", "speaker", "said", "says", "told",
        "announced", "statement",
        # Nepali
        "मन्त्री", "सांसद", "नेता", "अध्यक्ष", "सभापति", "प्रधानमन्त्री",
        "उपप्रधानमन्त्री", "पूर्व", "निर्वाचित", "उम्मेदवार", "भन्नुभयो",
        "बताउनुभयो", "वक्तव्य",
    }

    PARTY_CONTEXT_BOOST: Set[str] = {
        # English
        "party", "congress", "communist", "socialist", "coalition",
        "alliance", "opposition", "ruling", "government", "political",
        # Nepali
        "पार्टी", "काँग्रेस", "कम्युनिष्ट", "समाजवादी", "गठबन्धन",
        "विपक्षी", "सत्तारुढ", "सरकार", "राजनीतिक",
    }

    LOCATION_CONTEXT_BOOST: Set[str] = {
        # English
        "district", "province", "constituency", "election", "area",
        "region", "zone", "municipality", "village", "city", "in",
        # Nepali
        "जिल्ला", "प्रदेश", "निर्वाचन क्षेत्र", "चुनाव", "क्षेत्र",
        "नगरपालिका", "गाउँपालिका", "महानगरपालिका", "मा",
    }

    # Penalty keywords (contexts where entity might be misidentified)
    PENALTY_KEYWORDS: Set[str] = {
        "advertisement", "sponsored", "विज्ञापन",
    }

    def __init__(self, context_window: int = 50):
        """
        Initialize context scorer.

        Args:
            context_window: Characters to look before/after match
        """
        self.context_window = context_window

    def score_with_context(
        self,
        match: EntityMatch,
        text: str,
        window: int = None,
    ) -> float:
        """
        Score match based on surrounding context.

        Args:
            match: Entity match with raw confidence
            text: Full text
            window: Characters to look before/after match (default: self.context_window)

        Returns:
            Adjusted confidence (0.0 - 1.0)
        """
        if window is None:
            window = self.context_window

        confidence = match.raw_confidence

        # Extract context window
        start = max(0, match.start - window)
        end = min(len(text), match.end + window)
        context = text[start:end].lower()

        # Boost based on entity type context
        entity_type = match.pattern.entity_type

        if entity_type == "PERSON":
            boost = self._compute_person_boost(match, context)
            confidence = min(1.0, confidence + boost)

        elif entity_type == "ORGANIZATION":
            boost = self._compute_org_boost(match, context)
            confidence = min(1.0, confidence + boost)

        elif entity_type == "LOCATION":
            boost = self._compute_location_boost(match, context)
            confidence = min(1.0, confidence + boost)

        # Apply penalties
        penalty = self._compute_penalty(match, context)
        confidence = max(0.0, confidence - penalty)

        # Length-based adjustment (short names are risky)
        confidence = self._adjust_for_length(match, confidence)

        return confidence

    def _compute_person_boost(self, match: EntityMatch, context: str) -> float:
        """Compute confidence boost for person entities."""
        boost = 0.0

        # Context keywords
        if any(kw in context for kw in self.PERSON_CONTEXT_BOOST):
            boost += 0.08

        # Party mentioned nearby confirms person
        party = match.pattern.context_hints.get("party", "")
        if party and party.lower() in context:
            boost += 0.12

        # Constituency mentioned nearby
        constituency = match.pattern.context_hints.get("constituency", "")
        if constituency and constituency.lower() in context:
            boost += 0.10

        # Role/title mentioned
        if match.pattern.context_hints.get("is_minister"):
            if "minister" in context or "मन्त्री" in context:
                boost += 0.08

        return boost

    def _compute_org_boost(self, match: EntityMatch, context: str) -> float:
        """Compute confidence boost for organization entities."""
        boost = 0.0

        if any(kw in context for kw in self.PARTY_CONTEXT_BOOST):
            boost += 0.10

        # Political context
        if "election" in context or "चुनाव" in context or "निर्वाचन" in context:
            boost += 0.08

        return boost

    def _compute_location_boost(self, match: EntityMatch, context: str) -> float:
        """Compute confidence boost for location entities."""
        boost = 0.0

        if any(kw in context for kw in self.LOCATION_CONTEXT_BOOST):
            boost += 0.10

        # Province ID mentioned
        province_id = match.pattern.context_hints.get("province_id")
        if province_id:
            if f"province {province_id}" in context or f"प्रदेश {province_id}" in context:
                boost += 0.08

        return boost

    def _compute_penalty(self, match: EntityMatch, context: str) -> float:
        """Compute confidence penalty based on context."""
        penalty = 0.0

        # Advertisement/sponsored content
        if any(kw in context for kw in self.PENALTY_KEYWORDS):
            penalty += 0.15

        # Very short context (might be out of context)
        if len(context.strip()) < 20:
            penalty += 0.05

        return penalty

    def _adjust_for_length(self, match: EntityMatch, confidence: float) -> float:
        """
        Adjust confidence based on match length.
        Short matches (< 4 chars) are high risk for false positives.
        """
        match_len = len(match.text)

        if match_len < 3:
            # Very short - high risk
            confidence *= 0.5
        elif match_len < 4:
            # Short - moderate risk
            confidence *= 0.7
        elif match_len < 6:
            # Somewhat short
            confidence *= 0.9

        return confidence


class OverlapResolver:
    """
    Resolves overlapping entity matches.
    Prefers: longer matches > higher confidence > earlier position
    """

    def resolve_overlaps(self, matches: list) -> list:
        """
        Remove overlapping matches, keeping best candidates.

        Strategy:
        1. Sort by (start, -length, -confidence)
        2. Greedy selection: take non-overlapping with best score

        Args:
            matches: List of EntityMatch objects

        Returns:
            List of non-overlapping matches
        """
        if not matches:
            return []

        # Sort: earlier start, then longer, then higher confidence
        sorted_matches = sorted(
            matches,
            key=lambda m: (m.start, -(m.end - m.start), -m.raw_confidence)
        )

        selected = []
        last_end = -1

        for match in sorted_matches:
            if match.start >= last_end:
                # No overlap - accept
                selected.append(match)
                last_end = match.end
            else:
                # Overlap - check if this is better
                if selected and (match.end - match.start) > (selected[-1].end - selected[-1].start):
                    # Longer match takes precedence
                    selected[-1] = match
                    last_end = match.end

        return selected

    def resolve_overlaps_by_confidence(self, matches: list, threshold: float = 0.3) -> list:
        """
        Resolve overlaps preferring higher confidence matches.

        Args:
            matches: List of EntityMatch objects
            threshold: Minimum overlap ratio to consider as overlap

        Returns:
            List of non-overlapping matches
        """
        if not matches:
            return []

        # Sort by confidence descending
        sorted_matches = sorted(matches, key=lambda m: -m.raw_confidence)

        selected = []
        used_ranges = []

        for match in sorted_matches:
            # Check if overlaps with any selected
            overlaps = False
            for used_start, used_end in used_ranges:
                # Calculate overlap
                overlap_start = max(match.start, used_start)
                overlap_end = min(match.end, used_end)
                if overlap_start < overlap_end:
                    # There is overlap
                    overlap_len = overlap_end - overlap_start
                    match_len = match.end - match.start
                    if overlap_len / match_len >= threshold:
                        overlaps = True
                        break

            if not overlaps:
                selected.append(match)
                used_ranges.append((match.start, match.end))

        # Sort by position for output
        return sorted(selected, key=lambda m: m.start)
