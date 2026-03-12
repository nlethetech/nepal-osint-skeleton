"""Rules-based Nepal relevance classifier."""
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

import yaml

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class RelevanceLevel(str, Enum):
    """Nepal relevance classification levels."""
    NEPAL_DOMESTIC = "NEPAL_DOMESTIC"
    NEPAL_NEIGHBOR = "NEPAL_NEIGHBOR"
    INTERNATIONAL = "INTERNATIONAL"


class StoryCategory(str, Enum):
    """Story category classification."""
    POLITICAL = "political"
    ECONOMIC = "economic"
    SECURITY = "security"
    DISASTER = "disaster"
    SOCIAL = "social"


@dataclass
class RelevanceResult:
    """Result of relevance classification."""
    level: RelevanceLevel
    score: float
    triggers: list[str] = field(default_factory=list)
    category: Optional[StoryCategory] = None


class RelevanceService:
    """
    Rules-based Nepal relevance classifier.

    Classifies stories as:
    - NEPAL_DOMESTIC: Directly about Nepal
    - NEPAL_NEIGHBOR: About Nepal's neighbors with Nepal connection
    - INTERNATIONAL: Not relevant to Nepal

    Also classifies into 5 categories:
    - political, economic, security, disaster, social
    """

    # Category keyword mappings (English)
    CATEGORY_KEYWORDS_EN = {
        StoryCategory.POLITICAL: [
            "election", "vote", "voting", "ballot", "poll", "polls",
            "parliament", "parliamentary", "cabinet", "minister", "ministry",
            "party", "parties", "coalition", "government", "governance",
            "president", "prime minister", "pm", "mp", "lawmaker",
            "congress", "uml", "maoist", "communist", "democratic",
            "constitution", "constitutional", "amendment",
            "impeachment", "resignation", "appointment",
            "diplomacy", "diplomatic", "ambassador", "embassy",
            "policy", "bill", "legislation", "law", "act",
        ],
        StoryCategory.ECONOMIC: [
            "economy", "economic", "market", "markets", "nepse", "stock",
            "inflation", "deflation", "gdp", "growth",
            "budget", "fiscal", "tax", "taxes", "taxation",
            "remittance", "remittances", "trade", "export", "import",
            "bank", "banking", "nrb", "rastra bank", "monetary",
            "investment", "investor", "fdi",
            "price", "prices", "cost", "rupee", "npr", "currency",
            "employment", "unemployment", "job", "jobs", "labor",
            "business", "company", "corporate", "industry",
            "tourism", "tourist", "tourists",
            "agriculture", "farming", "crop", "harvest",
            "hydropower", "electricity", "energy",
        ],
        StoryCategory.SECURITY: [
            "army", "military", "armed forces", "defense", "defence",
            "border", "borders", "frontier", "boundary",
            "police", "apf", "armed police",
            "arrest", "arrested", "custody", "detained", "detention",
            "crime", "criminal", "gang", "mafia",
            "terrorism", "terrorist", "terror",
            "violence", "violent", "attack", "assault",
            "murder", "homicide", "killing", "killed",
            "weapon", "arms", "gun", "firearms",
            "smuggling", "trafficking", "drugs", "narcotics",
            "cybercrime", "cyber attack", "hacking",
            "espionage", "spy", "intelligence",
        ],
        StoryCategory.DISASTER: [
            "earthquake", "quake", "tremor", "seismic", "magnitude",
            "flood", "flooding", "inundation", "deluge",
            "landslide", "mudslide", "debris flow",
            "avalanche", "snowslide",
            "fire", "blaze", "inferno", "wildfire",
            "accident", "crash", "collision",
            "emergency", "rescue", "relief",
            "disaster", "catastrophe", "calamity",
            "storm", "cyclone", "hurricane", "typhoon",
            "drought", "famine",
            "epidemic", "pandemic", "outbreak",
            "casualty", "casualties", "fatality", "fatalities",
            "damage", "destruction", "devastation",
        ],
        StoryCategory.SOCIAL: [
            "protest", "protests", "protester", "protesters",
            "strike", "strikes", "bandh", "hartal", "shutdown",
            "rally", "rallies", "demonstration", "march",
            "health", "healthcare", "hospital", "medical",
            "education", "school", "university", "college", "student",
            "culture", "cultural", "festival", "celebration",
            "religion", "religious", "temple", "mosque", "church",
            "women", "gender", "feminist", "lgbtq",
            "human rights", "rights", "freedom", "liberty",
            "poverty", "poor", "inequality",
            "environment", "pollution", "climate", "conservation",
            "ngo", "charity", "humanitarian", "volunteer",
        ],
    }

    # Nepali (Devanagari) category keywords
    CATEGORY_KEYWORDS_NE = {
        StoryCategory.POLITICAL: [
            "निर्वाचन", "मतदान", "चुनाव", "मत",
            "संसद", "संसदीय", "मन्त्रिपरिषद", "मन्त्री", "मन्त्रालय",
            "दल", "पार्टी", "गठबन्धन", "सरकार", "शासन",
            "राष्ट्रपति", "प्रधानमन्त्री", "सांसद",
            "कांग्रेस", "एमाले", "माओवादी", "कम्युनिस्ट",
            "संविधान", "संवैधानिक", "संशोधन",
            "महाभियोग", "राजीनामा", "नियुक्ति",
            "कूटनीति", "कूटनीतिक", "राजदूत", "दूतावास",
            "नीति", "विधेयक", "कानून", "ऐन",
            "प्रचण्ड", "ओली", "देउवा", "बालेन",
        ],
        StoryCategory.ECONOMIC: [
            "अर्थतन्त्र", "आर्थिक", "बजार", "नेप्से", "शेयर",
            "मुद्रास्फीति", "जीडीपी", "वृद्धि",
            "बजेट", "कर", "करको",
            "विप्रेषण", "रेमिट्यान्स", "व्यापार", "निर्यात", "आयात",
            "बैंक", "बैंकिंग", "राष्ट्र बैंक", "मौद्रिक",
            "लगानी", "लगानीकर्ता",
            "मूल्य", "दाम", "रुपैयाँ",
            "रोजगारी", "बेरोजगारी", "नोकरी",
            "व्यवसाय", "कम्पनी", "उद्योग",
            "पर्यटन", "पर्यटक",
            "कृषि", "खेती", "बाली", "फसल",
            "जलविद्युत", "बिजुली", "ऊर्जा",
        ],
        StoryCategory.SECURITY: [
            "सेना", "सैन्य", "सशस्त्र", "रक्षा",
            "सीमा", "सीमान्त",
            "प्रहरी", "पुलिस", "सशस्त्र प्रहरी",
            "पक्राउ", "गिरफ्तार", "हिरासत",
            "अपराध", "अपराधी", "गिरोह",
            "आतंकवाद", "आतंकवादी", "आतंक",
            "हिंसा", "हिंसात्मक", "आक्रमण",
            "हत्या", "हत्याकाण्ड", "मारिए",
            "हतियार", "बन्दुक",
            "तस्करी", "ड्रग्स", "लागुऔषध",
            "साइबर अपराध", "ह्याकिंग",
        ],
        StoryCategory.DISASTER: [
            "भूकम्प", "भुकम्प", "कम्पन",
            "बाढी", "डुबान", "जलमग्न",
            "पहिरो", "भू-क्षय",
            "हिमपहिरो", "हिउँ पहिरो",
            "आगलागी", "आगो", "डढेलो",
            "दुर्घटना", "ठोक्किएको",
            "आपतकालीन", "उद्धार", "राहत",
            "विपद", "प्रकोप", "विनाश",
            "आँधी", "तुफान",
            "खडेरी", "अनिकाल",
            "महामारी", "रोग फैलावट",
            "मृतक", "घाइते", "क्षति",
        ],
        StoryCategory.SOCIAL: [
            "प्रदर्शन", "विरोध", "आन्दोलन",
            "हडताल", "बन्द", "चक्काजाम",
            "र्‍याली", "जुलुस",
            "स्वास्थ्य", "अस्पताल", "चिकित्सा",
            "शिक्षा", "विद्यालय", "विश्वविद्यालय", "विद्यार्थी",
            "संस्कृति", "सांस्कृतिक", "चाड", "पर्व", "उत्सव",
            "धर्म", "धार्मिक", "मन्दिर", "मस्जिद",
            "महिला", "लैंगिक",
            "मानव अधिकार", "अधिकार", "स्वतन्त्रता",
            "गरिबी", "असमानता",
            "वातावरण", "प्रदूषण", "जलवायु",
        ],
    }

    # International sports/entertainment exclusion markers
    INTERNATIONAL_SPORTS_MARKERS = [
        # Cricket teams and leagues (not Nepal)
        "windies", "west indies", "australia cricket", "england cricket",
        "india cricket", "bcci", "ipl", "indian premier league",
        "big bash", "cpl", "caribbean premier league", "county cricket",
        "ashes", "test series", "odi series",
        # T20 leagues and world cups (unless Nepal mentioned)
        "t20 world cup", "t20 wc", "world t20", "icc t20",
        "world cup squad", "squad announced", "squad named",
        # Football
        "premier league", "champions league", "la liga", "serie a",
        "bundesliga", "ligue 1", "europa league", "fa cup",
        "manchester united", "manchester city", "liverpool", "chelsea",
        "arsenal", "barcelona", "real madrid", "bayern munich",
        # Individual players (non-Nepal)
        "virat kohli", "rohit sharma", "ms dhoni", "sachin tendulkar",
        "messi", "ronaldo", "neymar", "mbappe", "haaland",
        # Entertainment
        "bollywood", "hollywood", "tollywood", "netflix", "amazon prime",
        "oscar", "grammy", "emmy", "box office",
    ]

    # ALL sports exclusion markers (including Nepal domestic sports)
    # These are ALWAYS excluded from OSINT/security monitoring
    ALL_SPORTS_MARKERS_EN = [
        # General sports terms
        "league", "tournament", "championship", "cup final", "semifinal",
        "match score", "game score", "hat trick", "goal scored", "penalty kick",
        "football match", "soccer match", "cricket match", "basketball", "volleyball",
        # Football leagues/teams
        "a division", "b division", "national league", "super league",
        "three star", "manang marshyangdi", "machhindra fc", "afc cup",
        "jawalakhel", "nepal apm",
        # Cricket
        "epl cricket", "ppl", "everest premier league",
        # Sports figures (Nepal)
        "paras khadka", "sandeep lamichhane", "rohit paudel",
        # Other sports
        "karate", "taekwondo", "boxing match", "wrestling", "athletics",
        "marathon", "cycling race", "swimming competition",
        "tiger cup", "gold cup", "aaha rara gold cup",
        "south asian games", "sag games",
    ]

    # Nepali-script international sports teams/clubs — HARD EXCLUDE
    # Nepal media frequently writes about these in Devanagari
    ALL_SPORTS_MARKERS_NE_INTERNATIONAL = [
        "चेल्सी",  # Chelsea
        "आर्सेनल",  # Arsenal
        "लिभरपुल",  # Liverpool
        "म्यानचेस्टर",  # Manchester (United/City)
        "बार्सिलोना", "बार्सा",  # Barcelona
        "रियल मड्रिड", "रियल म्याड्रिड",  # Real Madrid
        "बायर्न म्युनिख",  # Bayern Munich
        "युभेन्टस",  # Juventus
        "पीएसजी",  # PSG
        "प्रिमियर लिग",  # Premier League
        "च्याम्पियन्स लिग",  # Champions League
        "ला लिगा",  # La Liga
        "बुन्डेसलिगा",  # Bundesliga
        "मेस्सी", "मेसी",  # Messi
        "रोनाल्डो",  # Ronaldo
        "एम्बाप्पे",  # Mbappe
        "हालान्ड",  # Haaland
        "नेमार",  # Neymar
        "विराट कोहली", "कोहली",  # Kohli
        "रोहित शर्मा",  # Rohit Sharma
        "धोनी",  # Dhoni
        "आईपीएल",  # IPL
        "बीसीसीआई",  # BCCI
    ]

    ALL_SPORTS_MARKERS_NE = [
        # Nepali sports keywords - HARD EXCLUDE
        "लिग", "लीग",  # League
        "एन्फा", "अखिल नेपाल फुटबल संघ",  # ANFA
        "फुटबल", "फुटवल",  # Football
        "क्रिकेट",  # Cricket
        "मच्छिन्द्र", "मछिन्द्र",  # Machhindra FC
        "मनाङ", "मर्स्याङ्दी",  # Manang
        "थ्री स्टार",  # Three Star
        "राष्ट्रिय लिग", "ए डिभिजन", "बी डिभिजन",  # National League, A/B Division
        "खेलकुद",  # Sports (compound word)
        "गोलरक्षक", "स्ट्राइकर",  # Goalkeeper, Striker
        "फाइनल", "सेमिफाइनल", "क्वार्टरफाइनल",  # Final, Semifinal
        "प्रतियोगिता", "टुर्नामेन्ट", "च्याम्पियनशिप",  # Competition, Tournament
        "भलिबल", "बास्केटबल",  # Volleyball, Basketball
        "ईपीएल", "एभरेस्ट प्रिमियर लिग",  # EPL (Everest Premier League)
        "कराते", "कराँते", "तेक्वान्दो", "बक्सिङ",  # Karate (both spellings), Taekwondo, Boxing
        "कराते टोली", "कराँते टोली",  # Karate team
        "टाइगर कप", "गोल्ड कप", "आहा रारा",  # Tiger Cup, Gold Cup
        "दक्षिण एसियाली खेलकुद", "स्याग",  # South Asian Games, SAG
        "जावलाखेल", "एपीएफ",  # Jawalakhel, APF (sports context)
        "वरियता", "वरीयता",  # Ranking (sports context)
        "अलराउन्डर",  # All-rounder (cricket)
        "एनपीजीए",  # NPGA (golf)
    ]

    # Entertainment/Celebrity exclusion markers
    ENTERTAINMENT_MARKERS_EN = [
        "bollywood", "hollywood", "kollywood", "tollywood",
        "movie release", "film release", "box office", "trailer launch",
        "music video", "album release", "concert", "grammy", "oscar",
        "celebrity", "actress", "actor", "singer", "model",
        "netflix", "amazon prime", "disney plus",
        "red carpet", "award show", "film festival",
    ]

    ENTERTAINMENT_MARKERS_NE = [
        # Nepali entertainment - EXCLUDE from OSINT
        "चलचित्र", "फिल्म",  # Movie, Film
        "गायक", "गायिका",  # Singer (m/f)
        "अभिनेता", "अभिनेत्री",  # Actor, Actress
        "म्युजिक भिडियो", "एल्बम",  # Music video, Album
        "कन्सर्ट",  # Concert
        "पिरती", "प्रेम कथा",  # Love story (entertainment context)
        "बलिउड", "हलिउड", "कलिउड",  # Bollywood, Hollywood, Kollywood
        "रियालिटी शो",  # Reality show
        "टेलिभिजन", "टिभी शो",  # Television, TV show
        "सेलिब्रेटी",  # Celebrity
    ]

    # Routine/Non-OSINT content markers (weather, lifestyle, etc.)
    ROUTINE_MARKERS_NE = [
        # Weather reports (routine, not disaster-level)
        "मौसम पूर्वानुमान",  # Weather forecast
        "हिउँदे वर्षा",  # Winter rain (routine)
        "तापक्रम",  # Temperature
        # Lifestyle/soft news
        "बैंक खाता खोल्ने",  # Opening bank account (routine)
        "किओस्क मेसिन",  # Kiosk machine
        "फोन दर्ता",  # Phone registration
        "आइएमइआइ",  # IMEI
        "एमडीएमएस",  # MDMS
        # Promotional content
        "बिल्डकन",  # Buildcon (expo)
        "मेला", "प्रदर्शनी",  # Fair, Exhibition
    ]

    def __init__(self, config_path: Optional[str] = None):
        """Load relevance rules from YAML config."""
        config_path = config_path or settings.relevance_rules_path

        try:
            with open(config_path) as f:
                config = yaml.safe_load(f)
        except FileNotFoundError:
            logger.warning(f"Relevance config not found at {config_path}, using defaults")
            config = {}

        self.nepal_sources = set(config.get("nepal_sources", []))
        self.nepal_markers = config.get("nepal_markers", [])
        self.exclusion_patterns = config.get("exclusion_patterns", [])
        self.neighbor_keywords = config.get("neighbor_keywords", [])

        # Pre-compile exclusion patterns
        self._compiled_exclusions = []
        for pattern in self.exclusion_patterns:
            try:
                self._compiled_exclusions.append(re.compile(pattern, re.IGNORECASE))
            except re.error:
                logger.warning(f"Invalid regex pattern: {pattern}")

        # Pre-process category keywords (English - with word boundaries)
        self._category_patterns_en = {}
        for cat, keywords in self.CATEGORY_KEYWORDS_EN.items():
            self._category_patterns_en[cat] = [
                re.compile(r'\b' + re.escape(kw.lower()) + r'\b', re.IGNORECASE)
                for kw in keywords
            ]

        # Pre-process category keywords (Nepali - no word boundaries needed)
        self._category_keywords_ne = {
            cat: [kw.lower() for kw in keywords]
            for cat, keywords in self.CATEGORY_KEYWORDS_NE.items()
        }

        # Pre-compile international sports patterns (for exclusion)
        self._international_sports_patterns = [
            re.compile(r'\b' + re.escape(m.lower()) + r'\b', re.IGNORECASE)
            for m in self.INTERNATIONAL_SPORTS_MARKERS
        ]

        # Pre-compile ALL sports patterns (English with word boundaries)
        self._all_sports_patterns_en = [
            re.compile(r'\b' + re.escape(m.lower()) + r'\b', re.IGNORECASE)
            for m in self.ALL_SPORTS_MARKERS_EN
        ]

        # Nepali sports keywords (simple substring match - no word boundaries)
        self._all_sports_keywords_ne = [kw.lower() for kw in self.ALL_SPORTS_MARKERS_NE]
        # International sports teams in Nepali script
        self._intl_sports_keywords_ne = [kw.lower() for kw in self.ALL_SPORTS_MARKERS_NE_INTERNATIONAL]

        # Entertainment patterns
        self._entertainment_patterns_en = [
            re.compile(r'\b' + re.escape(m.lower()) + r'\b', re.IGNORECASE)
            for m in self.ENTERTAINMENT_MARKERS_EN
        ]
        self._entertainment_keywords_ne = [kw.lower() for kw in self.ENTERTAINMENT_MARKERS_NE]

        # Routine/non-OSINT patterns
        self._routine_keywords_ne = [kw.lower() for kw in self.ROUTINE_MARKERS_NE]

        # Lowercase markers for matching
        self._markers_lower = [m.lower() for m in self.nepal_markers]
        self._top_markers = self._markers_lower[:20]  # Top priority markers

    def classify(
        self,
        title: str,
        content: Optional[str],
        source_id: str,
    ) -> RelevanceResult:
        """
        Classify story Nepal relevance.

        Args:
            title: Story title
            content: Story content/summary (optional)
            source_id: Source identifier

        Returns:
            RelevanceResult with level, score, and trigger keywords
        """
        text = f"{title} {content or ''}".lower()
        title_lower = title.lower()
        triggers: list[str] = []

        # Step 0A: HARD EXCLUDE ALL SPORTS (including Nepal domestic sports)
        # Sports news is not relevant to OSINT/security monitoring
        sports_score = 0

        # Check international sports teams in Nepali script (चेल्सी, आर्सेनल, etc.)
        for kw in self._intl_sports_keywords_ne:
            if kw in text:
                return RelevanceResult(
                    level=RelevanceLevel.INTERNATIONAL,
                    score=0.0,
                    triggers=[f"EXCLUDED: intl_sports_ne:{kw}"],
                )

        # Check Nepali sports keywords first (most common for Nepal sports)
        for kw in self._all_sports_keywords_ne:
            if kw in text:
                sports_score += 2  # Strong signal
                if sports_score >= 2:
                    return RelevanceResult(
                        level=RelevanceLevel.INTERNATIONAL,
                        score=0.0,
                        triggers=[f"EXCLUDED: sports_ne:{kw}"],
                    )

        # Check English sports keywords
        for pattern in self._all_sports_patterns_en:
            if pattern.search(text):
                sports_score += 1
                if sports_score >= 2:
                    return RelevanceResult(
                        level=RelevanceLevel.INTERNATIONAL,
                        score=0.0,
                        triggers=["EXCLUDED: sports_en"],
                    )

        # Step 0A2: HARD EXCLUDE ENTERTAINMENT
        entertainment_score = 0
        for kw in self._entertainment_keywords_ne:
            if kw in text:
                entertainment_score += 2
                if entertainment_score >= 2:
                    return RelevanceResult(
                        level=RelevanceLevel.INTERNATIONAL,
                        score=0.0,
                        triggers=[f"EXCLUDED: entertainment_ne:{kw}"],
                    )

        for pattern in self._entertainment_patterns_en:
            if pattern.search(text):
                entertainment_score += 1
                if entertainment_score >= 2:
                    return RelevanceResult(
                        level=RelevanceLevel.INTERNATIONAL,
                        score=0.0,
                        triggers=["EXCLUDED: entertainment_en"],
                    )

        # Step 0A3: EXCLUDE ROUTINE/NON-OSINT CONTENT
        routine_score = 0
        for kw in self._routine_keywords_ne:
            if kw in text:
                routine_score += 1
                if routine_score >= 2:
                    return RelevanceResult(
                        level=RelevanceLevel.INTERNATIONAL,
                        score=0.0,
                        triggers=[f"EXCLUDED: routine:{kw}"],
                    )

        # Step 0B: Check for international sports/entertainment
        # These bypass all other checks unless Nepal is explicitly mentioned
        international_sports_count = 0
        for pattern in self._international_sports_patterns:
            if pattern.search(text):
                international_sports_count += 1
                if international_sports_count >= 2:
                    # Strong international sports signal - only allow if Nepal explicitly mentioned
                    if not self._has_nepal_marker(text):
                        return RelevanceResult(
                            level=RelevanceLevel.INTERNATIONAL,
                            score=0.0,
                            triggers=["EXCLUDED: international_sports"],
                        )
                    break

        # Step 1: Check exclusions
        for pattern in self._compiled_exclusions:
            if pattern.search(text):
                # Check if Nepal is also mentioned (override exclusion)
                if not self._has_nepal_marker(text):
                    return RelevanceResult(
                        level=RelevanceLevel.INTERNATIONAL,
                        score=0.0,
                        triggers=[f"EXCLUDED: {pattern.pattern[:30]}"],
                    )

        # Classify category early (used in all return paths)
        category = self._classify_category(text)

        # Step 1.5: HARD EXCLUDE PURELY INTERNATIONAL STORIES
        # Even from Nepal sources, stories about other countries with NO Nepal connection
        # should be filtered out (India snake bites, Japan elections, Pakistan militants)
        if self._is_purely_international(text):
            return RelevanceResult(
                level=RelevanceLevel.INTERNATIONAL,
                score=0.0,
                triggers=["EXCLUDED: purely_international_content"],
                category=category,
            )

        # Step 2: Nepal news sources + Nepal content = domestic
        # CHANGED: Now requires BOTH Nepal source AND Nepal marker in content
        # This prevents international news republished by Nepal sources from being approved
        source_lower = source_id.lower()
        is_nepal_source = any(src in source_lower for src in self.nepal_sources)
        has_nepal_content = self._has_nepal_marker(text)

        if is_nepal_source:
            if has_nepal_content:
                triggers.append(f"SOURCE+CONTENT")
                return RelevanceResult(
                    level=RelevanceLevel.NEPAL_DOMESTIC,
                    score=0.95,
                    triggers=triggers,
                    category=category,
                )
            # Nepal source in Nepali script without explicit markers
            # Stories written in Nepali script for Nepali audience are domestic news
            # UNLESS they're about foreign countries (already filtered above)
            if self._is_nepali_script(text):
                # If strong Nepal markers present → high confidence domestic
                if self._has_strong_nepal_marker(text):
                    triggers.append("SOURCE+NEPALI_SCRIPT")
                    return RelevanceResult(
                        level=RelevanceLevel.NEPAL_DOMESTIC,
                        score=0.85,
                        triggers=triggers,
                        category=category,
                    )
                # Nepali script from Nepal source but NO strong Nepal markers →
                # lower confidence to trigger Haiku verification
                triggers.append("SOURCE+NEPALI_SCRIPT_WEAK")
                return RelevanceResult(
                    level=RelevanceLevel.NEPAL_DOMESTIC,
                    score=0.55,  # Low enough to trigger Haiku review
                    triggers=triggers,
                    category=category,
                )
            # Nepal source but NO Nepal content - continue to other checks
            # (don't auto-approve)

        # Step 3: Check Nepal markers
        nepal_score = 0.0
        matched_markers = []

        # Check top priority markers first (country, major cities)
        for marker in self._top_markers:
            if marker in text:
                nepal_score += 0.25
                matched_markers.append(marker)
                if nepal_score >= 0.75:
                    break

        # Check remaining markers if needed
        if nepal_score < 0.5:
            for marker in self._markers_lower[20:]:
                if marker in text:
                    nepal_score += 0.15
                    matched_markers.append(marker)
                    if nepal_score >= 0.6:
                        break

        if nepal_score >= 0.4:
            triggers.extend(matched_markers[:5])  # Limit trigger count
            return RelevanceResult(
                level=RelevanceLevel.NEPAL_DOMESTIC,
                score=min(nepal_score, 1.0),
                triggers=triggers,
                category=category,
            )

        # Step 4: Check neighbor impact
        for keyword in self.neighbor_keywords:
            keyword_lower = keyword.lower()
            if keyword_lower in text:
                # Must also have some Nepal marker
                if matched_markers or self._has_nepal_marker(text):
                    triggers.append(f"NEIGHBOR:{keyword}")
                    return RelevanceResult(
                        level=RelevanceLevel.NEPAL_NEIGHBOR,
                        score=0.6,
                        triggers=triggers,
                        category=category,
                    )

        # Step 5: Default to international
        return RelevanceResult(
            level=RelevanceLevel.INTERNATIONAL,
            score=max(nepal_score, 0.1),
            triggers=[],
            category=category,
        )

    # CRITICAL Nepal markers that MUST be checked in _has_nepal_marker()
    # These are essential Nepali script and romanized markers that indicate Nepal content
    CRITICAL_NEPAL_MARKERS = [
        # Nepali script - MOST IMPORTANT (Country/Government)
        "नेपाल",  # Nepal
        "नेपाली",  # Nepali
        "काठमाडौं", "काठमाण्डौ", "काठमाण्डू",  # Kathmandu variations
        "प्रधानमन्त्री",  # Prime Minister
        "राष्ट्रपति",  # President
        "सरकार",  # Government
        "संसद",  # Parliament
        "मन्त्री", "मन्त्रालय",  # Minister/Ministry

        # Political figures (current)
        "प्रचण्ड", "प्रचंड",  # Prachanda
        "ओली",  # Oli
        "देउवा",  # Deuba
        "पौडेल", "पौड्याल",  # Paudel/Poudyal
        "कार्की",  # Karki (current PM)
        "बालेन",  # Balen Shah
        "रवि लामिछाने",  # Rabi Lamichhane

        # Nepal-specific institutions (CRITICAL)
        "नेप्से",  # NEPSE (Nepal Stock Exchange)
        "राष्ट्र बैंक",  # Rastra Bank
        "प्रहरी",  # Police (Nepali word)
        "सशस्त्र प्रहरी",  # Armed Police Force
        "नेपाल सेना",  # Nepal Army
        "निर्वाचन आयोग",  # Election Commission
        "सर्वोच्च अदालत",  # Supreme Court

        # Major cities
        "पोखरा",  # Pokhara
        "विराटनगर",  # Biratnagar
        "भक्तपुर",  # Bhaktapur
        "ललितपुर",  # Lalitpur
        "जनकपुर",  # Janakpur
        "नेपालगञ्ज",  # Nepalgunj
        "बुटवल",  # Butwal
        "धरान",  # Dharan
        "भरतपुर",  # Bharatpur
        "हेटौंडा",  # Hetauda

        # Provinces
        "बागमती",  # Bagmati
        "गण्डकी",  # Gandaki
        "लुम्बिनी",  # Lumbini
        "कर्णाली",  # Karnali
        "सुदूरपश्चिम",  # Sudurpashchim
        "मधेश",  # Madhesh
        "कोशी",  # Koshi

        # Political parties
        "कांग्रेस",  # Congress
        "एमाले",  # UML
        "माओवादी",  # Maoist
        "राप्रपा",  # RPP

        # Nepal currency/economy
        "रुपैयाँ",  # Rupee

        # Romanized Nepal markers
        "nepal", "nepali", "nepalese",
        "kathmandu", "pokhara", "biratnagar", "bhaktapur", "lalitpur",
        "prachanda", "oli", "deuba", "paudel", "karki", "balen",
        "nepse", "nrb", "rastra bank",

        # Election-related keywords (from Nepal sources = Nepal elections)
        # Added to fix false negatives on election coverage without explicit "Nepal"
        "election commission", "polling station", "polling stations",
        "booth capture", "ballot", "voters", "voting",
        "march 5 polls", "march polls", "upcoming elections",
        "constituency", "constituencies",
        "fptp", "pr seats", "proportional representation",
        "local election", "provincial election", "federal election",
        "by-election", "by election",
    ]

    # Strong Nepal markers — truly Nepal-specific, NOT generic words like
    # "मन्त्री" (minister) or "सरकार" (government) that appear in
    # international stories too. Used by _is_purely_international to decide
    # if an international story has a genuine Nepal connection.
    STRONG_NEPAL_MARKERS = [
        # Country name (Nepali + English)
        "नेपाल", "नेपाली", "nepal", "nepali", "nepalese",
        # Capital and major cities
        "काठमाडौं", "काठमाण्डौ", "काठमाण्डू", "kathmandu",
        "पोखरा", "pokhara", "विराटनगर", "biratnagar",
        "भक्तपुर", "bhaktapur", "ललितपुर", "lalitpur",
        "जनकपुर", "janakpur", "नेपालगञ्ज", "nepalgunj",
        "बुटवल", "butwal", "धरान", "dharan",
        "भरतपुर", "bharatpur", "हेटौंडा", "hetauda",
        "बिरगञ्ज", "birgunj", "धनगढी", "dhangadhi",
        # Provinces
        "बागमती", "गण्डकी", "लुम्बिनी", "कर्णाली",
        "सुदूरपश्चिम", "मधेश", "कोशी",
        # Nepal-specific political figures
        "प्रचण्ड", "प्रचंड", "prachanda",
        "ओली", "oli",
        "देउवा", "deuba",
        "पौडेल", "paudel",
        "कार्की", "karki",
        "बालेन", "balen",
        "रवि लामिछाने", "lamichhane",
        # Nepal-specific institutions
        "नेप्से", "nepse", "राष्ट्र बैंक", "rastra bank", "nrb",
        "नेपाल प्रहरी", "नेपाल सेना",
        "निर्वाचन आयोग",
        # Nepal political parties
        "कांग्रेस", "एमाले", "माओवादी", "राप्रपा",
        "रास्वपा", "राष्ट्रिय स्वतन्त्र पार्टी",
        # Currency
        "रुपैयाँ",
    ]

    # Short romanized markers that need word-boundary matching to avoid
    # false positives (e.g., "oli" in "Bolivia", "balen" in "balance")
    _ROMANIZED_MARKERS_NEED_BOUNDARY = {
        "oli", "nrb", "balen", "karki", "deuba", "paudel",
        "fptp", "pr seats",
    }

    def __init_marker_patterns(self):
        """Pre-compile word-boundary patterns for short romanized markers."""
        if not hasattr(self, '_romanized_patterns_compiled'):
            self._romanized_patterns_compiled = {
                marker: re.compile(r'\b' + re.escape(marker) + r'\b', re.IGNORECASE)
                for marker in self._ROMANIZED_MARKERS_NEED_BOUNDARY
            }

    def _marker_in_text(self, marker: str, text_lower: str) -> bool:
        """Check if marker is in text, using word boundaries for short romanized markers."""
        if marker in self._ROMANIZED_MARKERS_NEED_BOUNDARY:
            self.__init_marker_patterns()
            pattern = self._romanized_patterns_compiled.get(marker)
            return bool(pattern and pattern.search(text_lower))
        return marker in text_lower

    def _has_nepal_marker(self, text: str) -> bool:
        """
        Quick check for any Nepal marker in text (broad check).

        CRITICAL: Checks both Nepali script and romanized markers.
        Uses word boundaries for short romanized markers to avoid
        false positives (e.g., "oli" matching in "Bolivia").
        """
        text_lower = text.lower()

        # Check critical markers (Nepali script + key romanized)
        for marker in self.CRITICAL_NEPAL_MARKERS:
            if self._marker_in_text(marker, text_lower):
                return True

        # Also check top config markers as fallback
        for marker in self._top_markers[:10]:
            if self._marker_in_text(marker, text_lower):
                return True

        return False

    def _has_strong_nepal_marker(self, text: str) -> bool:
        """
        Check for truly Nepal-specific markers only.

        Unlike _has_nepal_marker, this excludes generic words like
        "मन्त्री" (minister), "सरकार" (government), "राष्ट्रपति" (president)
        which also appear in stories about other countries.

        Used by _is_purely_international() to avoid false negatives
        where Iran/Bolivia stories contain generic governance terms.
        """
        text_lower = text.lower()
        for marker in self.STRONG_NEPAL_MARKERS:
            if self._marker_in_text(marker, text_lower):
                return True
        return False

    def _is_nepali_script(self, text: str) -> bool:
        """
        Check if text is predominantly in Nepali (Devanagari) script.

        Stories written in Nepali script from Nepal sources are almost always
        about Nepal domestic affairs, even if they don't mention "नेपाल" explicitly.
        """
        if not text:
            return False

        # Count Devanagari characters (Unicode range 0900-097F)
        devanagari_count = sum(1 for c in text if '\u0900' <= c <= '\u097F')
        total_chars = len(text.replace(" ", ""))

        if total_chars == 0:
            return False

        # If more than 40% Devanagari, consider it Nepali script
        return (devanagari_count / total_chars) > 0.4

    def _is_purely_international(self, text: str) -> bool:
        """
        Check if story is purely about another country with NO Nepal connection.

        This filters out:
        - India internal news (snake bites, elections, economy)
        - Japan/China/Pakistan internal affairs
        - Other countries' news republished by Nepal media
        - Middle East conflicts (Iran, Israel, Gaza)
        - Bolivia, South America, etc.

        Returns True if story should be EXCLUDED (purely international).
        """
        # If Nepal is SPECIFICALLY mentioned (not generic governance words),
        # then story has a genuine Nepal connection — keep it.
        # Uses strong markers only to prevent "मन्त्री" (minister) in
        # "Iranian defense minister" from falsely marking it as Nepal-related.
        if self._has_strong_nepal_marker(text):
            return False

        # Keywords that indicate purely international content
        # These countries/topics when mentioned WITHOUT Nepal = exclude
        # NOTE: Don't use \b word boundaries for Devanagari - they don't work!
        international_only_patterns = [
            # India internal affairs (Nepali - NO word boundaries)
            r"भारतमा",  # "in India" - Nepal stories say "भारत" not "भारतमा"
            r"भारतको.{0,20}(?:सरकार|चुनाव|अर्थतन्त्र|बजेट)",  # India's govt/election/economy
            r"भारतीय.{0,20}(?:सरकार|चुनाव|बजेट)",  # Indian govt/election/budget
            # India internal affairs (English - can use word boundaries)
            r"\bindian (?:government|election|budget|economy|state)\b",
            r"\bmodi government\b",
            r"\bbjp\b",
            r"\blok sabha\b",
            r"\brajya sabha\b",
            r"\bnew delhi\b(?!.*nepal)",
            # Pakistan internal affairs
            r"पाकिस्तानमा",  # "in Pakistan"
            r"पाकिस्तानको.{0,20}(?:सरकार|सेना|आक्रमण)",
            r"\bpakistan (?:army|military|government)\b",
            r"\bbalochistan\b",
            r"\bkarachi\b(?!.*nepal)",
            r"\bislamabad\b(?!.*nepal)",
            # Japan internal affairs
            r"जापानमा.{0,20}(?:चुनाव|सरकार|प्रधानमन्त्री)",  # Japan's election/PM
            r"\bjapan(?:ese)? (?:election|parliament|pm|prime minister)\b",
            r"\btokyo\b(?!.*nepal|.*paudel|.*राष्ट्रपति)",
            # China internal affairs
            r"चीनमा.{0,20}(?:सरकार|अर्थतन्त्र)",
            r"\bbeijing\b(?!.*nepal)",
            r"\bchinese government\b(?!.*nepal)",
            # Bangladesh internal affairs
            r"बंगलादेशमा",
            r"\bdhaka\b(?!.*nepal)",

            # === Israel / Iran / Middle East conflicts ===
            # Nepali script (most Nepal media reports these in Nepali)
            r"इजरायल",   # Israel (any context)
            r"इरान",      # Iran (any context)
            r"गाजा",      # Gaza
            r"हमास",       # Hamas
            r"हिजबुल्लाह",  # Hezbollah
            r"नेतान्याहु",   # Netanyahu
            r"खामेनी",     # Khamenei
            r"तेहरान",     # Tehran
            r"तेल अभिभ",  # Tel Aviv
            r"पेलेस्टाइन",  # Palestine
            r"फलस्तिन",   # Palestine (alt)
            r"वेस्ट बैंक",  # West Bank
            r"लेबनान",     # Lebanon
            r"बैरुत",      # Beirut
            r"सिरिया",     # Syria
            r"यमन",       # Yemen
            r"हुथी",       # Houthi
            r"आइएस",      # IS/ISIS
            r"इस्लामिक स्टेट",  # Islamic State
            # English
            r"\bisrael\b(?!.*nepal)",
            r"\biran\b(?!.*nepal)",
            r"\bgaza\b",
            r"\bhamas\b",
            r"\bhezbollah\b",
            r"\bnetanyahu\b",
            r"\bkhamenei\b",
            r"\btehran\b",
            r"\btel aviv\b",
            r"\bpalestine\b",
            r"\bwest bank\b",
            r"\blebanon\b",
            r"\bbeirut\b",
            r"\bsyria\b",
            r"\byemen\b",
            r"\bhouthi\b",

            # === Russia / Ukraine conflict ===
            r"रुसमा",      # "in Russia"
            r"रुसको",      # "Russia's"
            r"युक्रेन",    # Ukraine
            r"जेलेन्स्की",  # Zelensky
            r"क्रेमलिन",   # Kremlin
            r"\bruss(?:ia|ian)\b(?!.*nepal)",
            r"\bukrain\b",
            r"\bzelensky\b",
            r"\bkyiv\b",
            r"\bmoscow\b(?!.*nepal)",

            # === Other international (generic) ===
            r"अमेरिकामा",   # "in America"
            r"अमेरिकाको",   # "America's"
            r"बेलायतमा",    # "in UK"
            r"फ्रान्समा",    # "in France"
            r"जर्मनीमा",    # "in Germany"
            r"अफगानिस्तान", # Afghanistan
            r"तालिबान",     # Taliban
            r"म्यान्मार",   # Myanmar

            # Other purely international (English)
            r"\bwhite house\b",
            r"\btrump administration\b",
            r"\bbiden administration\b",
            r"\bkremlin\b",
            r"\bputin\b(?!.*nepal)",
            r"\bafghanistan\b(?!.*nepal)",
            r"\btaliban\b",
            r"\bmyanmar\b(?!.*nepal)",

            # === Additional international (Nepali script) ===
            r"बोलिभिया",     # Bolivia
            r"ब्राजिल",      # Brazil
            r"मेक्सिको",     # Mexico
            r"अर्जेन्टिना",  # Argentina
            r"कोलम्बिया",    # Colombia
            r"दक्षिण कोरिया(?:मा|को)", # South Korea internal
            r"उत्तर कोरिया",  # North Korea
            r"क्युबा",       # Cuba
            r"भेनेजुएला",    # Venezuela
            r"सोमालिया",     # Somalia
            r"इथियोपिया",    # Ethiopia
            r"सुडान",        # Sudan
            r"लिबिया",       # Libya
            r"इराक",         # Iraq

            # Trump as subject (without Nepal context)
            r"ट्रम्पले",     # "Trump did..."
            r"ट्रम्पको",     # "Trump's..."
            r"\btrump\b(?!.*nepal)",

            # Additional English
            r"\bbolivia\b",
            r"\bbrazil\b(?!.*nepal)",
            r"\bmexico\b(?!.*nepal)",
            r"\bcolombia\b(?!.*nepal)",
            r"\bvenezuela\b",
            r"\bnorth korea\b",
            r"\biraq\b(?!.*nepal)",
        ]

        text_lower = text.lower()

        for pattern in international_only_patterns:
            try:
                if re.search(pattern, text_lower, re.IGNORECASE):
                    # Double-check: Nepal SPECIFICALLY mentioned?
                    # Use strong markers to avoid generic false positives
                    if not self._has_strong_nepal_marker(text):
                        return True
            except re.error:
                continue

        return False

    def _classify_category(self, text: str) -> Optional[StoryCategory]:
        """
        Classify story into one of 5 categories.

        Categories are checked in priority order:
        1. disaster (urgent/safety)
        2. security (urgent/safety)
        3. political
        4. economic
        5. social

        Supports both English (with word boundaries) and Nepali keywords.
        Returns the first matching category or None if no match.
        """
        # Priority order for checking
        priority_order = [
            StoryCategory.DISASTER,
            StoryCategory.SECURITY,
            StoryCategory.POLITICAL,
            StoryCategory.ECONOMIC,
            StoryCategory.SOCIAL,
        ]

        category_scores: dict[StoryCategory, int] = {}

        for category in priority_order:
            score = 0

            # Check English keywords (with word boundary patterns)
            patterns = self._category_patterns_en.get(category, [])
            for pattern in patterns:
                if pattern.search(text):
                    score += 1
                    if score >= 3:  # Strong match
                        break

            # Check Nepali keywords (simple substring match)
            if score < 3:
                ne_keywords = self._category_keywords_ne.get(category, [])
                for keyword in ne_keywords:
                    if keyword in text:
                        score += 1
                        if score >= 3:  # Strong match
                            break

            if score > 0:
                category_scores[category] = score

        if not category_scores:
            # FALLBACK: Default to "social" when no keywords match
            # This ensures every story has a category (no None values)
            return StoryCategory.SOCIAL

        # Return category with highest score
        return max(category_scores.keys(), key=lambda c: category_scores[c])

    def classify_category_only(
        self,
        title: str,
        content: Optional[str],
    ) -> Optional[StoryCategory]:
        """
        Classify story category without relevance check.

        Useful for stories already known to be Nepal-relevant.
        """
        text = f"{title} {content or ''}".lower()
        return self._classify_category(text)

    def is_nepal_relevant(
        self,
        title: str,
        content: Optional[str],
        source_id: str,
    ) -> bool:
        """Quick check if story is Nepal-relevant."""
        result = self.classify(title, content, source_id)
        return result.level in (RelevanceLevel.NEPAL_DOMESTIC, RelevanceLevel.NEPAL_NEIGHBOR)
