"""
Nepali text preprocessing for OSINT analysis.

Provides Unicode normalization, tokenization, stopword removal,
and transliteration support for Nepali (Devanagari) text.
"""

import re
import unicodedata
from typing import List, Optional, Set


class NepaliPreprocessor:
    """
    Comprehensive Nepali text preprocessing.

    Handles:
    - Unicode NFKC normalization for Devanagari
    - Nepali-specific character variations (chandrabindu, nukta)
    - Tokenization preserving Devanagari syllable structure
    - Stopword removal for common Nepali particles
    - Language detection (Nepali vs English)
    """

    # Nepali stopwords (common particles, postpositions, auxiliaries)
    STOPWORDS_NE: Set[str] = {
        # Postpositions
        "को", "का", "की", "मा", "ले", "लाई", "बाट", "सँग", "देखि", "सम्म",
        "प्रति", "तिर", "भन्दा", "वारी", "पारी", "माथि", "तल", "भित्र", "बाहिर",
        # Conjunctions
        "र", "तथा", "वा", "अथवा", "तर", "भने", "यदि", "कि", "किनभने", "त्यसैले",
        # Auxiliaries and copulas
        "छ", "छन्", "छु", "छौ", "छौं", "थियो", "थिए", "थिएँ", "थिइन्",
        "हो", "हुन्", "हुन्छ", "हुँदैन", "भयो", "भए", "भएको", "भएकी", "भएका",
        # Common verbs (auxiliary forms)
        "गर्न", "गर्ने", "गरेको", "गरेकी", "गरेका", "गर्दा", "गर्दै",
        "रहेको", "रहेकी", "रहेका", "रहन्छ", "रहँदैन",
        # Pronouns
        "यो", "त्यो", "यी", "ती", "उनी", "उनीहरू", "म", "हामी", "तिमी", "तपाईं",
        # Demonstratives
        "यस", "त्यस", "यहाँ", "त्यहाँ", "अहिले", "तब",
        # Numbers (written)
        "एक", "दुई", "तीन", "चार", "पाँच",
        # Common adverbs
        "पनि", "नै", "मात्र", "सबै", "केही", "धेरै", "अलि", "एकदम",
    }

    # Common Nepali ligatures/conjuncts (for reference, handled by NFKC)
    LIGATURE_MAP = {
        "क्ष": "क्ष",  # ksha
        "त्र": "त्र",  # tra
        "ज्ञ": "ज्ञ",  # gya/dnya
        "श्र": "श्र",  # shra
        "द्व": "द्व",  # dwa
        "द्य": "द्य",  # dya
    }

    # Devanagari Unicode range
    DEVANAGARI_START = '\u0900'
    DEVANAGARI_END = '\u097F'

    def normalize(self, text: str) -> str:
        """
        Full normalization pipeline for Nepali text.

        Steps:
        1. Unicode NFKC normalization (canonical decomposition + compatibility)
        2. Normalize Nepali-specific character variations
        3. Normalize whitespace

        Args:
            text: Input text (can be Nepali, English, or mixed)

        Returns:
            Normalized text
        """
        if not text:
            return ""

        # 1. Unicode NFKC normalization
        # This handles most Devanagari composition issues
        text = unicodedata.normalize("NFKC", text)

        # 2. Normalize Nepali-specific variations
        text = self._normalize_nepali_chars(text)

        # 3. Normalize whitespace (collapse multiple spaces, strip)
        text = re.sub(r"\s+", " ", text).strip()

        return text

    def _normalize_nepali_chars(self, text: str) -> str:
        """
        Handle Nepali-specific character variations.

        Normalizes:
        - Chandrabindu (ँ) to Anusvara (ं) for consistency
        - Removes nukta (़) from consonants where not semantically meaningful
        - Normalizes Devanagari digit variations
        """
        # Normalize chandrabindu → anusvara (common in Nepali)
        # Chandrabindu (ँ U+0901) → Anusvara (ं U+0902)
        text = text.replace("\u0901", "\u0902")

        # Remove nukta from consonants (common in Hindi loanwords)
        # Pattern: consonant + nukta → consonant
        text = re.sub(r"([\u0915-\u0939])\u093C", r"\1", text)

        # Normalize Devanagari digits to ASCII (optional, configurable)
        # ० → 0, १ → 1, etc.
        devanagari_digits = "०१२३४५६७८९"
        ascii_digits = "0123456789"
        for d, a in zip(devanagari_digits, ascii_digits):
            text = text.replace(d, a)

        return text

    def tokenize(self, text: str, normalize_first: bool = True) -> List[str]:
        """
        Nepali-aware tokenization.

        Handles Devanagari syllable structure, preserving:
        - Complete Devanagari words (consonants + vowel signs)
        - English words
        - Numbers (both Devanagari and ASCII)

        Args:
            text: Input text
            normalize_first: Whether to normalize before tokenizing

        Returns:
            List of tokens
        """
        if normalize_first:
            text = self.normalize(text)
        else:
            text = text or ""

        # Pattern matches:
        # 1. Devanagari sequences (full Unicode range)
        # 2. ASCII word characters (English)
        # 3. Digits
        tokens = re.findall(r"[\u0900-\u097F]+|[a-zA-Z]+|\d+", text)

        return [t for t in tokens if t]

    def tokenize_for_embedding(self, text: str) -> str:
        """
        Prepare text for embedding models.

        Returns space-joined tokens after normalization.
        Useful for models that handle their own subword tokenization.
        """
        tokens = self.tokenize(text)
        return " ".join(tokens)

    def remove_stopwords(self, tokens: List[str]) -> List[str]:
        """
        Remove Nepali stopwords from token list.

        Args:
            tokens: List of tokens

        Returns:
            Tokens with stopwords removed
        """
        return [t for t in tokens if t not in self.STOPWORDS_NE]

    def remove_stopwords_text(self, text: str) -> str:
        """
        Remove stopwords from text and return as string.

        Args:
            text: Input text

        Returns:
            Text with stopwords removed
        """
        tokens = self.tokenize(text)
        filtered = self.remove_stopwords(tokens)
        return " ".join(filtered)

    def is_nepali(self, text: str) -> bool:
        """
        Detect if text is primarily Nepali (Devanagari).

        Args:
            text: Input text

        Returns:
            True if >30% of characters are Devanagari
        """
        if not text:
            return False

        # Count Devanagari characters
        text_no_space = text.replace(" ", "")
        if not text_no_space:
            return False

        devanagari_count = sum(
            1 for c in text_no_space
            if self.DEVANAGARI_START <= c <= self.DEVANAGARI_END
        )

        ratio = devanagari_count / len(text_no_space)
        return ratio > 0.3

    def is_devanagari_char(self, char: str) -> bool:
        """Check if a single character is Devanagari."""
        return self.DEVANAGARI_START <= char <= self.DEVANAGARI_END

    def extract_nepali_words(self, text: str) -> List[str]:
        """
        Extract only Nepali (Devanagari) words from text.

        Args:
            text: Input text (can be mixed language)

        Returns:
            List of Nepali words only
        """
        tokens = self.tokenize(text)
        return [t for t in tokens if self._is_devanagari_token(t)]

    def extract_english_words(self, text: str) -> List[str]:
        """
        Extract only English words from text.

        Args:
            text: Input text (can be mixed language)

        Returns:
            List of English words only
        """
        tokens = self.tokenize(text)
        return [t for t in tokens if t.isascii() and t.isalpha()]

    def _is_devanagari_token(self, token: str) -> bool:
        """Check if token is entirely Devanagari."""
        return all(self.is_devanagari_char(c) for c in token)

    def get_language_ratio(self, text: str) -> dict:
        """
        Get ratio of Nepali vs English content.

        Returns:
            Dict with 'nepali', 'english', 'other' ratios
        """
        tokens = self.tokenize(text)
        if not tokens:
            return {"nepali": 0.0, "english": 0.0, "other": 0.0}

        nepali_count = sum(1 for t in tokens if self._is_devanagari_token(t))
        english_count = sum(1 for t in tokens if t.isascii() and t.isalpha())
        other_count = len(tokens) - nepali_count - english_count

        total = len(tokens)
        return {
            "nepali": nepali_count / total,
            "english": english_count / total,
            "other": other_count / total,
        }


class NepaliTransliterator:
    """
    Bidirectional transliteration: Romanized Nepali ↔ Devanagari.

    Supports:
    - Dictionary-based mapping for common Nepal-specific names
    - ITRANS-style transliteration for general text
    """

    # Common romanization patterns for Nepali place names and entities
    # These are Nepal-specific and may not follow standard ITRANS
    ROMAN_TO_DEVANAGARI = {
        # Cities and districts
        "kathmandu": "काठमाडौं",
        "pokhara": "पोखरा",
        "lalitpur": "ललितपुर",
        "bhaktapur": "भक्तपुर",
        "biratnagar": "विराटनगर",
        "birgunj": "वीरगञ्ज",
        "dharan": "धरान",
        "butwal": "बुटवल",
        "hetauda": "हेटौंडा",
        "janakpur": "जनकपुर",
        "nepalgunj": "नेपालगञ्ज",
        "bharatpur": "भरतपुर",
        "dhangadhi": "धनगढी",
        "itahari": "इटहरी",
        "damak": "दमक",
        "surkhet": "सुर्खेत",
        "tulsipur": "तुलसीपुर",
        "ghorahi": "घोराही",

        # Common surnames
        "thapa": "थापा",
        "shrestha": "श्रेष्ठ",
        "gurung": "गुरुङ",
        "tamang": "तामाङ",
        "rai": "राई",
        "limbu": "लिम्बू",
        "magar": "मगर",
        "newar": "नेवार",
        "sherpa": "शेर्पा",
        "bhattarai": "भट्टराई",
        "koirala": "कोइराला",
        "dahal": "दाहाल",
        "oli": "ओली",
        "deuba": "देउवा",
        "yadav": "यादव",
        "poudel": "पौडेल",
        "khadka": "खड्का",
        "adhikari": "अधिकारी",
        "sharma": "शर्मा",
        "pradhan": "प्रधान",

        # Political terms
        "pradesh": "प्रदेश",
        "jilla": "जिल्ला",
        "nagarpalika": "नगरपालिका",
        "gaupalika": "गाउँपालिका",
        "pradesh sabha": "प्रदेश सभा",
        "pratinidhi sabha": "प्रतिनिधि सभा",
        "rastriya sabha": "राष्ट्रिय सभा",

        # Organizations
        "nepal": "नेपाल",
        "nepali congress": "नेपाली कांग्रेस",
        "uml": "एमाले",
        "maoist": "माओवादी",
    }

    # Reverse mapping (auto-generated)
    DEVANAGARI_TO_ROMAN = {v: k for k, v in ROMAN_TO_DEVANAGARI.items()}

    def __init__(self):
        """Initialize transliterator."""
        self._indic_transliteration_available = False
        try:
            from indic_transliteration import sanscript
            self._sanscript = sanscript
            self._indic_transliteration_available = True
        except ImportError:
            pass

    def to_devanagari(self, text: str) -> str:
        """
        Convert romanized Nepali to Devanagari.

        First checks custom dictionary, then falls back to ITRANS.

        Args:
            text: Romanized text

        Returns:
            Devanagari text (or original if conversion fails)
        """
        # First check custom dictionary (case-insensitive)
        lower = text.lower().strip()
        if lower in self.ROMAN_TO_DEVANAGARI:
            return self.ROMAN_TO_DEVANAGARI[lower]

        # Fall back to ITRANS transliteration if available
        if self._indic_transliteration_available:
            try:
                from indic_transliteration.sanscript import transliterate
                return transliterate(
                    text,
                    self._sanscript.ITRANS,
                    self._sanscript.DEVANAGARI
                )
            except Exception:
                pass

        return text

    def to_roman(self, text: str) -> str:
        """
        Convert Devanagari to romanized form.

        First checks custom dictionary, then falls back to ITRANS.

        Args:
            text: Devanagari text

        Returns:
            Romanized text (or original if conversion fails)
        """
        # First check custom dictionary
        stripped = text.strip()
        if stripped in self.DEVANAGARI_TO_ROMAN:
            return self.DEVANAGARI_TO_ROMAN[stripped]

        # Fall back to ITRANS transliteration if available
        if self._indic_transliteration_available:
            try:
                from indic_transliteration.sanscript import transliterate
                return transliterate(
                    text,
                    self._sanscript.DEVANAGARI,
                    self._sanscript.ITRANS
                )
            except Exception:
                pass

        return text

    def normalize_entity_name(self, name: str) -> str:
        """
        Normalize an entity name for matching.

        Converts to lowercase romanized form for consistent matching.

        Args:
            name: Entity name (can be Devanagari or Roman)

        Returns:
            Normalized lowercase romanized form
        """
        preprocessor = NepaliPreprocessor()

        if preprocessor.is_nepali(name):
            # Convert to Roman first
            roman = self.to_roman(name)
            return roman.lower().strip()
        else:
            return name.lower().strip()

    def get_all_forms(self, name: str) -> List[str]:
        """
        Get all forms of a name (Roman + Devanagari).

        Useful for entity matching across languages.

        Args:
            name: Entity name (any form)

        Returns:
            List of all known forms
        """
        forms = [name]
        preprocessor = NepaliPreprocessor()

        if preprocessor.is_nepali(name):
            roman = self.to_roman(name)
            if roman != name:
                forms.append(roman)
                forms.append(roman.lower())
                forms.append(roman.title())
        else:
            devanagari = self.to_devanagari(name)
            if devanagari != name:
                forms.append(devanagari)
            forms.append(name.lower())
            forms.append(name.title())

        return list(set(forms))


# Singleton instances for convenience
_preprocessor: Optional[NepaliPreprocessor] = None
_transliterator: Optional[NepaliTransliterator] = None


def get_preprocessor() -> NepaliPreprocessor:
    """Get singleton preprocessor instance."""
    global _preprocessor
    if _preprocessor is None:
        _preprocessor = NepaliPreprocessor()
    return _preprocessor


def get_transliterator() -> NepaliTransliterator:
    """Get singleton transliterator instance."""
    global _transliterator
    if _transliterator is None:
        _transliterator = NepaliTransliterator()
    return _transliterator
