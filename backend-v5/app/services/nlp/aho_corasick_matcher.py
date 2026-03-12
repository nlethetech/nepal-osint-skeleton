"""
Aho-Corasick automaton for efficient multi-pattern matching.

Handles 6,600+ patterns in single text pass with O(n + k) complexity
where n = text length, k = number of matches.
"""
import logging
from typing import Dict, List, Optional, Tuple, Any
from collections import defaultdict

from app.services.nlp.entity_patterns import EntityPattern, EntityMatch

logger = logging.getLogger(__name__)

# Try to import pyahocorasick, fall back to pure Python implementation
try:
    import ahocorasick
    HAS_AHOCORASICK = True
except ImportError:
    HAS_AHOCORASICK = False
    logger.warning("pyahocorasick not installed, using fallback implementation")


class TrieNode:
    """Node in the Aho-Corasick trie (fallback implementation)."""

    def __init__(self):
        self.children: Dict[str, 'TrieNode'] = {}
        self.fail: Optional['TrieNode'] = None
        self.output: List[Tuple[str, EntityPattern]] = []


class PythonAhoCorasick:
    """
    Pure Python Aho-Corasick implementation (fallback).
    Slower than C implementation but works without dependencies.
    """

    def __init__(self):
        self.root = TrieNode()
        self._built = False

    def add_word(self, word: str, value: Tuple[str, EntityPattern]):
        """Add a word to the trie."""
        node = self.root
        for char in word:
            if char not in node.children:
                node.children[char] = TrieNode()
            node = node.children[char]
        node.output.append(value)

    def make_automaton(self):
        """Build the automaton (compute failure links)."""
        from collections import deque

        queue = deque()

        # Initialize failure links for depth-1 nodes
        for char, child in self.root.children.items():
            child.fail = self.root
            queue.append(child)

        # BFS to compute failure links
        while queue:
            current = queue.popleft()

            for char, child in current.children.items():
                queue.append(child)

                # Find failure link
                fail_node = current.fail
                while fail_node is not None and char not in fail_node.children:
                    fail_node = fail_node.fail

                child.fail = fail_node.children[char] if fail_node else self.root

                # Merge output from failure chain
                if child.fail and child.fail.output:
                    child.output = child.output + child.fail.output

        self._built = True

    def iter(self, text: str):
        """
        Iterate over all matches in text.

        Yields:
            (end_index, (pattern_text, pattern))
        """
        if not self._built:
            raise RuntimeError("Automaton not built. Call make_automaton first.")

        node = self.root

        for i, char in enumerate(text):
            # Follow failure links until match or root
            while node is not None and char not in node.children:
                node = node.fail

            if node is None:
                node = self.root
                continue

            node = node.children[char]

            # Yield all matches ending at this position
            for output in node.output:
                yield (i, output)


class AhoCorasickEntityMatcher:
    """
    High-performance entity matcher using Aho-Corasick automaton.

    Characteristics:
    - Single pass through text regardless of pattern count
    - Memory-efficient trie structure
    - Handles overlapping matches
    - Supports both English (case-insensitive) and Nepali (case-sensitive)
    """

    def __init__(self):
        self._automaton_en: Optional[Any] = None  # English patterns (lowercase)
        self._automaton_ne: Optional[Any] = None  # Nepali patterns (exact)
        self._patterns: Dict[str, EntityPattern] = {}
        self._built = False
        self._pattern_count = 0

    def _is_devanagari(self, text: str) -> bool:
        """Check if text contains Devanagari characters."""
        return any('\u0900' <= c <= '\u097F' for c in text)

    def _create_automaton(self):
        """Create automaton based on available implementation."""
        if HAS_AHOCORASICK:
            return ahocorasick.Automaton()
        else:
            return PythonAhoCorasick()

    def build_from_patterns(self, patterns: Dict[str, EntityPattern]):
        """
        Build automaton from entity patterns.

        Separates English (ASCII) and Nepali (Devanagari) patterns
        for optimal matching.
        """
        self._automaton_en = self._create_automaton()
        self._automaton_ne = self._create_automaton()
        self._patterns = {}
        self._pattern_count = 0

        en_count = 0
        ne_count = 0

        for pattern_text, pattern in patterns.items():
            self._patterns[pattern_text] = pattern

            if self._is_devanagari(pattern_text):
                # Nepali: exact match (no lowercasing)
                self._automaton_ne.add_word(pattern_text, (pattern_text, pattern))
                ne_count += 1
            else:
                # English: case-insensitive
                self._automaton_en.add_word(pattern_text.lower(), (pattern_text, pattern))
                en_count += 1

        self._automaton_en.make_automaton()
        self._automaton_ne.make_automaton()
        self._built = True
        self._pattern_count = en_count + ne_count

        logger.info(f"Built Aho-Corasick automaton: {en_count} English, {ne_count} Nepali patterns")

    def find_all_matches(self, text: str) -> List[EntityMatch]:
        """
        Find all entity matches in text.

        Returns list of EntityMatch with:
        - text: matched substring
        - start/end: character positions
        - pattern: EntityPattern with canonical_id, type, confidence
        """
        if not self._built:
            raise RuntimeError("Automaton not built. Call build_from_patterns first.")

        if not text:
            return []

        matches = []

        # English matching (case-insensitive)
        text_lower = text.lower()
        for end_idx, (pattern_text, pattern) in self._automaton_en.iter(text_lower):
            start_idx = end_idx - len(pattern_text) + 1
            matches.append(EntityMatch(
                text=text[start_idx:end_idx + 1],  # Original case
                start=start_idx,
                end=end_idx + 1,
                pattern=pattern,
                raw_confidence=pattern.confidence,
            ))

        # Nepali matching (exact)
        for end_idx, (pattern_text, pattern) in self._automaton_ne.iter(text):
            start_idx = end_idx - len(pattern_text) + 1
            matches.append(EntityMatch(
                text=text[start_idx:end_idx + 1],
                start=start_idx,
                end=end_idx + 1,
                pattern=pattern,
                raw_confidence=pattern.confidence,
            ))

        return matches

    @property
    def pattern_count(self) -> int:
        """Get total number of patterns."""
        return self._pattern_count

    @property
    def is_built(self) -> bool:
        """Check if automaton is built."""
        return self._built
