"""Feature extractor for story clustering."""
import re
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

from app.services.clustering.minhash import get_minhash_generator

logger = logging.getLogger(__name__)

# Nepal districts (77 total)
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
    "rukum west", "salyan", "surkhet",
    # Sudurpashchim Province
    "bajura", "bajhang", "achham", "doti", "kailali", "kanchanpur", "dadeldhura",
    "baitadi", "darchula",
}

# Major cities and towns (for title extraction)
NEPAL_CITIES = {
    "kathmandu", "pokhara", "lalitpur", "patan", "bhaktapur", "biratnagar",
    "birgunj", "bharatpur", "dharan", "butwal", "hetauda", "nepalgunj",
    "janakpur", "dhangadhi", "itahari", "tulsipur", "siddharthanagar",
    "damak", "rajbiraj", "ghorahi", "mechinagar", "birtamod", "tikapur",
}

# Nepal locations in Nepali (Devanagari) - for Nepali text detection
NEPAL_LOCATIONS_NE = {
    # Major cities
    "काठमाडौं", "काठमाण्डौ", "काठमाण्डू", "पोखरा", "ललितपुर", "पाटन",
    "भक्तपुर", "विराटनगर", "वीरगञ्ज", "बिरगंज", "भरतपुर", "धरान",
    "बुटवल", "हेटौंडा", "हेटौडा", "नेपालगञ्ज", "जनकपुर", "धनगढी",
    "इटहरी", "तुलसीपुर", "दमक", "राजविराज", "घोराही", "बिर्तामोड",
    # Districts
    "काभ्रे", "कावरे", "काभ्रेपलान्चोक", "सिन्धुपाल्चोक", "सिन्धुपालचोक",
    "डोलखा", "गोरखा", "लमजुङ", "तनहुँ", "कास्की", "मनाङ", "मुस्ताङ",
    "म्याग्दी", "पर्वत", "बागलुङ", "स्याङ्जा", "पाल्पा", "गुल्मी",
    "रुपन्देही", "कपिलवस्तु", "नवलपरासी", "नवलपुर", "चितवन",
    "मकवानपुर", "सिन्धुली", "रामेछाप", "ओखलढुङ्गा", "खोटाङ",
    "भोजपुर", "संखुवासभा", "सोलुखुम्बु", "धनकुटा", "तेह्रथुम",
    "पाँचथर", "ताप्लेजुङ", "इलाम", "झापा", "मोरङ", "सुनसरी",
    "सप्तरी", "सिराहा", "धनुषा", "महोत्तरी", "सर्लाही", "रौतहट",
    "बारा", "पर्सा", "दाङ", "बाँके", "बर्दिया", "सुर्खेत", "दैलेख",
    "जाजरकोट", "रुकुम", "रोल्पा", "प्युठान", "सल्यान", "डोल्पा",
    "जुम्ला", "मुगु", "हुम्ला", "कालिकोट", "अछाम", "बाजुरा",
    "बझाङ", "डोटी", "कैलाली", "कञ्चनपुर", "दडेलधुरा", "बैतडी", "दार्चुला",
    # Provinces
    "प्रदेश", "बागमती", "गण्डकी", "लुम्बिनी", "कर्णाली", "सुदूरपश्चिम", "मधेस", "कोशी",
}

# Federal parliament constituencies (some examples - expand as needed)
NEPAL_CONSTITUENCIES = {
    "kathmandu-1", "kathmandu-2", "kathmandu-3", "kathmandu-4", "kathmandu-5",
    "kathmandu-6", "kathmandu-7", "kathmandu-8", "kathmandu-9", "kathmandu-10",
    "lalitpur-1", "lalitpur-2", "lalitpur-3",
    "bhaktapur-1", "bhaktapur-2",
    "kaski-1", "kaski-2",
    "morang-1", "morang-2", "morang-3", "morang-4", "morang-5", "morang-6",
    "jhapa-1", "jhapa-2", "jhapa-3", "jhapa-4",
}

# Stop words for term extraction
STOP_WORDS = {
    "the", "and", "for", "with", "from", "that", "this", "have", "has",
    "been", "will", "would", "could", "should", "about", "after", "before",
    "into", "over", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "which", "while", "during", "through",
    "between", "both", "each", "other", "some", "such", "more", "most",
    "very", "just", "also", "only", "even", "back", "being", "their",
    "them", "they", "what", "says", "said", "nepal", "nepali", "nepalese",
    "news", "report", "reports", "reported", "according", "today", "year",
    "years", "time", "people", "government", "minister", "party",
}

# International countries/locations (for blocking international stories from clustering together)
INTERNATIONAL_COUNTRIES = {
    # English names
    "ukraine", "russia", "russian", "indonesia", "india", "indian", "china", "chinese",
    "pakistan", "pakistani", "bangladesh", "bangladeshi", "usa", "america", "american",
    "britain", "british", "uk", "england", "germany", "german", "france", "french",
    "japan", "japanese", "korea", "korean", "australia", "australian",
    "iran", "iranian", "iraq", "iraqi", "israel", "israeli", "palestine", "palestinian",
    "syria", "syrian", "afghanistan", "afghan", "myanmar", "turkey", "turkish",
    "saudi", "arabia", "dubai", "uae", "qatar", "egypt", "egyptian",
    "brazil", "brazilian", "mexico", "mexican", "canada", "canadian",
    "thailand", "thai", "vietnam", "vietnamese", "philippines", "filipino",
    "sri lanka", "sri lankan", "bhutan", "bhutanese", "tibet", "tibetan",
    # Nepali names
    "युक्रेन", "रुस", "रूस", "रूसी", "रसिया", "इन्डोनेसिया", "भारत", "भारतीय",
    "चीन", "चिनियाँ", "पाकिस्तान", "पाकिस्तानी", "बंगलादेश", "अमेरिका", "अमेरिकी",
    "बेलायत", "जर्मनी", "फ्रान्स", "जापान", "जापानी", "कोरिया", "अष्ट्रेलिया",
    "इरान", "इराक", "इजरायल", "इजराइल", "प्यालेस्टाइन", "सिरिया", "अफगानिस्तान",
    "म्यानमार", "टर्की", "साउदी", "अरब", "दुबई", "मिश्र", "थाइल्यान्ड", "भियतनाम",
    "श्रीलंका", "भुटान", "तिब्बत",
}

# Major international cities
INTERNATIONAL_CITIES = {
    "delhi", "mumbai", "new delhi", "kolkata", "chennai", "bangalore",
    "beijing", "shanghai", "hong kong", "tokyo", "seoul", "sydney",
    "london", "paris", "berlin", "moscow", "kiev", "kyiv", "jakarta",
    "dhaka", "islamabad", "karachi", "lahore", "kabul", "tehran",
    "bangkok", "singapore", "dubai", "doha", "riyadh", "cairo",
    # Nepali
    "दिल्ली", "मुम्बई", "कोलकाता", "बेइजिङ", "टोकियो", "लण्डन", "मस्को",
}


@dataclass
class StoryFeatures:
    """Extracted features for a story used in clustering."""

    story_id: Optional[str] = None

    # MinHash signature for content similarity
    content_minhash: List[int] = field(default_factory=list)

    # Tokenized title
    title_tokens: List[str] = field(default_factory=list)

    # Geographic entities (Nepal)
    districts: List[str] = field(default_factory=list)
    constituencies: List[str] = field(default_factory=list)

    # International locations (for blocking)
    international_countries: List[str] = field(default_factory=list)
    title_country: Optional[str] = None  # Primary country in title

    # Title-specific district (for hard blocking)
    title_district: Optional[str] = None

    # Key terms (names, organizations, etc.)
    key_terms: List[str] = field(default_factory=list)

    # Topic classification for hard blocking (different topics = NEVER cluster)
    topic: Optional[str] = None  # election, weather, sports, stock, etc.

    # Named entities in title - CRITICAL for blocking (different people = NEVER cluster)
    title_entities: List[str] = field(default_factory=list)  # e.g., ["ओली"], ["कार्की"]

    # Primary action/event type in title (different actions = different events)
    title_action: Optional[str] = None  # e.g., "clarification", "meeting"


# Topic keywords for hard blocking - stories with different topics should NEVER cluster
TOPIC_KEYWORDS = {
    "election": [
        "निर्वाचन", "मतदान", "चुनाव", "मत", "उम्मेदवार", "मतदाता", "मतदानस्थल",
        "election", "vote", "voting", "ballot", "candidate", "constituency",
        "प्रतिनिधिसभा", "प्रदेशसभा", "राष्ट्रियसभा", "घोषणापत्र",
    ],
    "weather": [
        "मौसम", "वर्षा", "हिउँ", "तापक्रम", "पूर्वानुमान",
        "weather", "rain", "rainfall", "temperature", "forecast", "snow",
        "हिउँदे वर्षा", "ग्रीष्मकालीन", "मनसुन",
    ],
    "sports": [
        "लिग", "लीग", "फुटबल", "क्रिकेट", "खेल", "खेलकुद", "टुर्नामेन्ट",
        "फाइनल", "सेमिफाइनल", "मच्छिन्द्र", "एन्फा", "भलिबल", "कराते",
        "league", "football", "cricket", "match", "tournament", "championship",
    ],
    "stock_market": [
        "नेप्से", "शेयर", "सेयर बजार", "कारोबार", "सूचकांक",
        "nepse", "stock", "share", "market index", "trading",
    ],
    "international_affairs": [
        "संयुक्त राष्ट्र", "सुरक्षा परिषद", "विदेश नीति", "कूटनीति",
        "united nations", "security council", "foreign policy", "diplomatic",
    ],
}

# Named entities for HARD BLOCKING - stories about different people should NEVER cluster
# Maps variations to canonical names for proper matching
NEPAL_ENTITY_ALIASES = {
    # KP Sharma Oli (Former PM, UML Chair)
    "ओली": "oli",
    "केपी ओली": "oli",
    "के.पी. ओली": "oli",
    "केपी शर्मा ओली": "oli",
    "ओलीले": "oli",
    "ओलीको": "oli",
    "ओलीका": "oli",
    "ओलीलाई": "oli",
    "केपी": "oli",
    "oli": "oli",
    "kp oli": "oli",
    "k.p. oli": "oli",
    # Pushpa Kamal Dahal (Prachanda)
    "प्रचण्ड": "prachanda",
    "पुष्पकमल दाहाल": "prachanda",
    "दाहाल": "prachanda",
    "प्रचण्डले": "prachanda",
    "प्रचण्डको": "prachanda",
    "prachanda": "prachanda",
    "dahal": "prachanda",
    # Sher Bahadur Deuba
    "देउवा": "deuba",
    "शेरबहादुर देउवा": "deuba",
    "शेर बहादुर देउवा": "deuba",
    "देउवाले": "deuba",
    "देउवाको": "deuba",
    "deuba": "deuba",
    # Sushila Karki (PM/CJ)
    "कार्की": "karki",
    "सुशिला कार्की": "karki",
    "कार्कीले": "karki",
    "कार्कीको": "karki",
    "कार्कीसँग": "karki",
    "प्रधानमन्त्री कार्की": "karki",
    "karki": "karki",
    "sushila karki": "karki",
    "pm karki": "karki",
    "prime minister karki": "karki",
    # Baburam Bhattarai
    "भट्टराई": "bhattarai",
    "बाबुराम भट्टराई": "bhattarai",
    "बाबुराम": "bhattarai",
    "bhattarai": "bhattarai",
    "baburam": "bhattarai",
    # Madhav Kumar Nepal
    "माधव नेपाल": "madhav_nepal",
    "माधवकुमार नेपाल": "madhav_nepal",
    "माधव कुमार नेपाल": "madhav_nepal",
    "माधवले": "madhav_nepal",
    "madhav nepal": "madhav_nepal",
    # Upendra Yadav
    "उपेन्द्र यादव": "upendra_yadav",
    "यादव": "upendra_yadav",  # Be careful - common surname
    "उपेन्द्रले": "upendra_yadav",
    "upendra yadav": "upendra_yadav",
    # Rabi Lamichhane
    "रवि लामिछाने": "lamichhane",
    "लामिछाने": "lamichhane",
    "रविले": "lamichhane",
    "लामिछानेले": "lamichhane",
    "lamichhane": "lamichhane",
    "rabi lamichhane": "lamichhane",
    # Gagan Thapa
    "गगन थापा": "gagan_thapa",
    "गगनले": "gagan_thapa",
    "थापा": "gagan_thapa",  # Context: political - usually Gagan
    "gagan thapa": "gagan_thapa",
    # Balen Shah (Mayor)
    "बालेन": "balen",
    "बालेन शाह": "balen",
    "balen": "balen",
    "balen shah": "balen",
    # Ram Chandra Poudel (President)
    "रामचन्द्र पौडेल": "rc_poudel",
    "पौडेल": "rc_poudel",
    "राष्ट्रपति पौडेल": "rc_poudel",
    "rc poudel": "rc_poudel",
    "poudel": "rc_poudel",
    # Bidya Devi Bhandari (Former President)
    "विद्यादेवी भण्डारी": "bhandari",
    "भण्डारी": "bhandari",
    "bhandari": "bhandari",
    # Diplomats/Ambassadors - these should cluster by country, not person
    "राजदूत": "_ambassador",  # Generic ambassador - pair with country
    "ambassador": "_ambassador",
}

# Event/Action verbs - different actions = different events = NEVER cluster
# Maps keywords to canonical action types
EVENT_ACTION_KEYWORDS = {
    # Meetings/Visits - diplomatic & political
    "भेट": "meeting",
    "भेटवार्ता": "meeting",
    "शिष्टाचार भेट": "courtesy_visit",
    "बैठक": "meeting",
    "भेटघाट": "meeting",
    "भेटेर": "meeting",
    "भेट्नु": "meeting",
    "भ्रमण": "visit",
    "visit": "visit",
    "meeting": "meeting",
    "met": "meeting",
    "meets": "meeting",
    # Statements/Clarifications
    "स्पष्टीकरण": "clarification",
    "स्पष्टीकरणमा": "clarification",
    "स्पष्ट": "clarification",
    "clarification": "clarification",
    "clarifies": "clarification",
    "प्रतिक्रिया": "reaction",
    "reaction": "reaction",
    "responds": "reaction",
    "टिप्पणी": "comment",
    "comment": "comment",
    "भाषण": "speech",
    "speech": "speech",
    "address": "speech",
    "घोषणा": "announcement",
    "announces": "announcement",
    "announcement": "announcement",
    # Legal/Political actions
    "पक्राउ": "arrest",
    "गिरफ्तार": "arrest",
    "arrest": "arrest",
    "arrested": "arrest",
    "मुद्दा": "case",
    "case": "case",
    "निर्णय": "decision",
    "decision": "decision",
    "विधेयक": "bill",
    "bill": "bill",
    "पारित": "passed",
    "passed": "passed",
    # Movement/Protest
    "प्रदर्शन": "protest",
    "आन्दोलन": "movement",
    "protest": "protest",
    "demonstration": "protest",
    "हडताल": "strike",
    "strike": "strike",
    "bandh": "strike",
    "बन्द": "strike",
    # Incidents
    "दुर्घटना": "accident",
    "accident": "accident",
    "crash": "accident",
    "हत्या": "murder",
    "murder": "murder",
    "killed": "death",
    "death": "death",
    "मृत्यु": "death",
    "आक्रमण": "attack",
    "attack": "attack",
    # Elections
    "उम्मेदवारी": "nomination",
    "nomination": "nomination",
    "मतदान": "voting",
    "voting": "voting",
    "विजयी": "victory",
    "जित": "victory",
    "wins": "victory",
    "won": "victory",
    # Resignations/Appointments
    "राजीनामा": "resignation",
    "resignation": "resignation",
    "resigns": "resignation",
    "नियुक्त": "appointment",
    "appointed": "appointment",
    "appointment": "appointment",
}


class FeatureExtractor:
    """
    Extracts clustering features from news stories.

    Features extracted:
    - MinHash signature (128 integers) for text similarity
    - Title tokens for matching
    - Districts and constituencies mentioned
    - Key terms (proper nouns, quoted phrases)
    """

    def __init__(self):
        """Initialize the feature extractor."""
        self.minhash = get_minhash_generator()
        self._districts_lower = {d.lower() for d in NEPAL_DISTRICTS}
        self._cities_lower = {c.lower() for c in NEPAL_CITIES}
        self._constituencies_lower = {c.lower() for c in NEPAL_CONSTITUENCIES}
        self._international_countries = {c.lower() for c in INTERNATIONAL_COUNTRIES}
        self._international_cities = {c.lower() for c in INTERNATIONAL_CITIES}
        # Nepali language Nepal locations (no case conversion needed)
        self._nepal_locations_ne = NEPAL_LOCATIONS_NE

    def extract(
        self,
        title: str,
        summary: Optional[str] = None,
        content: Optional[str] = None,
        story_id: Optional[str] = None,
    ) -> StoryFeatures:
        """
        Extract all features from a story.

        Args:
            title: Story title
            summary: Story summary
            content: Story content
            story_id: Optional story ID

        Returns:
            StoryFeatures dataclass
        """
        # Combine text for analysis
        full_text = f"{title} {summary or ''} {content or ''}".strip()
        text_lower = full_text.lower()

        # Extract features
        features = StoryFeatures(story_id=story_id)

        # MinHash signature
        features.content_minhash = self.minhash.compute_combined_signature(
            title, summary or content or ""
        )

        # Title tokens
        features.title_tokens = self._tokenize_title(title)

        # Geographic entities (Nepal)
        features.districts = self._extract_districts(text_lower)
        features.constituencies = self._extract_constituencies(text_lower)

        # Title-specific district (important for blocking)
        features.title_district = self._extract_title_district(title.lower())

        # International locations (for blocking international stories)
        features.international_countries = self._extract_international_countries(text_lower)
        features.title_country = self._extract_title_country(title.lower())

        # Key terms
        features.key_terms = self._extract_key_terms(full_text)

        # Topic classification (for hard blocking)
        features.topic = self._extract_topic(title.lower())

        # Named entities in title (CRITICAL for entity-based hard blocking)
        features.title_entities = self._extract_title_entities(title)

        # Action/event type in title (helps distinguish different events about same person)
        features.title_action = self._extract_title_action(title)

        return features

    def _tokenize_title(self, title: str) -> List[str]:
        """Tokenize and normalize title."""
        # Lowercase and split
        title_lower = title.lower()

        # Remove punctuation
        title_clean = re.sub(r"[^\w\s]", " ", title_lower)

        # Split and filter
        tokens = [
            w for w in title_clean.split()
            if len(w) > 2 and w not in STOP_WORDS
        ]

        return tokens

    def _extract_districts(self, text_lower: str) -> List[str]:
        """Extract Nepal districts mentioned in text."""
        found = []
        # Check English names with word boundaries
        for district in self._districts_lower:
            pattern = rf"\b{re.escape(district)}\b"
            if re.search(pattern, text_lower):
                found.append(district)

        # Check Nepali names (substring match for Devanagari)
        for location in self._nepal_locations_ne:
            if location in text_lower:
                found.append(location)

        return sorted(set(found))

    def _extract_title_district(self, title_lower: str) -> Optional[str]:
        """Extract the primary district mentioned in the title."""
        # Check English districts first
        for district in self._districts_lower:
            pattern = rf"\b{re.escape(district)}\b"
            if re.search(pattern, title_lower):
                return district

        # Check English cities
        for city in self._cities_lower:
            pattern = rf"\b{re.escape(city)}\b"
            if re.search(pattern, title_lower):
                return city

        # Check Nepali locations (substring match)
        for location in self._nepal_locations_ne:
            if location in title_lower:
                return location

        return None

    def _extract_constituencies(self, text_lower: str) -> List[str]:
        """Extract Nepal constituencies mentioned in text."""
        found = []

        # Direct match
        for constituency in self._constituencies_lower:
            if constituency in text_lower:
                found.append(constituency)

        # Pattern match for "district-N" format
        pattern = r"\b([a-z]+)-(\d+)\b"
        matches = re.findall(pattern, text_lower)
        for district, num in matches:
            if district in self._districts_lower:
                found.append(f"{district}-{num}")

        return sorted(set(found))

    def _extract_international_countries(self, text_lower: str) -> List[str]:
        """Extract international countries/locations mentioned in text."""
        found = []
        for country in self._international_countries:
            # For Nepali (Devanagari) text, use substring match
            # Word boundaries don't work for Devanagari script
            if self._is_devanagari(country):
                if country in text_lower:
                    found.append(country)
            # For multi-word terms, use direct search
            elif " " in country:
                if country in text_lower:
                    found.append(country)
            else:
                # Use word boundary for English single words
                pattern = rf"\b{re.escape(country)}\b"
                if re.search(pattern, text_lower):
                    found.append(country)

        # Also check international cities
        for city in self._international_cities:
            if self._is_devanagari(city):
                if city in text_lower:
                    found.append(city)
            elif " " in city:
                if city in text_lower:
                    found.append(city)
            else:
                pattern = rf"\b{re.escape(city)}\b"
                if re.search(pattern, text_lower):
                    found.append(city)

        return sorted(set(found))

    def _is_devanagari(self, text: str) -> bool:
        """Check if text contains Devanagari characters."""
        # Devanagari Unicode range: U+0900 to U+097F
        return any('\u0900' <= char <= '\u097F' for char in text)

    def _extract_title_country(self, title_lower: str) -> Optional[str]:
        """Extract the primary international country mentioned in the title."""
        # Check countries first
        for country in self._international_countries:
            if self._is_devanagari(country):
                if country in title_lower:
                    return country
            elif " " in country:
                if country in title_lower:
                    return country
            else:
                pattern = rf"\b{re.escape(country)}\b"
                if re.search(pattern, title_lower):
                    return country

        # Check cities
        for city in self._international_cities:
            if self._is_devanagari(city):
                if city in title_lower:
                    return city
            elif " " in city:
                if city in title_lower:
                    return city
            else:
                pattern = rf"\b{re.escape(city)}\b"
                if re.search(pattern, title_lower):
                    return city

        return None

    def _extract_key_terms(self, text: str) -> List[str]:
        """Extract key terms (proper nouns, quoted phrases)."""
        terms: Set[str] = set()

        # Capitalized words (likely proper nouns)
        capitalized = re.findall(r"\b[A-Z][a-z]+\b", text)
        for word in capitalized:
            word_lower = word.lower()
            if len(word) > 3 and word_lower not in STOP_WORDS:
                # Skip if it's a district/city (already extracted)
                if word_lower not in self._districts_lower and word_lower not in self._cities_lower:
                    terms.add(word_lower)

        # Quoted phrases
        quoted = re.findall(r'"([^"]{3,50})"', text)
        for phrase in quoted:
            terms.add(phrase.lower())

        # Multi-word capitalized names (e.g., "Prime Minister")
        multi_word = re.findall(r"\b([A-Z][a-z]+ [A-Z][a-z]+)\b", text)
        for phrase in multi_word:
            phrase_lower = phrase.lower()
            if phrase_lower not in STOP_WORDS:
                terms.add(phrase_lower)

        return sorted(terms)[:20]  # Limit to top 20 terms

    def _extract_topic(self, title_lower: str) -> Optional[str]:
        """
        Extract the primary topic from the title.

        This is used for HARD BLOCKING - stories with different topics
        should NEVER be clustered together, regardless of text similarity.
        """
        topic_scores = {}

        for topic, keywords in TOPIC_KEYWORDS.items():
            score = 0
            for kw in keywords:
                if kw.lower() in title_lower:
                    score += 1
            if score > 0:
                topic_scores[topic] = score

        if not topic_scores:
            return None

        # Return topic with highest score
        return max(topic_scores.keys(), key=lambda t: topic_scores[t])

    def _extract_title_entities(self, title: str) -> List[str]:
        """
        Extract canonical named entities from the title.

        This is CRITICAL for Palantir-grade clustering:
        - Stories about OLI should NEVER cluster with stories about KARKI
        - Stories about PRACHANDA should NEVER cluster with stories about DEUBA
        - Returns canonical entity IDs for consistent matching

        Args:
            title: Story title (original case preserved for Nepali)

        Returns:
            List of canonical entity IDs found in title (e.g., ["oli"], ["karki"])
        """
        title_lower = title.lower()
        found_entities: Set[str] = set()

        # Check each alias and map to canonical entity
        for alias, canonical in NEPAL_ENTITY_ALIASES.items():
            # Skip generic ambassadors - they need country context
            if canonical == "_ambassador":
                continue

            # For Devanagari, use direct substring search
            if self._is_devanagari(alias):
                if alias in title:
                    found_entities.add(canonical)
            else:
                # For English, use word boundary matching
                pattern = rf"\b{re.escape(alias)}\b"
                if re.search(pattern, title_lower):
                    found_entities.add(canonical)

        return sorted(found_entities)

    def _extract_title_action(self, title: str) -> Optional[str]:
        """
        Extract the primary action/event type from the title.

        This helps distinguish different events even about the same person:
        - "Oli's CLARIFICATION about 2023" != "Oli MEETS Chinese ambassador"
        - "Karki VISITS India" != "Karki SPEAKS at parliament"

        Args:
            title: Story title (original case preserved for Nepali)

        Returns:
            Canonical action type (e.g., "meeting", "clarification", "arrest")
        """
        title_lower = title.lower()
        found_actions: Dict[str, int] = {}

        for keyword, action in EVENT_ACTION_KEYWORDS.items():
            # For Devanagari, use direct substring search
            if self._is_devanagari(keyword):
                if keyword in title:
                    found_actions[action] = found_actions.get(action, 0) + 1
            else:
                # For English, use word boundary matching
                pattern = rf"\b{re.escape(keyword)}\b"
                if re.search(pattern, title_lower):
                    found_actions[action] = found_actions.get(action, 0) + 1

        if not found_actions:
            return None

        # Return the most frequently matched action
        return max(found_actions.keys(), key=lambda a: found_actions[a])

    def compute_feature_similarity(
        self,
        features1: StoryFeatures,
        features2: StoryFeatures,
    ) -> dict:
        """
        Compute similarity components between two feature sets.

        Returns dict with individual similarity scores.
        """
        # MinHash text similarity
        text_sim = self.minhash.estimate_similarity(
            features1.content_minhash,
            features2.content_minhash,
        )

        # Title token overlap (Jaccard)
        set1 = set(features1.title_tokens)
        set2 = set(features2.title_tokens)
        if set1 or set2:
            title_sim = len(set1 & set2) / len(set1 | set2) if (set1 | set2) else 0.0
        else:
            title_sim = 0.0

        # Geographic overlap
        districts1 = set(features1.districts)
        districts2 = set(features2.districts)
        if districts1 or districts2:
            geo_sim = len(districts1 & districts2) / len(districts1 | districts2) if (districts1 | districts2) else 0.0
        else:
            geo_sim = 0.0

        # Key term overlap
        terms1 = set(features1.key_terms)
        terms2 = set(features2.key_terms)
        if terms1 or terms2:
            entity_sim = len(terms1 & terms2) / len(terms1 | terms2) if (terms1 | terms2) else 0.0
        else:
            entity_sim = 0.0

        return {
            "text": text_sim,
            "title": title_sim,
            "geo": geo_sim,
            "entity": entity_sim,
        }


# Global singleton
_feature_extractor: FeatureExtractor = None


def get_feature_extractor() -> FeatureExtractor:
    """Get the global FeatureExtractor singleton."""
    global _feature_extractor
    if _feature_extractor is None:
        _feature_extractor = FeatureExtractor()
    return _feature_extractor
