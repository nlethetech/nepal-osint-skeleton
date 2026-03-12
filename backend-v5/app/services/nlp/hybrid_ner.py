"""
Hybrid Named Entity Recognition for Nepal OSINT.

Combines transformer-based NER with rule-based Nepal-specific entity matching.
This approach ensures:
- High recall via transformer NER for general entities
- High precision via rule-based matching for known Nepal entities
- Database-driven extraction for maximum coverage (6,600+ patterns)
"""

import logging
from typing import Any, Dict, List, Optional, Set, TYPE_CHECKING

from .transformer_ner import TransformerNER, get_transformer_ner
from .nepali_preprocessor import NepaliPreprocessor

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from .database_entity_extractor import DatabaseEntityExtractor

logger = logging.getLogger(__name__)


# Extended Nepal entity aliases - comprehensive political/organizational entities
NEPAL_ENTITY_ALIASES_EXTENDED = {
    # === POLITICAL FIGURES ===

    # KP Sharma Oli (Former PM, UML Chair)
    "ओली": ("oli", "PERSON"),
    "केपी ओली": ("oli", "PERSON"),
    "के.पी. ओली": ("oli", "PERSON"),
    "केपी शर्मा ओली": ("oli", "PERSON"),
    "oli": ("oli", "PERSON"),
    "kp oli": ("oli", "PERSON"),
    "k.p. oli": ("oli", "PERSON"),

    # Pushpa Kamal Dahal (Prachanda)
    "प्रचण्ड": ("prachanda", "PERSON"),
    "पुष्पकमल दाहाल": ("prachanda", "PERSON"),
    "दाहाल": ("prachanda", "PERSON"),
    "prachanda": ("prachanda", "PERSON"),
    "dahal": ("prachanda", "PERSON"),

    # Sher Bahadur Deuba
    "देउवा": ("deuba", "PERSON"),
    "शेरबहादुर देउवा": ("deuba", "PERSON"),
    "शेर बहादुर देउवा": ("deuba", "PERSON"),
    "deuba": ("deuba", "PERSON"),
    "sher bahadur deuba": ("deuba", "PERSON"),

    # Sushila Karki (PM/CJ)
    "कार्की": ("karki", "PERSON"),
    "सुशिला कार्की": ("karki", "PERSON"),
    "प्रधानमन्त्री कार्की": ("karki", "PERSON"),
    "karki": ("karki", "PERSON"),
    "sushila karki": ("karki", "PERSON"),
    "pm karki": ("karki", "PERSON"),

    # Baburam Bhattarai
    "भट्टराई": ("bhattarai", "PERSON"),
    "बाबुराम भट्टराई": ("bhattarai", "PERSON"),
    "बाबुराम": ("bhattarai", "PERSON"),
    "bhattarai": ("bhattarai", "PERSON"),
    "baburam bhattarai": ("bhattarai", "PERSON"),

    # Madhav Kumar Nepal
    "माधव नेपाल": ("madhav_nepal", "PERSON"),
    "माधवकुमार नेपाल": ("madhav_nepal", "PERSON"),
    "madhav nepal": ("madhav_nepal", "PERSON"),
    "madhav kumar nepal": ("madhav_nepal", "PERSON"),

    # Upendra Yadav
    "उपेन्द्र यादव": ("upendra_yadav", "PERSON"),
    "upendra yadav": ("upendra_yadav", "PERSON"),

    # Rabi Lamichhane
    "रवि लामिछाने": ("lamichhane", "PERSON"),
    "लामिछाने": ("lamichhane", "PERSON"),
    "lamichhane": ("lamichhane", "PERSON"),
    "rabi lamichhane": ("lamichhane", "PERSON"),

    # Gagan Thapa
    "गगन थापा": ("gagan_thapa", "PERSON"),
    "gagan thapa": ("gagan_thapa", "PERSON"),

    # Balen Shah (Mayor)
    "बालेन": ("balen", "PERSON"),
    "बालेन शाह": ("balen", "PERSON"),
    "balen": ("balen", "PERSON"),
    "balen shah": ("balen", "PERSON"),

    # Ram Chandra Poudel (President)
    "रामचन्द्र पौडेल": ("rc_poudel", "PERSON"),
    "पौडेल": ("rc_poudel", "PERSON"),
    "राष्ट्रपति पौडेल": ("rc_poudel", "PERSON"),
    "poudel": ("rc_poudel", "PERSON"),
    "ram chandra poudel": ("rc_poudel", "PERSON"),

    # Bidya Devi Bhandari (Former President)
    "विद्यादेवी भण्डारी": ("bhandari", "PERSON"),
    "भण्डारी": ("bhandari", "PERSON"),
    "bhandari": ("bhandari", "PERSON"),
    "bidya devi bhandari": ("bhandari", "PERSON"),

    # Additional political figures
    "नारायणकाजी श्रेष्ठ": ("narayan_kaji_shrestha", "PERSON"),
    "narayan kaji shrestha": ("narayan_kaji_shrestha", "PERSON"),
    "बर्षमान पुन": ("barshaman_pun", "PERSON"),
    "barshaman pun": ("barshaman_pun", "PERSON"),
    "राजेन्द्र राई": ("rajendra_rai", "PERSON"),
    "सर्वेन्द्रनाथ शुक्ला": ("sarvendranath_shukla", "PERSON"),
    "सूर्यबहादुर थापा": ("surya_bahadur_thapa", "PERSON"),
    "कृष्णप्रसाद भट्टराई": ("krishna_prasad_bhattarai", "PERSON"),
    "गिरिजाप्रसाद कोइराला": ("girija_prasad_koirala", "PERSON"),
    "विष्णुप्रसाद श्रेष्ठ": ("bishnu_prasad_shrestha", "PERSON"),
    "दिनेश थपलिया": ("dinesh_thapaliya", "PERSON"),

    # === ORGANIZATIONS ===

    # Nepal Rastra Bank
    "नेपाल राष्ट्र बैंक": ("nepal_rastra_bank", "ORGANIZATION"),
    "nepal rastra bank": ("nepal_rastra_bank", "ORGANIZATION"),
    "nrb": ("nepal_rastra_bank", "ORGANIZATION"),

    # Election Commission
    "निर्वाचन आयोग": ("election_commission", "ORGANIZATION"),
    "election commission": ("election_commission", "ORGANIZATION"),
    "ecn": ("election_commission", "ORGANIZATION"),

    # CIAA (Anti-Corruption)
    "अख्तियार": ("ciaa", "ORGANIZATION"),
    "ciaa": ("ciaa", "ORGANIZATION"),

    # Political parties
    "नेपाली कांग्रेस": ("nepali_congress", "ORGANIZATION"),
    "nepali congress": ("nepali_congress", "ORGANIZATION"),
    "कांग्रेस": ("nepali_congress", "ORGANIZATION"),

    "नेकपा एमाले": ("cpn_uml", "ORGANIZATION"),
    "cpn-uml": ("cpn_uml", "ORGANIZATION"),
    "uml": ("cpn_uml", "ORGANIZATION"),
    "एमाले": ("cpn_uml", "ORGANIZATION"),

    "नेकपा माओवादी केन्द्र": ("cpn_maoist", "ORGANIZATION"),
    "माओवादी केन्द्र": ("cpn_maoist", "ORGANIZATION"),
    "cpn maoist": ("cpn_maoist", "ORGANIZATION"),
    "maoist centre": ("cpn_maoist", "ORGANIZATION"),

    "राष्ट्रिय स्वतन्त्र पार्टी": ("rsp", "ORGANIZATION"),
    "rastriya swatantra party": ("rsp", "ORGANIZATION"),
    "rsp": ("rsp", "ORGANIZATION"),

    "जनता समाजवादी पार्टी": ("jsp", "ORGANIZATION"),
    "janata samajwadi party": ("jsp", "ORGANIZATION"),
    "jsp": ("jsp", "ORGANIZATION"),

    "नेकपा एकीकृत समाजवादी": ("cpn_us", "ORGANIZATION"),
    "cpn unified socialist": ("cpn_us", "ORGANIZATION"),

    # Security forces
    "नेपाल प्रहरी": ("nepal_police", "ORGANIZATION"),
    "nepal police": ("nepal_police", "ORGANIZATION"),

    "सशस्त्र प्रहरी": ("apf", "ORGANIZATION"),
    "armed police force": ("apf", "ORGANIZATION"),
    "apf": ("apf", "ORGANIZATION"),

    "नेपाली सेना": ("nepal_army", "ORGANIZATION"),
    "nepal army": ("nepal_army", "ORGANIZATION"),

    # Courts
    "सर्वोच्च अदालत": ("supreme_court", "ORGANIZATION"),
    "supreme court": ("supreme_court", "ORGANIZATION"),

    # Parliament
    "प्रतिनिधि सभा": ("house_of_representatives", "ORGANIZATION"),
    "house of representatives": ("house_of_representatives", "ORGANIZATION"),
    "संसद": ("parliament", "ORGANIZATION"),
    "parliament": ("parliament", "ORGANIZATION"),
    "राष्ट्रिय सभा": ("national_assembly", "ORGANIZATION"),
    "national assembly": ("national_assembly", "ORGANIZATION"),

    # === ADDITIONAL ORGANIZATIONS (from real news analysis) ===

    # Financial
    "नेप्से": ("nepse", "ORGANIZATION"),
    "nepse": ("nepse", "ORGANIZATION"),
    "शेयर बजार": ("stock_market", "ORGANIZATION"),
    "stock market": ("stock_market", "ORGANIZATION"),

    # Sports organizations
    "साफ": ("saff", "ORGANIZATION"),
    "saff": ("saff", "ORGANIZATION"),
    "एन्फा": ("anfa", "ORGANIZATION"),
    "anfa": ("anfa", "ORGANIZATION"),
    "क्यान": ("can", "ORGANIZATION"),
    "can": ("can", "ORGANIZATION"),

    # Government ministries
    "गृह मन्त्रालय": ("home_ministry", "ORGANIZATION"),
    "home ministry": ("home_ministry", "ORGANIZATION"),
    "अर्थ मन्त्रालय": ("finance_ministry", "ORGANIZATION"),
    "finance ministry": ("finance_ministry", "ORGANIZATION"),
    "परराष्ट्र मन्त्रालय": ("foreign_ministry", "ORGANIZATION"),
    "foreign ministry": ("foreign_ministry", "ORGANIZATION"),
    "मौसम विभाग": ("weather_department", "ORGANIZATION"),
    "weather department": ("weather_department", "ORGANIZATION"),

    # Media
    "नेपाल टेलिभिजन": ("nepal_television", "ORGANIZATION"),
    "nepal television": ("nepal_television", "ORGANIZATION"),
    "रेडियो नेपाल": ("radio_nepal", "ORGANIZATION"),
    "radio nepal": ("radio_nepal", "ORGANIZATION"),

    # International (frequently mentioned)
    "भारत": ("india", "LOCATION"),
    "india": ("india", "LOCATION"),
    "चीन": ("china", "LOCATION"),
    "china": ("china", "LOCATION"),
    "अमेरिका": ("usa", "LOCATION"),
    "पाकिस्तान": ("pakistan", "LOCATION"),
    "बंगलादेश": ("bangladesh", "LOCATION"),
    "भुटान": ("bhutan", "LOCATION"),
    "bhutan": ("bhutan", "LOCATION"),

    # Rivers (for disaster news)
    "नारायणी नदी": ("narayani_river", "LOCATION"),
    "narayani river": ("narayani_river", "LOCATION"),
    "कोशी नदी": ("koshi_river", "LOCATION"),
    "koshi river": ("koshi_river", "LOCATION"),
    "गण्डकी नदी": ("gandaki_river", "LOCATION"),
    "बागमती नदी": ("bagmati_river", "LOCATION"),
}

# Nepal districts (for location extraction)
NEPAL_DISTRICTS = {
    # Province 1
    "taplejung", "panchthar", "ilam", "jhapa", "morang", "sunsari", "dhankuta",
    "terhathum", "sankhuwasabha", "bhojpur", "solukhumbu", "okhaldhunga",
    "khotang", "udayapur",
    # Madhesh Province
    "saptari", "siraha", "dhanusa", "dhanusha", "mahottari", "sarlahi", "rautahat",
    "bara", "parsa",
    # Bagmati Province
    "dolakha", "sindhupalchok", "sindhupalchowk", "rasuwa", "dhading", "nuwakot",
    "kathmandu", "bhaktapur", "lalitpur", "kavrepalanchok", "kavre", "ramechhap",
    "sindhuli", "makwanpur", "chitwan",
    # Gandaki Province
    "gorkha", "lamjung", "tanahu", "tanahun", "kaski", "manang", "mustang",
    "myagdi", "parbat", "baglung", "syangja", "nawalpur", "nawalparasi",
    # Lumbini Province
    "rupandehi", "kapilvastu", "arghakhanchi", "gulmi", "palpa", "dang",
    "pyuthan", "rolpa", "rukum", "banke", "bardiya",
    # Karnali Province
    "dolpa", "mugu", "humla", "jumla", "kalikot", "dailekh", "jajarkot",
    "salyan", "surkhet",
    # Sudurpashchim Province
    "bajura", "bajhang", "achham", "doti", "kailali", "kanchanpur", "dadeldhura",
    "baitadi", "darchula",
}

# Nepal cities
NEPAL_CITIES = {
    "kathmandu", "pokhara", "lalitpur", "patan", "bhaktapur", "biratnagar",
    "birgunj", "bharatpur", "dharan", "butwal", "hetauda", "nepalgunj",
    "janakpur", "dhangadhi", "itahari", "tulsipur", "damak", "rajbiraj",
    "ghorahi", "mechinagar", "birtamod", "tikapur",
}

# Nepali location names (Devanagari)
NEPAL_LOCATIONS_NE = {
    "काठमाडौं", "काठमाण्डौ", "पोखरा", "ललितपुर", "पाटन",
    "भक्तपुर", "विराटनगर", "वीरगञ्ज", "भरतपुर", "धरान",
    "बुटवल", "हेटौंडा", "नेपालगञ्ज", "जनकपुर", "धनगढी",
    "इटहरी", "तुलसीपुर", "दमक", "राजविराज", "घोराही",
    "बागमती", "गण्डकी", "लुम्बिनी", "कर्णाली", "सुदूरपश्चिम",
    "मधेस", "कोशी", "प्रदेश",
}


class HybridNER:
    """
    Combines transformer NER with rule-based Nepal-specific entity matching.

    Strategy:
    1. Run transformer NER for general entities (people, orgs, locations)
    2. Run rule-based matching for Nepal-specific entities (politicians, districts)
    3. Merge results, preferring rule-based for known entities (higher precision)

    Benefits:
    - High recall: Transformer catches unknown entities
    - High precision: Rule-based ensures correct canonicalization for known entities
    - Nepal-specific: Handles Nepali politicians, parties, districts correctly
    """

    def __init__(
        self,
        use_transformer: bool = True,
        transformer_model: str = "xlm-roberta-ner",
        confidence_threshold: float = 0.5,
    ):
        """
        Initialize hybrid NER.

        Args:
            use_transformer: Whether to use transformer NER (can be disabled for speed)
            transformer_model: Which transformer model to use
            confidence_threshold: Minimum confidence for transformer entities
        """
        self.use_transformer = use_transformer
        self.confidence_threshold = confidence_threshold

        # Lazy-load transformer NER
        self._transformer_ner: Optional[TransformerNER] = None
        self._transformer_model = transformer_model

        # Preprocessor for language detection and normalization
        self.preprocessor = NepaliPreprocessor()

        # Pre-compile patterns for efficiency
        self._entity_patterns = self._compile_entity_patterns()
        self._district_set = {d.lower() for d in NEPAL_DISTRICTS}
        self._city_set = {c.lower() for c in NEPAL_CITIES}

    def _compile_entity_patterns(self) -> Dict[str, tuple]:
        """Pre-compile entity patterns for efficiency."""
        import re

        patterns = {}
        for alias, (canonical, etype) in NEPAL_ENTITY_ALIASES_EXTENDED.items():
            # Determine if Devanagari
            is_devanagari = any('\u0900' <= c <= '\u097F' for c in alias)

            if is_devanagari:
                # Direct substring for Devanagari
                patterns[alias] = (canonical, etype, None, True)
            else:
                # Compile regex for English (word boundary)
                pattern = re.compile(rf"\b{re.escape(alias)}\b", re.IGNORECASE)
                patterns[alias] = (canonical, etype, pattern, False)

        return patterns

    @property
    def transformer_ner(self) -> Optional[TransformerNER]:
        """Lazy-load transformer NER."""
        if self._transformer_ner is None and self.use_transformer:
            try:
                self._transformer_ner = get_transformer_ner(self._transformer_model)
            except Exception as e:
                logger.warning(f"Failed to load transformer NER: {e}")
                self._transformer_ner = None
        return self._transformer_ner

    def extract_entities(self, text: str) -> List[Dict[str, Any]]:
        """
        Extract entities using hybrid approach.

        Args:
            text: Input text (English or Nepali)

        Returns:
            List of entity dicts with:
            - text: Entity text
            - type: PERSON, ORGANIZATION, LOCATION, OTHER
            - canonical_id: Canonical ID for known entities
            - confidence: Confidence score (0.95 for rule-based, model score for transformer)
            - source: "rule_based" or "transformer"
        """
        if not text or len(text.strip()) < 3:
            return []

        # 1. Rule-based Nepal entities (high precision)
        rule_entities = self._extract_rule_based_entities(text)

        # 2. Transformer NER (high recall)
        transformer_entities = []
        if self.use_transformer and self.transformer_ner is not None:
            try:
                transformer_entities = self.transformer_ner.extract_entities(text)
            except Exception as e:
                logger.warning(f"Transformer NER failed: {e}")

        # 3. Merge with deduplication (rule-based takes precedence)
        merged = self._merge_entities(rule_entities, transformer_entities)

        return merged

    def _extract_rule_based_entities(self, text: str) -> List[Dict[str, Any]]:
        """Extract Nepal-specific entities using rule-based matching."""
        entities = []
        text_lower = text.lower()

        # Check compiled patterns
        seen_canonicals: Set[str] = set()

        for alias, (canonical, etype, pattern, is_devanagari) in self._entity_patterns.items():
            # Skip if we already found this canonical entity
            if canonical in seen_canonicals:
                continue

            found = False
            if is_devanagari:
                # Direct substring for Devanagari
                if alias in text:
                    found = True
            else:
                # Regex for English
                if pattern and pattern.search(text_lower):
                    found = True

            if found:
                entities.append({
                    "text": alias,
                    "type": etype,
                    "canonical_id": canonical,
                    "confidence": 0.95,  # High confidence for known entities
                    "source": "rule_based",
                })
                seen_canonicals.add(canonical)

        # Extract districts and cities as LOCATION entities
        district_entities = self._extract_nepal_locations(text)
        entities.extend(district_entities)

        return entities

    def _extract_nepal_locations(self, text: str) -> List[Dict[str, Any]]:
        """Extract Nepal districts and cities as LOCATION entities."""
        import re

        entities = []
        text_lower = text.lower()
        seen_locations: Set[str] = set()

        # Check English districts
        for district in self._district_set:
            if district in seen_locations:
                continue
            pattern = rf"\b{re.escape(district)}\b"
            if re.search(pattern, text_lower):
                entities.append({
                    "text": district,
                    "type": "LOCATION",
                    "canonical_id": district,
                    "confidence": 0.95,
                    "source": "rule_based",
                })
                seen_locations.add(district)

        # Check English cities
        for city in self._city_set:
            if city in seen_locations:
                continue
            pattern = rf"\b{re.escape(city)}\b"
            if re.search(pattern, text_lower):
                entities.append({
                    "text": city,
                    "type": "LOCATION",
                    "canonical_id": city,
                    "confidence": 0.95,
                    "source": "rule_based",
                })
                seen_locations.add(city)

        # Check Nepali locations (substring match)
        for location in NEPAL_LOCATIONS_NE:
            if location in text:
                # Normalize to canonical form
                canonical = location.lower() if not any('\u0900' <= c <= '\u097F' for c in location) else location
                if canonical not in seen_locations:
                    entities.append({
                        "text": location,
                        "type": "LOCATION",
                        "canonical_id": canonical,
                        "confidence": 0.95,
                        "source": "rule_based",
                    })
                    seen_locations.add(canonical)

        return entities

    def _merge_entities(
        self,
        rule_entities: List[Dict[str, Any]],
        transformer_entities: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Merge entities from both sources.

        Rule-based takes precedence for overlapping mentions.
        """
        # Build index of rule-based entities by text (lowercased)
        rule_texts: Set[str] = set()
        for ent in rule_entities:
            text = ent.get("text", "").lower()
            rule_texts.add(text)
            # Also add canonical ID
            if "canonical_id" in ent:
                rule_texts.add(ent["canonical_id"].lower())

        # Start with rule-based entities
        merged = list(rule_entities)

        # Add transformer entities that don't overlap
        for ent in transformer_entities:
            text_lower = ent.get("text", "").lower()

            # Skip if overlaps with rule-based
            if text_lower in rule_texts:
                continue

            # Skip low-confidence entities
            if ent.get("confidence", 0) < self.confidence_threshold:
                continue

            # Add transformer entity
            ent["source"] = "transformer"
            merged.append(ent)

        return merged

    def extract_people(self, text: str) -> List[Dict[str, Any]]:
        """Extract just person entities from text."""
        entities = self.extract_entities(text)
        return [e for e in entities if e.get("type") == "PERSON"]

    def extract_organizations(self, text: str) -> List[Dict[str, Any]]:
        """Extract just organization entities from text."""
        entities = self.extract_entities(text)
        return [e for e in entities if e.get("type") == "ORGANIZATION"]

    def extract_locations(self, text: str) -> List[Dict[str, Any]]:
        """Extract just location entities from text."""
        entities = self.extract_entities(text)
        return [e for e in entities if e.get("type") == "LOCATION"]

    def get_entity_summary(self, text: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        Get summary of all entities by type.

        Returns:
            Dict mapping entity types to lists of entity dicts
        """
        entities = self.extract_entities(text)

        summary: Dict[str, List[Dict[str, Any]]] = {
            "PERSON": [],
            "ORGANIZATION": [],
            "LOCATION": [],
            "OTHER": [],
        }

        for ent in entities:
            etype = ent.get("type", "OTHER")
            if etype in summary:
                summary[etype].append(ent)

        return summary

    def get_canonical_entities(self, text: str) -> Dict[str, str]:
        """
        Get mapping of canonical entity IDs to their types.

        Useful for entity-based blocking in clustering.

        Returns:
            Dict mapping canonical_id to entity type
        """
        entities = self.extract_entities(text)
        result = {}

        for ent in entities:
            canonical = ent.get("canonical_id")
            if canonical:
                result[canonical] = ent.get("type", "OTHER")

        return result


# Singleton instance
_hybrid_ner: Optional[HybridNER] = None


def get_hybrid_ner(
    use_transformer: bool = True,
    transformer_model: str = "xlm-roberta-ner",
) -> HybridNER:
    """
    Get singleton hybrid NER instance.

    Args:
        use_transformer: Whether to use transformer NER
        transformer_model: Which transformer model to use

    Returns:
        HybridNER instance
    """
    global _hybrid_ner
    if _hybrid_ner is None:
        _hybrid_ner = HybridNER(
            use_transformer=use_transformer,
            transformer_model=transformer_model,
        )
    return _hybrid_ner


class DatabaseHybridNER:
    """
    Enhanced Hybrid NER using database-driven entity extraction.

    Priority order:
    1. DatabaseEntityExtractor (6,600+ patterns from election/parliament DB)
    2. Rule-based matching for Nepal-specific entities
    3. Transformer NER for unknown entities
    """

    def __init__(self):
        self._db_extractor: Optional["DatabaseEntityExtractor"] = None
        self._rule_based_ner = HybridNER(use_transformer=False)  # Rule-based only
        self._transformer_ner: Optional[TransformerNER] = None
        self._initialized = False

    async def initialize(self, session: "AsyncSession"):
        """
        Initialize database-driven entity extractor.

        Args:
            session: Database session for loading patterns
        """
        if self._initialized:
            return

        from .database_entity_extractor import DatabaseEntityExtractor

        self._db_extractor = DatabaseEntityExtractor()
        await self._db_extractor.initialize(session)
        self._initialized = True
        logger.info("DatabaseHybridNER initialized")

    @property
    def is_initialized(self) -> bool:
        """Check if database extractor is initialized."""
        return self._initialized

    async def extract_entities(
        self,
        text: str,
        session: Optional["AsyncSession"] = None,
        min_confidence: float = 0.5,
    ) -> List[Dict[str, Any]]:
        """
        Extract entities using hybrid approach with database patterns.

        Priority:
        1. Database patterns (high confidence, canonical IDs)
        2. Rule-based patterns (Nepal-specific)
        3. Transformer NER (for unknown entities)

        Args:
            text: Input text (English or Nepali)
            session: Database session for disambiguation
            min_confidence: Minimum confidence threshold

        Returns:
            List of entity dicts
        """
        if not text or len(text.strip()) < 3:
            return []

        entities = []
        used_spans: Set[tuple] = set()

        # 1. Database-driven extraction (highest priority)
        if self._initialized and self._db_extractor:
            try:
                db_entities = await self._db_extractor.extract(
                    text, min_confidence=min_confidence, session=session
                )
                for ent in db_entities:
                    entity_dict = ent.to_dict()
                    entities.append(entity_dict)
                    used_spans.add((ent.start, ent.end))
            except Exception as e:
                logger.warning(f"Database entity extraction failed: {e}")

        # 2. Rule-based extraction (fallback for gaps)
        rule_entities = self._rule_based_ner.extract_entities(text)
        for ent in rule_entities:
            # Check if overlaps with database entity
            overlaps = False
            ent_text = ent.get("text", "")
            for db_ent in entities:
                if db_ent.get("text", "").lower() == ent_text.lower():
                    overlaps = True
                    break
                if db_ent.get("canonical_id", "") == ent.get("canonical_id", ""):
                    overlaps = True
                    break
            if not overlaps:
                ent["source"] = "rule_based"
                entities.append(ent)

        # 3. Transformer NER (for remaining gaps) - disabled by default for speed
        # Can be enabled if higher recall is needed

        return entities

    def extract_entities_sync(
        self,
        text: str,
        min_confidence: float = 0.5,
    ) -> List[Dict[str, Any]]:
        """
        Synchronous entity extraction (no database lookups).

        Uses database patterns if initialized, otherwise rule-based.

        Args:
            text: Input text
            min_confidence: Minimum confidence threshold

        Returns:
            List of entity dicts
        """
        if not text or len(text.strip()) < 3:
            return []

        entities = []

        # Use database extractor sync method if available
        if self._initialized and self._db_extractor:
            try:
                db_entities = self._db_extractor.extract_sync(text, min_confidence)
                for ent in db_entities:
                    entities.append(ent.to_dict())
            except Exception as e:
                logger.warning(f"Database sync extraction failed: {e}")

        # Fallback to rule-based
        if not entities:
            entities = self._rule_based_ner.extract_entities(text)

        return entities

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the NER system."""
        stats = {
            "initialized": self._initialized,
            "rule_based_patterns": len(NEPAL_ENTITY_ALIASES_EXTENDED),
        }

        if self._db_extractor:
            stats.update(self._db_extractor.get_stats())

        return stats


# Singleton instance for database-driven NER
_db_hybrid_ner: Optional[DatabaseHybridNER] = None


def get_database_hybrid_ner() -> DatabaseHybridNER:
    """Get or create singleton DatabaseHybridNER instance."""
    global _db_hybrid_ner
    if _db_hybrid_ner is None:
        _db_hybrid_ner = DatabaseHybridNER()
    return _db_hybrid_ner


async def initialize_database_ner(session: "AsyncSession") -> DatabaseHybridNER:
    """Initialize the database-driven NER system."""
    ner = get_database_hybrid_ner()
    await ner.initialize(session)
    return ner
