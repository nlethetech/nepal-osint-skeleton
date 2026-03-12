"""
Word Boundary Validator for entity extraction.

Validates that entity matches respect word boundaries to reduce false positives.
E.g., "Ram" should not match inside "Ramesh", "Congress" should not match inside "Congressional".
"""
import re
from typing import Set

from app.services.nlp.entity_patterns import EntityMatch


class BoundaryValidator:
    """
    Validates entity matches respect word boundaries.
    Critical for reducing false positives.
    """

    # Nepali word boundary characters (spaces, punctuation, sentence markers)
    NEPALI_BOUNDARIES: Set[str] = {
        ' ', '\n', '\t', '\r',
        '।', ',', ';', ':', '!', '?', '.',
        '(', ')', '[', ']', '{', '}',
        '"', '"', ''', ''', '"', "'",
        '–', '—', '-',
        '॥',  # Double danda
    }

    # Characters that can appear at word edges in Nepali
    # These should NOT be considered boundaries
    NEPALI_WORD_CHARS = set('ँंःऽ')  # Chandrabindu, anusvara, visarga, avagraha

    def __init__(self):
        # Compile regex for efficiency
        self._english_word_char = re.compile(r'[a-zA-Z0-9]')

    def _is_devanagari(self, text: str) -> bool:
        """Check if text contains Devanagari characters."""
        return any('\u0900' <= c <= '\u097F' for c in text)

    def _is_devanagari_char(self, char: str) -> bool:
        """Check if single character is Devanagari."""
        return '\u0900' <= char <= '\u097F'

    def is_valid_boundary(self, text: str, match: EntityMatch) -> bool:
        """
        Check if match has valid word boundaries.

        Rules:
        - English: must be surrounded by non-alphanumeric or string edges
        - Nepali: must be surrounded by spaces, punctuation, or string edges

        Args:
            text: Full text
            match: EntityMatch with start/end positions

        Returns:
            True if boundaries are valid, False otherwise
        """
        start, end = match.start, match.end
        matched_text = match.text

        if self._is_devanagari(matched_text):
            return self._check_nepali_boundary(text, start, end)
        else:
            return self._check_english_boundary(text, start, end)

    def _check_english_boundary(self, text: str, start: int, end: int) -> bool:
        """
        English boundary: alphanumeric edges must be at word boundary.

        Returns False if:
        - Character before start is alphanumeric
        - Character after end is alphanumeric
        """
        # Check left boundary
        if start > 0:
            left_char = text[start - 1]
            if self._english_word_char.match(left_char):
                return False

        # Check right boundary
        if end < len(text):
            right_char = text[end]
            if self._english_word_char.match(right_char):
                return False

        return True

    def _check_nepali_boundary(self, text: str, start: int, end: int) -> bool:
        """
        Nepali boundary: spaces, punctuation, or string edges.

        Nepali words can have combining marks (matras) attached,
        so we need to be careful about what constitutes a boundary.
        """
        # Check left boundary
        if start > 0:
            left_char = text[start - 1]
            # Must be either a boundary char or non-Devanagari
            if left_char not in self.NEPALI_BOUNDARIES:
                if self._is_devanagari_char(left_char) and left_char not in self.NEPALI_WORD_CHARS:
                    # It's a Devanagari letter, not a boundary
                    return False

        # Check right boundary
        if end < len(text):
            right_char = text[end]
            if right_char not in self.NEPALI_BOUNDARIES:
                if self._is_devanagari_char(right_char):
                    # Check if it's a matra (combining vowel sign)
                    # Matras are in range 0x093E-0x094D, 0x0962-0x0963
                    if '\u093E' <= right_char <= '\u094D' or '\u0962' <= right_char <= '\u0963':
                        # Matra attached to match - likely part of same word
                        return False
                    # It's a Devanagari consonant/vowel, not a boundary
                    return False

        return True

    def filter_valid_matches(self, text: str, matches: list) -> list:
        """
        Filter matches to only those with valid boundaries.

        Args:
            text: Full text
            matches: List of EntityMatch

        Returns:
            List of matches with valid word boundaries
        """
        return [m for m in matches if self.is_valid_boundary(text, m)]
