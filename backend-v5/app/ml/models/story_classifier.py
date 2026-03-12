"""BiLSTM-based story classifier with attention."""
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Try to import torch, but allow graceful degradation
try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    logger.warning("PyTorch not available - StoryClassifier will use fallback")


@dataclass
class ClassificationResult:
    """Result of story classification."""
    category: str
    confidence: float
    all_probabilities: dict  # category -> probability


class AttentionLayer(nn.Module if TORCH_AVAILABLE else object):
    """Self-attention layer for sequence modeling."""

    def __init__(self, hidden_dim: int):
        if not TORCH_AVAILABLE:
            return
        super().__init__()
        self.attention = nn.Linear(hidden_dim, 1)

    def forward(self, lstm_output: "torch.Tensor") -> Tuple["torch.Tensor", "torch.Tensor"]:
        """
        Apply attention over LSTM outputs.

        Args:
            lstm_output: (batch, seq_len, hidden_dim)

        Returns:
            (weighted_output, attention_weights)
        """
        # Compute attention scores
        scores = self.attention(lstm_output)  # (batch, seq_len, 1)
        weights = F.softmax(scores, dim=1)  # (batch, seq_len, 1)

        # Weighted sum
        weighted = (lstm_output * weights).sum(dim=1)  # (batch, hidden_dim)

        return weighted, weights.squeeze(-1)


class BiLSTMClassifier(nn.Module if TORCH_AVAILABLE else object):
    """
    Bidirectional LSTM classifier with attention.

    Architecture:
    - Embedding layer (pretrained or learned)
    - Bidirectional LSTM
    - Self-attention pooling
    - Fully connected classification head
    """

    def __init__(
        self,
        vocab_size: int,
        embedding_dim: int,
        hidden_dim: int,
        num_classes: int,
        dropout: float = 0.3,
        pretrained_embeddings: Optional[np.ndarray] = None,
    ):
        if not TORCH_AVAILABLE:
            return
        super().__init__()

        self.embedding_dim = embedding_dim
        self.hidden_dim = hidden_dim
        self.num_classes = num_classes

        # Embedding layer
        self.embedding = nn.Embedding(vocab_size, embedding_dim, padding_idx=0)
        if pretrained_embeddings is not None:
            self.embedding.weight.data.copy_(torch.from_numpy(pretrained_embeddings))
            self.embedding.weight.requires_grad = False  # Freeze pretrained

        # BiLSTM
        self.lstm = nn.LSTM(
            embedding_dim,
            hidden_dim,
            num_layers=2,
            batch_first=True,
            bidirectional=True,
            dropout=dropout,
        )

        # Attention
        self.attention = AttentionLayer(hidden_dim * 2)  # *2 for bidirectional

        # Classification head
        self.fc1 = nn.Linear(hidden_dim * 2, hidden_dim)
        self.fc2 = nn.Linear(hidden_dim, num_classes)
        self.dropout = nn.Dropout(dropout)

    def forward(
        self,
        input_ids: "torch.Tensor",
        attention_mask: Optional["torch.Tensor"] = None,
    ) -> Tuple["torch.Tensor", "torch.Tensor"]:
        """
        Forward pass.

        Args:
            input_ids: (batch, seq_len) token IDs
            attention_mask: (batch, seq_len) mask for padding

        Returns:
            (logits, attention_weights)
        """
        # Embed
        embedded = self.embedding(input_ids)  # (batch, seq_len, embed_dim)
        embedded = self.dropout(embedded)

        # LSTM
        lstm_out, _ = self.lstm(embedded)  # (batch, seq_len, hidden*2)

        # Apply attention mask if provided
        if attention_mask is not None:
            lstm_out = lstm_out * attention_mask.unsqueeze(-1)

        # Attention pooling
        pooled, attn_weights = self.attention(lstm_out)  # (batch, hidden*2)

        # Classification
        x = self.dropout(F.relu(self.fc1(pooled)))
        logits = self.fc2(x)  # (batch, num_classes)

        return logits, attn_weights


class StoryClassifier:
    """
    Story classifier using BiLSTM with attention.

    Classifies news stories into categories:
    - political, economic, security, disaster, social
    """

    CATEGORIES = ["political", "economic", "security", "disaster", "social"]

    def __init__(
        self,
        vocab_size: int = 50000,
        embedding_dim: int = 384,
        hidden_dim: int = 256,
        dropout: float = 0.3,
    ):
        """
        Initialize the classifier.

        Args:
            vocab_size: Size of vocabulary
            embedding_dim: Embedding dimension
            hidden_dim: LSTM hidden dimension
            dropout: Dropout probability
        """
        self.vocab_size = vocab_size
        self.embedding_dim = embedding_dim
        self.hidden_dim = hidden_dim
        self.dropout = dropout
        self.num_classes = len(self.CATEGORIES)

        self.model: Optional[BiLSTMClassifier] = None
        self.tokenizer = None  # Would be a simple tokenizer
        self._initialized = False
        self._device = "cpu"

    def initialize(self, device: str = "cpu"):
        """Initialize the model."""
        if not TORCH_AVAILABLE:
            logger.warning("PyTorch not available, using rule-based fallback")
            self._initialized = True
            return

        self._device = device
        self.model = BiLSTMClassifier(
            vocab_size=self.vocab_size,
            embedding_dim=self.embedding_dim,
            hidden_dim=self.hidden_dim,
            num_classes=self.num_classes,
            dropout=self.dropout,
        ).to(device)

        self._initialized = True
        logger.info(f"StoryClassifier initialized on {device}")

    def classify(
        self,
        title: str,
        content: Optional[str] = None,
    ) -> ClassificationResult:
        """
        Classify a story into a category.

        Args:
            title: Story title
            content: Story content (optional)

        Returns:
            ClassificationResult with category and confidence
        """
        if not self._initialized:
            self.initialize()

        # Use rule-based fallback if no model or torch unavailable
        if not TORCH_AVAILABLE or self.model is None:
            return self._rule_based_classify(title, content)

        # TODO: Implement proper tokenization and model inference
        # For now, use rule-based as fallback
        return self._rule_based_classify(title, content)

    def _rule_based_classify(
        self,
        title: str,
        content: Optional[str] = None,
    ) -> ClassificationResult:
        """
        Rule-based classification fallback.

        Uses keyword matching with word boundaries (English) and
        substring matching (Nepali) similar to relevance_service.py
        """
        import re
        text = f"{title} {content or ''}".lower()

        # English category keywords (use word boundaries)
        keywords_en = {
            "political": [
                "election", "vote", "voting", "parliament", "cabinet", "minister", "party",
                "coalition", "government", "prime minister", "president", "mp", "lawmaker",
                "congress", "uml", "maoist", "communist", "democratic", "ncm", "rpp",
                "constitution", "amendment", "diplomacy", "ambassador", "policy", "bill",
            ],
            "economic": [
                "economy", "economic", "market", "nepse", "stock", "inflation", "budget",
                "remittance", "trade", "bank", "banking", "gdp", "export", "import",
                "investment", "loan", "revenue", "tax", "customs", "rupee", "dollar",
                "tourism", "agriculture", "hydropower", "employment", "unemployment",
            ],
            "security": [
                "army", "military", "armed forces", "defense", "defence",
                "border", "borders", "frontier", "boundary",
                "police", "apf", "armed police", "security forces",
                "arrest", "arrested", "custody", "detained", "detention",
                "crime", "criminal", "gang", "mafia",
                "terrorism", "terrorist", "terror",
                "violence", "violent", "attack", "assault", "clash", "riot",
                "murder", "homicide", "killing", "killed",
                "weapon", "weapons", "arms", "gun", "guns", "firearm", "firearms",
                "smuggling", "trafficking", "drug", "drugs", "narcotics",
                "kidnap", "kidnapped", "abduct", "abducted", "hostage",
                "extortion", "threat", "threatened",
                "cybercrime", "cyber attack", "hacking",
                "espionage", "spy", "intelligence",
                "investigation",
            ],
            "disaster": [
                "earthquake", "quake", "tremor", "flood", "flooding", "landslide",
                "avalanche", "fire", "blaze", "accident", "crash", "emergency",
                "rescue", "relief", "death", "killed", "injured", "victim",
                "disaster", "catastrophe", "storm", "drought", "epidemic",
            ],
            "social": [
                "protest", "strike", "bandh", "rally", "demonstration", "health",
                "healthcare", "education", "culture", "festival", "school",
                "university", "hospital", "doctor", "teacher", "student",
                "woman", "women", "child", "environment", "pollution",
            ],
        }

        # Nepali category keywords (no word boundaries needed)
        keywords_ne = {
            "political": [
                "निर्वाचन", "मतदान", "चुनाव", "संसद", "मन्त्री", "मन्त्रालय",
                "दल", "पार्टी", "गठबन्धन", "सरकार", "राष्ट्रपति", "प्रधानमन्त्री",
                "कांग्रेस", "एमाले", "माओवादी", "संविधान", "कूटनीति", "राजदूत",
                "प्रचण्ड", "ओली", "देउवा", "बालेन",
            ],
            "economic": [
                "अर्थतन्त्र", "आर्थिक", "बजार", "नेप्से", "शेयर", "मुद्रास्फीति",
                "बजेट", "कर", "विप्रेषण", "रेमिट्यान्स", "व्यापार", "निर्यात",
                "आयात", "बैंक", "लगानी", "मूल्य", "रुपैयाँ", "पर्यटन", "कृषि",
                "जलविद्युत", "रोजगारी", "बेरोजगारी",
            ],
            "security": [
                "सेना", "सैन्य", "सशस्त्र", "सुरक्षा", "सीमा",
                "प्रहरी", "पुलिस", "एपीएफ", "सशस्त्र प्रहरी",
                "पक्राउ", "गिरफ्तार", "हिरासत", "थुनामा",
                "अपराध", "आतंकवाद", "आतंकवादी", "आतङ्क",
                "हिंसा", "झडप", "आक्रमण", "हमला", "गोली", "गोलीकाण्ड",
                "हतियार", "हातहतियार", "तस्करी",
                "लागूऔषध", "मादक पदार्थ", "ड्रग", "ड्रग्स",
                "हत्या", "लुटपाट", "अपहरण", "बन्धक",
                "अनुसन्धान", "जासुसी", "गुप्तचर",
                "साइबर", "ह्याक",
            ],
            "disaster": [
                "भूकम्प", "भुकम्प", "कम्पन", "बाढी", "डुबान", "पहिरो",
                "हिमपहिरो", "आगलागी", "आगो", "दुर्घटना", "आपतकालीन", "उद्धार",
                "राहत", "मृत्यु", "मारिए", "घाइते", "विपद", "प्रकोप", "महामारी",
            ],
            "social": [
                "प्रदर्शन", "विरोध", "आन्दोलन", "हडताल", "बन्द", "चक्काजाम",
                "र्‍याली", "स्वास्थ्य", "अस्पताल", "शिक्षा", "विद्यालय",
                "विश्वविद्यालय", "संस्कृति", "चाड", "पर्व", "धर्म", "मन्दिर",
                "महिला", "वातावरण", "प्रदूषण",
            ],
        }

        # Compile English patterns with word boundaries
        compiled_en = {}
        for cat, words in keywords_en.items():
            compiled_en[cat] = [
                re.compile(r'\b' + re.escape(w) + r'\b', re.IGNORECASE)
                for w in words
            ]

        # Count keyword matches
        scores = {}
        for category in self.CATEGORIES:
            score = 0

            # Check English keywords with word boundaries
            for pattern in compiled_en.get(category, []):
                if pattern.search(text):
                    score += 1

            # Check Nepali keywords (substring match)
            for keyword in keywords_ne.get(category, []):
                if keyword in text:
                    score += 1

            scores[category] = score

        # Get best category
        total_score = sum(scores.values())
        if total_score == 0:
            # Default to social if no matches
            return ClassificationResult(
                category="social",
                confidence=0.2,
                all_probabilities={cat: 0.2 for cat in self.CATEGORIES},
            )

        # Normalize to probabilities
        probs = {cat: score / total_score for cat, score in scores.items()}
        best_category = max(scores, key=scores.get)
        confidence = probs[best_category]

        return ClassificationResult(
            category=best_category,
            confidence=confidence,
            all_probabilities=probs,
        )

    def save(self, path: Path):
        """Save model weights."""
        if self.model is not None and TORCH_AVAILABLE:
            torch.save(self.model.state_dict(), path)
            logger.info(f"Saved StoryClassifier to {path}")

    def load(self, path: Path):
        """Load model weights."""
        if TORCH_AVAILABLE and path.exists():
            self.initialize()
            if self.model is not None:
                self.model.load_state_dict(torch.load(path, map_location=self._device))
                logger.info(f"Loaded StoryClassifier from {path}")

    def train_on_batch(
        self,
        texts: List[str],
        labels: List[str],
        learning_rate: float = 0.001,
    ) -> float:
        """
        Train on a batch of examples.

        Args:
            texts: List of text samples
            labels: List of category labels
            learning_rate: Learning rate

        Returns:
            Loss value
        """
        if not TORCH_AVAILABLE or self.model is None:
            return 0.0

        # TODO: Implement batch training
        # This would involve:
        # 1. Tokenize texts
        # 2. Convert labels to indices
        # 3. Forward pass
        # 4. Compute loss
        # 5. Backward pass
        # 6. Update weights

        return 0.0
