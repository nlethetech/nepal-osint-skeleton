"""MinHash signature generator for efficient similarity estimation."""
import hashlib
import re
from typing import List, Set

# 128 random seeds for hash functions
# Using prime numbers to reduce collision likelihood
HASH_SEEDS = [
    104729, 104743, 104759, 104761, 104773, 104779, 104789, 104801,
    104803, 104827, 104831, 104849, 104851, 104869, 104879, 104891,
    104911, 104917, 104933, 104947, 104953, 104959, 104971, 104987,
    104999, 105019, 105023, 105031, 105037, 105071, 105097, 105107,
    105137, 105143, 105167, 105173, 105199, 105211, 105227, 105229,
    105239, 105251, 105253, 105263, 105269, 105277, 105319, 105323,
    105331, 105337, 105341, 105359, 105361, 105367, 105373, 105379,
    105389, 105397, 105401, 105407, 105437, 105449, 105467, 105491,
    105499, 105503, 105509, 105517, 105527, 105529, 105533, 105541,
    105557, 105563, 105601, 105607, 105613, 105619, 105649, 105653,
    105667, 105673, 105683, 105691, 105701, 105727, 105733, 105751,
    105761, 105767, 105769, 105817, 105829, 105863, 105871, 105883,
    105899, 105907, 105913, 105929, 105943, 105953, 105967, 105971,
    105977, 105983, 105997, 106013, 106019, 106031, 106033, 106087,
    106103, 106109, 106121, 106123, 106129, 106163, 106181, 106187,
    106189, 106207, 106213, 106217, 106219, 106243, 106261, 106273,
]

# Large prime for modular arithmetic
LARGE_PRIME = 2147483647  # 2^31 - 1


class MinHashGenerator:
    """
    Generates MinHash signatures for text documents.

    MinHash allows O(128) similarity estimation between documents
    instead of O(n) where n is the number of shingles.

    Uses 128 hash functions to create a signature that approximates
    Jaccard similarity between the shingle sets of two documents.
    """

    NUM_HASHES = 128
    SHINGLE_SIZE = 3  # Character 3-grams

    def __init__(self, num_hashes: int = NUM_HASHES, shingle_size: int = SHINGLE_SIZE):
        """
        Initialize the MinHash generator.

        Args:
            num_hashes: Number of hash functions (signature length)
            shingle_size: Size of character n-grams
        """
        self.num_hashes = min(num_hashes, len(HASH_SEEDS))
        self.shingle_size = shingle_size
        self.seeds = HASH_SEEDS[: self.num_hashes]

    def _normalize_text(self, text: str) -> str:
        """Normalize text for shingling."""
        # Lowercase
        text = text.lower()
        # Remove non-alphanumeric except spaces
        text = re.sub(r"[^a-z0-9\s]", "", text)
        # Collapse whitespace
        text = " ".join(text.split())
        return text

    def _get_shingles(self, text: str) -> Set[str]:
        """
        Extract character n-grams (shingles) from text.

        Args:
            text: Input text

        Returns:
            Set of n-gram strings
        """
        text = self._normalize_text(text)

        if len(text) < self.shingle_size:
            return {text} if text else set()

        shingles = set()
        for i in range(len(text) - self.shingle_size + 1):
            shingle = text[i : i + self.shingle_size]
            shingles.add(shingle)

        return shingles

    def _hash_shingle(self, shingle: str, seed: int) -> int:
        """
        Hash a shingle with a specific seed.

        Uses MD5 hash combined with seed for pseudo-random hash function.
        """
        # Combine shingle with seed
        combined = f"{seed}:{shingle}".encode("utf-8")
        hash_bytes = hashlib.md5(combined).digest()

        # Convert first 8 bytes to integer
        hash_int = int.from_bytes(hash_bytes[:8], byteorder="big")

        # Modular arithmetic to keep in reasonable range
        return hash_int % LARGE_PRIME

    def compute_signature(self, text: str) -> List[int]:
        """
        Compute MinHash signature for text.

        Args:
            text: Input text

        Returns:
            List of 128 integers representing the MinHash signature
        """
        shingles = self._get_shingles(text)

        if not shingles:
            # Return maximum values for empty text (will not match anything)
            return [LARGE_PRIME] * self.num_hashes

        # For each hash function, find minimum hash value across all shingles
        signature = []
        for seed in self.seeds:
            min_hash = LARGE_PRIME
            for shingle in shingles:
                h = self._hash_shingle(shingle, seed)
                if h < min_hash:
                    min_hash = h
            signature.append(min_hash)

        return signature

    def estimate_similarity(self, sig1: List[int], sig2: List[int]) -> float:
        """
        Estimate Jaccard similarity from MinHash signatures.

        The probability that two signatures agree at a position
        equals the Jaccard similarity of the original sets.

        Args:
            sig1: First MinHash signature
            sig2: Second MinHash signature

        Returns:
            Estimated Jaccard similarity (0.0 to 1.0)
        """
        if not sig1 or not sig2:
            return 0.0

        if len(sig1) != len(sig2):
            # Use shorter length
            min_len = min(len(sig1), len(sig2))
            sig1 = sig1[:min_len]
            sig2 = sig2[:min_len]

        # Count matching positions
        matches = sum(1 for a, b in zip(sig1, sig2) if a == b)

        return matches / len(sig1)

    def compute_combined_signature(self, title: str, content: str) -> List[int]:
        """
        Compute combined signature from title and content.

        Title shingles are weighted more heavily by including them twice.

        Args:
            title: Story title
            content: Story content or summary

        Returns:
            MinHash signature
        """
        # Get shingles from both
        title_shingles = self._get_shingles(title)
        content_shingles = self._get_shingles(content) if content else set()

        # Combine with title duplicated for weighting
        combined_shingles = title_shingles | title_shingles | content_shingles

        if not combined_shingles:
            return [LARGE_PRIME] * self.num_hashes

        # Compute signature on combined shingles
        signature = []
        for seed in self.seeds:
            min_hash = LARGE_PRIME
            for shingle in combined_shingles:
                h = self._hash_shingle(shingle, seed)
                if h < min_hash:
                    min_hash = h
            signature.append(min_hash)

        return signature


# Global singleton
_minhash_generator: MinHashGenerator = None


def get_minhash_generator() -> MinHashGenerator:
    """Get the global MinHashGenerator singleton."""
    global _minhash_generator
    if _minhash_generator is None:
        _minhash_generator = MinHashGenerator()
    return _minhash_generator
