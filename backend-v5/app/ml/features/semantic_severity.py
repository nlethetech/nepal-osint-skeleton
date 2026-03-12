"""
Semantic severity detection using embedding similarity.

Uses multilingual embeddings to classify news severity based on
semantic similarity to example stories, far more robust than keyword matching.
"""

import logging
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class SemanticSeverityDetector:
    """
    Detect news severity using semantic similarity to example stories.

    Instead of matching keywords, computes embedding similarity to
    representative examples for each severity level. This provides:
    - Better handling of paraphrased content
    - Cross-lingual severity detection (English ↔ Nepali)
    - Graceful handling of novel expressions

    Severity levels:
    - critical: Mass casualties, major disasters, national crises
    - high: Serious incidents, multiple injuries, significant unrest
    - medium: Notable events, policy changes, protests
    - low: Cultural events, sports, routine news
    """

    # Example phrases for each severity level (bilingual: English + Nepali)
    # These will be embedded and used as centroids for similarity matching
    # TUNED based on real Nepal news evaluation (2026-02-01):
    # - Added more medium-severity Nepali news examples (sports, markets, weather, politics)
    # - Made low-severity examples more clearly trivial (pure entertainment/celebrations)
    SEVERITY_EXAMPLES: Dict[str, List[str]] = {
        "critical": [
            # English examples - mass casualties, national crises
            "Multiple people killed in explosion attack",
            "Major earthquake kills dozens of people",
            "Terrorist attack leaves many dead and injured",
            "Plane crash kills all passengers on board",
            "Massive flood kills hundreds, thousands displaced",
            "Armed conflict erupts, heavy casualties reported",
            "Building collapse traps hundreds of people",
            "Bomb blast in crowded market area",
            "Bus accident kills fifteen passengers",
            "Fire at factory kills workers trapped inside",
            # Nepali examples
            "विस्फोटमा धेरैको मृत्यु भएको छ",
            "भूकम्पमा ठूलो क्षति र मृत्यु",
            "आतंकवादी आक्रमणमा बहुसंख्यक मारिए",
            "विमान दुर्घटनामा सबैको मृत्यु",
            "बाढीले सयौंको ज्यान लियो",
            "सशस्त्र द्वन्द्वमा ठूलो क्षति",
            "भवन भत्किँदा धेरै पुरिए",
            "बम विस्फोटमा धेरै घाइते",
            "बस दुर्घटनामा १५ जनाको मृत्यु",
            "ट्रक दुर्घटनामा मृत्यु",
        ],
        "high": [
            # English examples - serious incidents, injuries, significant events
            "Several injured in violent clash between groups",
            "Flood displaces thousands of families from homes",
            "Police arrest suspects in murder investigation",
            "Shooting incident leaves multiple wounded",
            "Major fire destroys factory, workers injured",
            "Landslide buries village homes",
            "Riot police deploy tear gas against protesters",
            "Bridge collapse injures several people",
            "Corruption scandal implicates top officials",
            "Heavy rainfall causes flooding in capital",
            # Nepali examples
            "हिंसात्मक झडपमा धेरै घाइते भए",
            "बाढीले हजारौं विस्थापित भए",
            "हत्या आरोपमा संदिग्ध पक्राउ",
            "गोली चल्दा धेरै घाइते",
            "आगलागीमा कारखाना नष्ट",
            "पहिरोले गाउँ पुर्यो",
            "प्रहरीले अश्रुग्यास प्रहार गर्यो",
            "पुल भाँचिँदा घाइते भए",
            "भ्रष्टाचारमा उच्च अधिकारी संलग्न",
            "भारी वर्षाले राजधानीमा जलमग्न",
        ],
        "medium": [
            # English examples - routine political/economic news
            "Protest disrupts traffic in capital city",
            "Government announces new economic policy",
            "Political parties hold coalition meeting",
            "Parliament debates controversial bill",
            "Workers union calls for nationwide strike",
            "Election commission announces poll dates",
            "Minister resigns amid controversy",
            "Court issues landmark ruling on case",
            "Stock market index drops twenty points",
            "Prime Minister meets foreign delegation",
            "Nepal football team plays international match",
            "Weather department issues rain warning",
            "New infrastructure project announced",
            "Trade agreement signed with neighbor country",
            # Nepali examples - EXPANDED for better coverage
            "प्रदर्शनले यातायात अवरुद्ध भयो",
            "सरकारको नयाँ आर्थिक नीति घोषणा",
            "राजनीतिक दलहरूको गठबन्धन बैठक",
            "संसदमा विवादास्पद विधेयकमाथि बहस",
            "मजदूर संगठनको राष्ट्रव्यापी हड्ताल आह्वान",
            "निर्वाचन आयोगले मिति तोक्यो",
            "विवादपछि मन्त्रीको राजीनामा",
            "अदालतको ऐतिहासिक फैसला",
            # Sports and competitions (medium, not low)
            "नेपाल भुटानसँग भिड्दै",
            "साफ महिला च्याम्पियनसिप खेल",
            "नेप्से २० अंकले घट्यो",
            "शेयर बजारमा गिरावट",
            "प्रधानमन्त्रीको भारत भ्रमण",
            "मौसम विभागको वर्षाको चेतावनी",
            "तीन प्रदेशमा वर्षा र हिमपातको सम्भावना",
            "नारायणी नदीमा पानीको सतह बढ्यो",
            "विश्वकपमा नेपालको खेल",
            "आइपिएल लिलामीमा नेपाली खेलाडी",
            "राष्ट्रिय सभा बैठक",
            "व्यापार घाटा बढ्यो",
        ],
        "low": [
            # English examples - PURE entertainment/celebrations (clearly trivial)
            "Festival celebrations bring joy to families",
            "Celebrity wedding attracts media attention",
            "New restaurant opens in tourist area",
            "Local artist exhibition showcases paintings",
            "Tourism board promotes visit Nepal campaign",
            "Fashion show held at hotel",
            "Book launch event attracts readers",
            "Music concert entertains audience",
            # Nepali examples - PURE celebrations/entertainment
            "देशभर दशैंको रौनक",
            "तिहारको झिलिमिली",
            "होलीको रंगमा रंगिए",
            "नयाँ वर्षको शुभकामना",
            "विवाह समारोहमा हर्षोल्लास",
            "चलचित्र महोत्सव सम्पन्न",
            "गायनको कार्यक्रममा दर्शक",
            "पर्यटन प्रवर्द्धन अभियान",
            "कला प्रदर्शनीमा उत्कृष्ट कृति",
            "होटलमा खाना महोत्सव",
        ],
    }

    # Severity level weights for scoring
    SEVERITY_WEIGHTS = {
        "critical": 4,
        "high": 3,
        "medium": 2,
        "low": 1,
    }

    def __init__(
        self,
        temperature: float = 0.2,
        min_confidence: float = 0.3,
    ):
        """
        Initialize the severity detector.

        Args:
            temperature: Softmax temperature for score normalization
                         Lower = more confident predictions
            min_confidence: Minimum confidence to return a severity
                           Below this, returns "unknown"
        """
        self.temperature = temperature
        self.min_confidence = min_confidence
        self._embedder = None
        self._severity_centroids: Optional[Dict[str, np.ndarray]] = None
        self._initialized = False

    @property
    def embedder(self):
        """Lazy-load the multilingual embedder."""
        if self._embedder is None:
            try:
                from app.services.embeddings.text_embedder import get_multilingual_embedder
                self._embedder = get_multilingual_embedder(model_key="e5-large")
            except ImportError:
                logger.warning("E5-Large embedder not available, falling back to MiniLM")
                from app.services.embeddings.text_embedder import get_embedder
                self._embedder = get_embedder(model_key="minilm")
        return self._embedder

    def _ensure_initialized(self):
        """Compute severity centroids on first use."""
        if self._initialized:
            return

        logger.info("Initializing semantic severity centroids...")

        self._severity_centroids = {}

        for severity, examples in self.SEVERITY_EXAMPLES.items():
            # Embed all examples for this severity level
            embeddings = self.embedder.embed_texts(
                examples,
                is_query=False,  # These are passages, not queries
                preprocess=True,
            )

            # Compute centroid (mean embedding)
            centroid = np.mean(embeddings, axis=0)

            # Normalize centroid for cosine similarity
            norm = np.linalg.norm(centroid)
            if norm > 0:
                centroid = centroid / norm

            self._severity_centroids[severity] = centroid

            logger.debug(
                f"Computed centroid for '{severity}' from {len(examples)} examples"
            )

        self._initialized = True
        logger.info("Semantic severity centroids initialized")

    def detect_severity(
        self,
        text: str,
    ) -> Tuple[str, float, Dict[str, float]]:
        """
        Detect severity level using semantic similarity.

        Args:
            text: Input text (news title, headline, or content)

        Returns:
            Tuple of:
            - severity_label: "critical", "high", "medium", "low", or "unknown"
            - confidence: Confidence score (0.0 to 1.0)
            - all_scores: Dict mapping each severity to its probability
        """
        self._ensure_initialized()

        if not text or not text.strip():
            return "unknown", 0.0, {}

        # Embed the input text as a query
        text_embedding = np.array(
            self.embedder.embed_text(text, is_query=True, preprocess=True)
        )

        # Normalize for cosine similarity
        text_norm = np.linalg.norm(text_embedding)
        if text_norm > 0:
            text_embedding = text_embedding / text_norm

        # Compute similarity to each severity centroid
        raw_scores = {}
        for severity, centroid in self._severity_centroids.items():
            # Cosine similarity (dot product of normalized vectors)
            similarity = float(np.dot(text_embedding, centroid))
            raw_scores[severity] = similarity

        # Apply softmax normalization with temperature
        # Higher temperature = more uniform distribution
        # Lower temperature = more confident (peaky) distribution
        inv_temp = 1.0 / self.temperature
        exp_scores = {
            k: np.exp(v * inv_temp) for k, v in raw_scores.items()
        }
        total = sum(exp_scores.values())

        if total <= 0:
            return "unknown", 0.0, {}

        probabilities = {k: v / total for k, v in exp_scores.items()}

        # Get best severity
        best_severity = max(probabilities, key=probabilities.get)
        confidence = probabilities[best_severity]

        # Check minimum confidence threshold
        if confidence < self.min_confidence:
            return "unknown", confidence, probabilities

        return best_severity, confidence, probabilities

    def detect_severity_batch(
        self,
        texts: List[str],
    ) -> List[Tuple[str, float, Dict[str, float]]]:
        """
        Detect severity for multiple texts efficiently.

        Args:
            texts: List of input texts

        Returns:
            List of (severity_label, confidence, all_scores) tuples
        """
        self._ensure_initialized()

        if not texts:
            return []

        # Batch embed all texts
        embeddings = self.embedder.embed_texts(
            texts,
            is_query=True,
            preprocess=True,
        )

        results = []
        for i, text_embedding in enumerate(embeddings):
            text_embedding = np.array(text_embedding)

            # Normalize
            text_norm = np.linalg.norm(text_embedding)
            if text_norm > 0:
                text_embedding = text_embedding / text_norm

            # Compute similarities
            raw_scores = {}
            for severity, centroid in self._severity_centroids.items():
                similarity = float(np.dot(text_embedding, centroid))
                raw_scores[severity] = similarity

            # Softmax
            inv_temp = 1.0 / self.temperature
            exp_scores = {k: np.exp(v * inv_temp) for k, v in raw_scores.items()}
            total = sum(exp_scores.values())

            if total <= 0:
                results.append(("unknown", 0.0, {}))
                continue

            probabilities = {k: v / total for k, v in exp_scores.items()}
            best_severity = max(probabilities, key=probabilities.get)
            confidence = probabilities[best_severity]

            if confidence < self.min_confidence:
                results.append(("unknown", confidence, probabilities))
            else:
                results.append((best_severity, confidence, probabilities))

        return results

    def get_severity_score(self, text: str) -> float:
        """
        Get a numeric severity score (0.0 to 1.0).

        Higher score = more severe.
        Useful for sorting/ranking by severity.

        Args:
            text: Input text

        Returns:
            Severity score between 0.0 and 1.0
        """
        severity, confidence, probabilities = self.detect_severity(text)

        if not probabilities:
            return 0.5  # Neutral for unknown

        # Weighted average based on severity levels
        weighted_sum = sum(
            probabilities.get(sev, 0) * weight
            for sev, weight in self.SEVERITY_WEIGHTS.items()
        )

        # Normalize to 0-1 range (max possible = 4, min = 1)
        max_weight = max(self.SEVERITY_WEIGHTS.values())
        min_weight = min(self.SEVERITY_WEIGHTS.values())

        score = (weighted_sum - min_weight) / (max_weight - min_weight)
        return max(0.0, min(1.0, score))

    def is_high_severity(self, text: str, threshold: float = 0.6) -> bool:
        """
        Quick check if text is high or critical severity.

        Args:
            text: Input text
            threshold: Combined probability threshold for high+critical

        Returns:
            True if likely high/critical severity
        """
        _, _, probabilities = self.detect_severity(text)

        if not probabilities:
            return False

        high_prob = probabilities.get("high", 0) + probabilities.get("critical", 0)
        return high_prob >= threshold

    def explain_severity(self, text: str) -> Dict:
        """
        Get detailed explanation of severity detection.

        Useful for debugging and understanding model behavior.

        Args:
            text: Input text

        Returns:
            Dict with severity, confidence, all scores, and reasoning
        """
        self._ensure_initialized()

        severity, confidence, probabilities = self.detect_severity(text)

        # Get raw similarities for explanation
        text_embedding = np.array(
            self.embedder.embed_text(text, is_query=True, preprocess=True)
        )
        text_norm = np.linalg.norm(text_embedding)
        if text_norm > 0:
            text_embedding = text_embedding / text_norm

        raw_similarities = {}
        for sev, centroid in self._severity_centroids.items():
            raw_similarities[sev] = float(np.dot(text_embedding, centroid))

        # Sort by probability
        sorted_probs = sorted(
            probabilities.items(), key=lambda x: x[1], reverse=True
        )

        return {
            "text": text[:200] + "..." if len(text) > 200 else text,
            "predicted_severity": severity,
            "confidence": confidence,
            "probabilities": dict(sorted_probs),
            "raw_similarities": raw_similarities,
            "numeric_score": self.get_severity_score(text),
            "is_high_severity": self.is_high_severity(text),
        }


# Singleton instance
_severity_detector: Optional[SemanticSeverityDetector] = None


def get_severity_detector(
    temperature: float = 0.2,
    min_confidence: float = 0.3,
) -> SemanticSeverityDetector:
    """
    Get singleton semantic severity detector.

    Args:
        temperature: Softmax temperature (only used on first call)
        min_confidence: Minimum confidence threshold (only used on first call)

    Returns:
        SemanticSeverityDetector instance
    """
    global _severity_detector
    if _severity_detector is None:
        _severity_detector = SemanticSeverityDetector(
            temperature=temperature,
            min_confidence=min_confidence,
        )
    return _severity_detector
