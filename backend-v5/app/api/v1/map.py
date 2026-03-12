"""Unified Map API - Live situation map data for Nepal OSINT.

Provides real-time map events combining:
- Disaster incidents (fires, floods, landslides, etc.) from BIPAD
- Disaster alerts (earthquakes, early warnings) from BIPAD
- River monitoring stations (water levels, flood warnings)
- News stories with location data

Returns data in GeoJSON-like format for the LiveUAMap frontend component.

GEOLOCATION SYSTEM:
- Palantir-grade geographic entity resolution
- Supports English and Nepali district names (77 districts)
- Handles Nepali grammatical suffixes (मा, को, ले, बाट, etc.)
- City/alias resolution (Biratnagar → Morang)
- Constituency extraction (Kathmandu-1, काठमाडौं-१)
- Coordinate jittering to prevent marker stacking
"""
import logging
import re
import random
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.curfew_alert import get_province_for_district
from app.models.disaster import DisasterIncident, DisasterAlert
from app.models.river import RiverStation, RiverReading
from app.models.story import Story
from app.models.story_feature import StoryFeature
from app.models.tactical_enrichment import TacticalEnrichment
from app.data.municipality_coordinates import MUNICIPALITY_COORDINATES, NEPALI_MUNICIPALITIES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/map", tags=["Map"])


# =============================================================================
# HAZARD TO CATEGORY MAPPING
# =============================================================================

HAZARD_TO_CATEGORY: Dict[str, str] = {
    "flood": "DISASTER",
    "landslide": "DISASTER",
    "earthquake": "DISASTER",
    "fire": "DISASTER",
    "lightning": "DISASTER",
    "drought": "DISASTER",
    "avalanche": "DISASTER",
    "windstorm": "DISASTER",
    "cold_wave": "DISASTER",
    "epidemic": "DISASTER",
    "other": "DISASTER",
}


# =============================================================================
# NEPAL DISTRICT COORDINATES - Complete 77 Districts with Province Info
# =============================================================================

DISTRICT_COORDINATES: Dict[str, Tuple[float, float]] = {
    # Province 1 (Koshi)
    "taplejung": (27.3509, 87.6691), "panchthar": (27.1297, 87.7939),
    "ilam": (26.9108, 87.9264), "jhapa": (26.5455, 87.8942),
    "morang": (26.6583, 87.4667), "sunsari": (26.6333, 87.1667),
    "dhankuta": (26.9833, 87.3333), "terhathum": (27.1167, 87.5500),
    "sankhuwasabha": (27.3667, 87.2333), "bhojpur": (27.1667, 87.0500),
    "solukhumbu": (27.7903, 86.6600), "okhaldhunga": (27.3167, 86.5000),
    "khotang": (27.0167, 86.8500), "udayapur": (26.9333, 86.5167),
    # Province 2 (Madhesh)
    "saptari": (26.6333, 86.7333), "siraha": (26.6500, 86.2000),
    "dhanusha": (26.8167, 85.9333), "mahottari": (26.8500, 85.7833),
    "sarlahi": (26.9667, 85.5667), "rautahat": (27.0000, 85.3000),
    "bara": (27.0833, 85.0667), "parsa": (27.1333, 84.8500),
    # Province 3 (Bagmati)
    "dolakha": (27.7167, 86.0667), "sindhupalchok": (27.9500, 85.6833),
    "rasuwa": (28.1000, 85.2833), "dhading": (27.9000, 84.9167),
    "nuwakot": (27.9167, 85.1667), "kathmandu": (27.7172, 85.3240),
    "bhaktapur": (27.6710, 85.4298), "lalitpur": (27.6588, 85.3247),
    "kavrepalanchok": (27.5500, 85.5500), "ramechhap": (27.3167, 86.0833),
    "sindhuli": (27.2500, 85.9667), "makwanpur": (27.4167, 85.0333),
    "chitwan": (27.5291, 84.3542),
    # Province 4 (Gandaki)
    "gorkha": (28.0000, 84.6333), "lamjung": (28.2833, 84.3500),
    "tanahun": (27.9333, 84.2333), "kaski": (28.2096, 83.9856),
    "manang": (28.6667, 84.0167), "mustang": (28.9833, 83.8500),
    "myagdi": (28.4833, 83.4833), "parbat": (28.2000, 83.6833),
    "baglung": (28.2667, 83.5833), "syangja": (28.0833, 83.8667),
    "nawalpur": (27.6500, 84.1167), "nawalparasi_east": (27.6500, 84.1167),
    # Province 5 (Lumbini)
    "rupandehi": (27.5000, 83.4333), "kapilvastu": (27.5500, 83.0667),
    "arghakhanchi": (27.9333, 83.1333), "gulmi": (28.0833, 83.2667),
    "palpa": (27.8667, 83.5333), "dang": (28.1167, 82.3000),
    "pyuthan": (28.1000, 82.8667), "rolpa": (28.3333, 82.6500),
    "rukum_east": (28.6000, 82.6167), "banke": (28.0500, 81.6333),
    "bardiya": (28.3667, 81.3500), "nawalparasi_west": (27.6333, 83.6667),
    # Province 6 (Karnali)
    "dolpa": (29.0000, 82.8667), "mugu": (29.5000, 82.1000),
    "humla": (29.9667, 81.8500), "jumla": (29.2833, 82.1833),
    "kalikot": (29.1500, 81.6167), "dailekh": (28.8500, 81.7167),
    "jajarkot": (28.7000, 82.2000), "rukum_west": (28.6333, 82.4500),
    "salyan": (28.3833, 82.1167), "surkhet": (28.6000, 81.6167),
    # Province 7 (Sudurpashchim)
    "bajura": (29.4500, 81.3833), "bajhang": (29.5333, 81.1833),
    "achham": (29.0500, 81.2333), "doti": (29.2500, 80.9667),
    "kailali": (28.8333, 80.5500), "kanchanpur": (28.8500, 80.3333),
    "dadeldhura": (29.3000, 80.5833), "baitadi": (29.5333, 80.4167),
    "darchula": (29.8500, 80.5500),
}

# Province aliases and representative districts for province-level fallback geolocation.
PROVINCE_ALIASES: Dict[str, str] = {
    "1": "Koshi",
    "province 1": "Koshi",
    "koshi": "Koshi",
    "2": "Madhesh",
    "province 2": "Madhesh",
    "madhesh": "Madhesh",
    "madhes": "Madhesh",
    "3": "Bagmati",
    "province 3": "Bagmati",
    "bagmati": "Bagmati",
    "4": "Gandaki",
    "province 4": "Gandaki",
    "gandaki": "Gandaki",
    "5": "Lumbini",
    "province 5": "Lumbini",
    "lumbini": "Lumbini",
    "6": "Karnali",
    "province 6": "Karnali",
    "karnali": "Karnali",
    "7": "Sudurpashchim",
    "province 7": "Sudurpashchim",
    "sudurpashchim": "Sudurpashchim",
    "sudurpaschim": "Sudurpashchim",
}

PROVINCE_FALLBACK_DISTRICT: Dict[str, str] = {
    "Koshi": "morang",
    "Madhesh": "dhanusha",
    "Bagmati": "kathmandu",
    "Gandaki": "kaski",
    "Lumbini": "rupandehi",
    "Karnali": "surkhet",
    "Sudurpashchim": "kailali",
}

# City/Town to District mapping (aliases)
CITY_TO_DISTRICT: Dict[str, str] = {
    # Major cities
    "pokhara": "kaski", "biratnagar": "morang", "birgunj": "parsa",
    "bharatpur": "chitwan", "dharan": "sunsari", "butwal": "rupandehi",
    "hetauda": "makwanpur", "nepalgunj": "banke", "itahari": "sunsari",
    "janakpur": "dhanusha", "siddharthanagar": "rupandehi",
    "tulsipur": "dang", "ghorahi": "dang", "dhangadhi": "kailali",
    "mahendranagar": "kanchanpur", "ratnanagar": "chitwan",
    "lahan": "siraha", "rajbiraj": "saptari", "gaur": "rautahat",
    "kalaiya": "bara", "malangwa": "sarlahi", "damak": "jhapa",
    "birtamod": "jhapa", "mechinagar": "jhapa", "urlabari": "morang",
    "banepa": "kavrepalanchok", "dhulikhel": "kavrepalanchok",
    "tansen": "palpa", "baglung": "baglung", "beni": "myagdi",
    "jomsom": "mustang", "chame": "manang", "namche": "solukhumbu",
    "lukla": "solukhumbu", "jumla": "jumla", "simikot": "humla",
    # Kathmandu Valley areas
    "patan": "lalitpur", "thimi": "bhaktapur", "kirtipur": "kathmandu",
    "budhanilkantha": "kathmandu", "tokha": "kathmandu",
    "chandragiri": "kathmandu", "nagarjun": "kathmandu",
    "gokarneshwor": "kathmandu", "kageshwori": "kathmandu",
    "tarkeshwor": "kathmandu", "dakshinkali": "kathmandu",
    "godawari": "lalitpur", "lubhu": "lalitpur", "imadol": "lalitpur",
    "madhyapur": "bhaktapur", "suryabinayak": "bhaktapur",
    "changunarayan": "bhaktapur",
    # Municipalities (common in BIPAD data)
    "kathmandu metropolitan": "kathmandu",
    "lalitpur metropolitan": "lalitpur",
    "pokhara metropolitan": "kaski",
    "bharatpur metropolitan": "chitwan",
    "biratnagar metropolitan": "morang",
    "birgunj metropolitan": "parsa",
    "buddhabhumi": "kapilvastu",
    "sukhipur": "siraha",
    "golbazar": "siraha",
    "lalbandi": "sarlahi",
    "malangawa": "sarlahi",
    "hariwan": "sarlahi",
    "ishworpur": "sarlahi",
    "bagmati": "sarlahi",
    "chandranagar": "rautahat",
    "gaur": "rautahat",
    "brindaban": "rautahat",
    "devahi gonahi": "rautahat",
    "garuda": "rautahat",
    "katahariya": "rautahat",
    "madhav narayan": "rautahat",
    "maulapur": "rautahat",
    "paroha": "rautahat",
    "phatuwa bijayapur": "rautahat",
    "rajpur": "rautahat",
    "baragadhi": "bara",
    "jeetpur simara": "bara",
    "kolhabi": "bara",
    "mahagadhimai": "bara",
    "nijgadh": "bara",
    "parwanipur": "bara",
    "prasauni": "bara",
    "simraungadh": "bara",
    "suwarna": "bara",
    "birganj": "parsa",
    "pokhariya": "parsa",
    "parsagadhi": "parsa",
    "thori": "parsa",
    "sakhuwa prasauni": "parsa",
    # More municipalities from BIPAD data
    "belbari": "morang",
    "madi": "chitwan",  # Madi Municipality in Chitwan
    "jitpur simara": "bara",
    "jitpur": "bara",
    "simara": "bara",
    "chandrapur": "rautahat",
    "marsyangdi": "lamjung",
    "haripur": "sarlahi",
    "ratuwamai": "morang",
    "urlabari": "morang",
    "sundarharaincha": "morang",
    "letang": "morang",
    "kerabari": "morang",
    "gramthan": "morang",
    "dhanpalthan": "morang",
    "kanepokhari": "morang",
    "miklajung": "morang",
    "budhiganga": "morang",
    "jahada": "morang",
    "koshi": "morang",
}

# Nepali to English district mapping (comprehensive)
NEPALI_DISTRICTS: Dict[str, str] = {
    # Province 1
    "ताप्लेजुङ": "taplejung", "पाँचथर": "panchthar", "इलाम": "ilam",
    "झापा": "jhapa", "मोरङ": "morang", "सुनसरी": "sunsari",
    "धनकुटा": "dhankuta", "तेह्रथुम": "terhathum", "संखुवासभा": "sankhuwasabha",
    "भोजपुर": "bhojpur", "सोलुखुम्बु": "solukhumbu", "ओखलढुङ्गा": "okhaldhunga",
    "खोटाङ": "khotang", "उदयपुर": "udayapur",
    # Province 2
    "सप्तरी": "saptari", "सिराहा": "siraha", "धनुषा": "dhanusha",
    "महोत्तरी": "mahottari", "सर्लाही": "sarlahi", "रौतहट": "rautahat",
    "बारा": "bara", "पर्सा": "parsa",
    # Province 3
    "दोलखा": "dolakha", "सिन्धुपाल्चोक": "sindhupalchok", "रसुवा": "rasuwa",
    "धादिङ": "dhading", "नुवाकोट": "nuwakot", "काठमाडौं": "kathmandu",
    "काठमाण्डौ": "kathmandu", "काठमाण्डू": "kathmandu",
    "भक्तपुर": "bhaktapur", "ललितपुर": "lalitpur", "काभ्रे": "kavrepalanchok",
    "काभ्रेपलाञ्चोक": "kavrepalanchok", "रामेछाप": "ramechhap",
    "सिन्धुली": "sindhuli", "मकवानपुर": "makwanpur", "चितवन": "chitwan",
    # Province 4
    "गोरखा": "gorkha", "लमजुङ": "lamjung", "तनहुँ": "tanahun",
    "कास्की": "kaski", "मनाङ": "manang", "मुस्ताङ": "mustang",
    "म्याग्दी": "myagdi", "पर्वत": "parbat", "बागलुङ": "baglung",
    "स्याङ्जा": "syangja", "नवलपुर": "nawalpur",
    # Province 5
    "रुपन्देही": "rupandehi", "कपिलवस्तु": "kapilvastu",
    "अर्घाखाँची": "arghakhanchi", "गुल्मी": "gulmi", "पाल्पा": "palpa",
    "दाङ": "dang", "प्युठान": "pyuthan", "रोल्पा": "rolpa",
    "रुकुम": "rukum_east", "बाँके": "banke", "बर्दिया": "bardiya",
    # Province 6
    "डोल्पा": "dolpa", "मुगु": "mugu", "हुम्ला": "humla", "जुम्ला": "jumla",
    "कालिकोट": "kalikot", "दैलेख": "dailekh", "जाजरकोट": "jajarkot",
    "सल्यान": "salyan", "सुर्खेत": "surkhet",
    # Province 7
    "बाजुरा": "bajura", "बझाङ": "bajhang", "अछाम": "achham",
    "डोटी": "doti", "कैलाली": "kailali", "कञ्चनपुर": "kanchanpur",
    "डडेल्धुरा": "dadeldhura", "बैतडी": "baitadi", "दार्चुला": "darchula",
    # Cities (Nepali)
    "पोखरा": "kaski", "विराटनगर": "morang", "वीरगञ्ज": "parsa",
    "भरतपुर": "chitwan", "धरान": "sunsari", "बुटवल": "rupandehi",
    "हेटौडा": "makwanpur", "नेपालगञ्ज": "banke", "इटहरी": "sunsari",
    "जनकपुर": "dhanusha", "धनगढी": "kailali", "महेन्द्रनगर": "kanchanpur",
}

# Nepali grammatical suffixes (sorted by length for proper matching)
NEPALI_SUFFIXES = [
    "हरूमा", "हरुमा", "हरूको", "हरुको", "हरूले", "हरुले",  # Plural + case
    "बाट", "मा", "को", "ले", "लाई", "सँग", "देखि",  # Case markers
]

# Source name to district mapping for regional news sources
# This provides location fallback when article text doesn't have explicit location
SOURCE_TO_DISTRICT: Dict[str, str] = {
    # Ratopati regional editions
    "ratopati gandaki": "kaski",
    "ratopati bagmati": "kathmandu",
    "ratopati lumbini": "rupandehi",
    "ratopati koshi": "morang",
    "ratopati madhesh": "dhanusha",
    "ratopati sudurpashchim": "kailali",
    "ratopati karnali": "surkhet",
    # Other regional sources
    "himalayan times": "kathmandu",
    "kathmandu post": "kathmandu",
    "the kathmandu post": "kathmandu",
    "rising nepal": "kathmandu",
    "the rising nepal": "kathmandu",
    "kantipur": "kathmandu",
    "kantipur tv": "kathmandu",
    "nagarik": "kathmandu",
    "republica": "kathmandu",
    "onlinekhabar": "kathmandu",
    "setopati": "kathmandu",
    "ekantipur": "kathmandu",
    # Provincial papers
    "gorkhapatra": "kathmandu",
}

# Province seat counts for constituency validation
CONSTITUENCY_SEATS: Dict[str, int] = {
    "taplejung": 1, "panchthar": 2, "ilam": 3, "jhapa": 8, "morang": 10,
    "sunsari": 6, "dhankuta": 2, "terhathum": 1, "sankhuwasabha": 2,
    "bhojpur": 2, "solukhumbu": 1, "okhaldhunga": 2, "khotang": 3,
    "udayapur": 3, "saptari": 5, "siraha": 5, "dhanusha": 6,
    "mahottari": 5, "sarlahi": 5, "rautahat": 5, "bara": 5, "parsa": 5,
    "dolakha": 2, "sindhupalchok": 3, "rasuwa": 1, "dhading": 3,
    "nuwakot": 3, "kathmandu": 10, "bhaktapur": 3, "lalitpur": 4,
    "kavrepalanchok": 4, "ramechhap": 2, "sindhuli": 3, "makwanpur": 4,
    "chitwan": 5, "gorkha": 3, "lamjung": 2, "tanahun": 3, "kaski": 4,
    "manang": 1, "mustang": 1, "myagdi": 1, "parbat": 2, "baglung": 3,
    "syangja": 3, "nawalpur": 2, "rupandehi": 6, "kapilvastu": 4,
    "arghakhanchi": 2, "gulmi": 2, "palpa": 3, "dang": 4, "pyuthan": 2,
    "rolpa": 2, "rukum_east": 1, "banke": 4, "bardiya": 3, "dolpa": 1,
    "mugu": 1, "humla": 1, "jumla": 1, "kalikot": 2, "dailekh": 3,
    "jajarkot": 2, "rukum_west": 1, "salyan": 2, "surkhet": 3,
    "bajura": 2, "bajhang": 2, "achham": 3, "doti": 2, "kailali": 5,
    "kanchanpur": 3, "dadeldhura": 2, "baitadi": 3, "darchula": 1,
}


# =============================================================================
# GEOLOCATION HELPER FUNCTIONS
# =============================================================================

def strip_nepali_suffix(text: str) -> str:
    """Remove Nepali grammatical suffixes from text."""
    for suffix in NEPALI_SUFFIXES:
        if text.endswith(suffix):
            return text[:-len(suffix)]
    return text


def jitter_coordinates(lat: float, lng: float, seed: Optional[str] = None) -> Tuple[float, float]:
    """Add small random offset to prevent marker stacking.

    Uses deterministic jitter based on seed for consistency.
    Offset range: ±0.015 degrees (~1.5km)
    """
    if seed:
        random.seed(hash(seed) % (2**32))
    offset_lat = random.uniform(-0.015, 0.015)
    offset_lng = random.uniform(-0.015, 0.015)
    return (lat + offset_lat, lng + offset_lng)


def jitter_coordinates_fine(lat: float, lng: float, seed: Optional[str] = None) -> Tuple[float, float]:
    """Fine jitter for municipality-level precision (~300m)."""
    if seed:
        random.seed(hash(seed) % (2**32))
    offset_lat = random.uniform(-0.003, 0.003)
    offset_lng = random.uniform(-0.003, 0.003)
    return (lat + offset_lat, lng + offset_lng)


def resolve_municipality(text: str) -> Optional[tuple[str, float, float, str]]:
    """Try to resolve text to a known municipality.

    Returns (municipality_name, lat, lng, district) or None.
    """
    if not text:
        return None
    text_lower = text.lower().strip()

    # Direct match
    if text_lower in MUNICIPALITY_COORDINATES:
        lat, lng, district = MUNICIPALITY_COORDINATES[text_lower]
        return (text_lower, lat, lng, district)

    # Nepali match
    for nepali, eng in NEPALI_MUNICIPALITIES.items():
        if nepali in text:
            if eng in MUNICIPALITY_COORDINATES:
                lat, lng, district = MUNICIPALITY_COORDINATES[eng]
                return (eng, lat, lng, district)

    # Partial match
    for muni, (lat, lng, district) in MUNICIPALITY_COORDINATES.items():
        if muni in text_lower or text_lower in muni:
            return (muni, lat, lng, district)

    return None


def extract_constituency(text: str) -> Optional[Tuple[str, int]]:
    """Extract constituency from text (e.g., 'Kathmandu-1', 'काठमाडौं-२').

    Returns tuple of (district, seat_number) or None.
    """
    # English pattern: District-N or District N
    eng_pattern = r'\b([a-zA-Z]+)[\s-](\d+)\b'
    eng_match = re.search(eng_pattern, text, re.IGNORECASE)
    if eng_match:
        district = eng_match.group(1).lower()
        seat = int(eng_match.group(2))
        if district in DISTRICT_COORDINATES:
            max_seats = CONSTITUENCY_SEATS.get(district, 10)
            if 1 <= seat <= max_seats:
                return (district, seat)

    # Nepali pattern: district-N with Nepali numerals
    nepali_nums = {'०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9}
    for nepali_name, eng_name in NEPALI_DISTRICTS.items():
        if nepali_name in text:
            # Look for number after district name
            idx = text.find(nepali_name)
            after = text[idx + len(nepali_name):idx + len(nepali_name) + 5]
            # Try Nepali numerals
            num_str = ""
            for char in after:
                if char in nepali_nums:
                    num_str += str(nepali_nums[char])
                elif char.isdigit():
                    num_str += char
                elif char in ['-', ' ']:
                    continue
                else:
                    break
            if num_str:
                seat = int(num_str)
                max_seats = CONSTITUENCY_SEATS.get(eng_name, 10)
                if 1 <= seat <= max_seats:
                    return (eng_name, seat)

    return None


def resolve_district(name: str) -> Optional[str]:
    """Resolve a location name to a district.

    Handles:
    - Direct district names (English)
    - Nepali district names with suffix stripping
    - City/town aliases
    - Partial matches
    """
    if not name:
        return None

    name_lower = name.lower().strip()
    name_stripped = strip_nepali_suffix(name)

    # 1. Direct match (English)
    if name_lower in DISTRICT_COORDINATES:
        return name_lower

    # 2. City alias
    if name_lower in CITY_TO_DISTRICT:
        return CITY_TO_DISTRICT[name_lower]

    # 3. Nepali district (with suffix stripped)
    if name_stripped in NEPALI_DISTRICTS:
        return NEPALI_DISTRICTS[name_stripped]
    if name in NEPALI_DISTRICTS:
        return NEPALI_DISTRICTS[name]

    # 4. Partial match on district names
    for district in DISTRICT_COORDINATES:
        if district in name_lower or name_lower in district:
            return district

    # 5. Partial match on city names
    for city, district in CITY_TO_DISTRICT.items():
        if city in name_lower or name_lower in city:
            return district

    return None


def extract_location_from_text(
    title: str,
    summary: Optional[str] = None,
    content: Optional[str] = None,
    entities: Optional[List[str]] = None,
) -> Optional[Tuple[str, Tuple[float, float]]]:
    """Extract location from text using multi-level search.

    Priority:
    1. Constituency mentions (most specific)
    2. Nepali district names in title
    3. English district names in title
    4. City names in title
    5. Same patterns in summary
    6. Same patterns in content
    7. Entity list

    Returns tuple of (district_name, (lat, lng)) or None.
    Does NOT fall back to Kathmandu - returns None if no location found.
    """
    texts = [
        ("title", title or ""),
        ("summary", summary or ""),
        ("content", (content or "")[:2000]),  # Limit content search
    ]

    for source, text in texts:
        if not text:
            continue

        # 1. Try constituency extraction first (most specific)
        constituency = extract_constituency(text)
        if constituency:
            district, seat = constituency
            coords = DISTRICT_COORDINATES.get(district)
            if coords:
                # Jitter based on seat number for spread
                jittered = jitter_coordinates(coords[0], coords[1], f"{district}-{seat}")
                return (district.title(), jittered)

        # 2. Nepali district names (with suffix handling)
        for nepali_name, eng_name in NEPALI_DISTRICTS.items():
            # Check with common suffixes
            for suffix in ["", "मा", "को", "ले", "बाट"]:
                if nepali_name + suffix in text:
                    coords = DISTRICT_COORDINATES.get(eng_name)
                    if coords:
                        jittered = jitter_coordinates(coords[0], coords[1], f"{eng_name}-{text[:20]}")
                        return (eng_name.title(), jittered)

        # 3. English district names
        text_lower = text.lower()
        for district in sorted(DISTRICT_COORDINATES.keys(), key=len, reverse=True):
            # Use word boundary to avoid partial matches
            pattern = r'\b' + re.escape(district) + r'\b'
            if re.search(pattern, text_lower):
                coords = DISTRICT_COORDINATES[district]
                jittered = jitter_coordinates(coords[0], coords[1], f"{district}-{text[:20]}")
                return (district.title(), jittered)

        # 4. City aliases
        for city, district in sorted(CITY_TO_DISTRICT.items(), key=lambda x: len(x[0]), reverse=True):
            pattern = r'\b' + re.escape(city) + r'\b'
            if re.search(pattern, text_lower):
                coords = DISTRICT_COORDINATES.get(district)
                if coords:
                    jittered = jitter_coordinates(coords[0], coords[1], f"{city}-{text[:20]}")
                    return (district.title(), jittered)

    # 5. Check entities if provided
    if entities:
        for entity in entities:
            district = resolve_district(entity)
            if district:
                coords = DISTRICT_COORDINATES.get(district)
                if coords:
                    jittered = jitter_coordinates(coords[0], coords[1], f"{district}-entity")
                    return (district.title(), jittered)

    return None


def get_coordinates_for_district(district: Optional[str]) -> Optional[Tuple[float, float]]:
    """Get coordinates for a district name (English or Nepali)."""
    if not district:
        return None

    resolved = resolve_district(district)
    if resolved and resolved in DISTRICT_COORDINATES:
        return DISTRICT_COORDINATES[resolved]

    return None


def to_display_district(district: Optional[str]) -> Optional[str]:
    """Normalize district label for API responses (e.g., underscores -> spaces)."""
    if not district:
        return None
    resolved = resolve_district(district)
    canonical = resolved if resolved else district.strip().lower().replace(" ", "_")
    return canonical.replace("_", " ").title()


def normalize_province_name(province: Any) -> Optional[str]:
    """Normalize province to canonical English name."""
    if province is None:
        return None
    key = str(province).strip().lower()
    if not key:
        return None
    return PROVINCE_ALIASES.get(key)


def get_coordinates_for_province(province: Any) -> Optional[Tuple[float, float]]:
    """Get representative coordinates for a province."""
    normalized_province = normalize_province_name(province)
    if not normalized_province:
        return None

    fallback_district = PROVINCE_FALLBACK_DISTRICT.get(normalized_province)
    if not fallback_district:
        return None

    return DISTRICT_COORDINATES.get(fallback_district)


# =============================================================================
# SCHEMAS (GeoJSON-like format for frontend)
# =============================================================================

class MapFeatureProperties(BaseModel):
    """Properties for a map feature."""
    id: str
    title: str
    category: str  # DISASTER, SECURITY, POLITICAL, ECONOMIC, SOCIAL, etc.
    severity: str  # CRITICAL, HIGH, MEDIUM, LOW
    timestamp: datetime
    district: Optional[str] = None
    province: Optional[int] = None
    source_count: int = 1
    summary: Optional[str] = None
    story_type: Optional[str] = None
    confidence: float = 0.8
    is_consolidated: bool = False
    source_url: Optional[str] = None
    # Clustering fields for story grouping
    cluster_id: Optional[str] = None
    source_name: Optional[str] = None
    # Tactical enrichment fields
    tactical_type: Optional[str] = None
    tactical_context: Optional[str] = None
    municipality: Optional[str] = None
    # Extra fields
    magnitude: Optional[float] = None
    deaths: Optional[int] = None
    injured: Optional[int] = None
    water_level: Optional[float] = None
    status: Optional[str] = None


class MapFeatureGeometry(BaseModel):
    """Geometry for a map feature."""
    type: str = "Point"
    coordinates: List[float]  # [lng, lat]


class MapFeature(BaseModel):
    """GeoJSON-like feature for the map."""
    type: str = "Feature"
    properties: MapFeatureProperties
    geometry: MapFeatureGeometry


class MapEventsResponse(BaseModel):
    """GeoJSON-like response for map events."""
    type: str = "FeatureCollection"
    features: List[MapFeature]
    total: int
    time_range: dict


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def severity_from_incident(incident: DisasterIncident) -> str:
    """Convert incident to severity level."""
    if incident.deaths and incident.deaths >= 5:
        return "CRITICAL"
    if incident.deaths and incident.deaths >= 1:
        return "HIGH"
    if incident.severity == "critical":
        return "CRITICAL"
    if incident.severity == "high":
        return "HIGH"
    if incident.severity == "medium":
        return "MEDIUM"
    return "LOW"


def severity_from_alert(alert: DisasterAlert) -> str:
    """Convert alert level to severity."""
    if alert.magnitude and alert.magnitude >= 5.5:
        return "CRITICAL"
    if alert.magnitude and alert.magnitude >= 4.5:
        return "HIGH"
    if alert.alert_level == "critical":
        return "CRITICAL"
    if alert.alert_level in ("high", "danger"):
        return "HIGH"
    if alert.alert_level in ("medium", "warning", "watch"):
        return "MEDIUM"
    return "LOW"


def category_from_story(category: Optional[str]) -> str:
    """Map story category to map category."""
    mapping = {
        "political": "POLITICAL",
        "economic": "ECONOMIC",
        "security": "SECURITY",
        "disaster": "DISASTER",
        "social": "SOCIAL",
    }
    return mapping.get(category or "", "GENERAL")


def severity_from_story(severity: Optional[str]) -> str:
    """Map story severity to display severity."""
    mapping = {
        "critical": "CRITICAL",
        "high": "HIGH",
        "medium": "MEDIUM",
        "low": "LOW",
    }
    return mapping.get(severity or "", "MEDIUM")


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.get("/events", response_model=MapEventsResponse)
async def get_map_events(
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(500, ge=1, le=2000, description="Maximum events"),
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    severities: Optional[str] = Query(None, description="Comma-separated severities"),
    districts: Optional[str] = Query(None, description="Comma-separated districts"),
    include_disasters: bool = Query(True, description="Include BIPAD disasters"),
    include_alerts: bool = Query(True, description="Include BIPAD alerts"),
    include_rivers: bool = Query(True, description="Include river stations"),
    include_news: bool = Query(True, description="Include news stories"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get real-time map events for the situation map.

    Combines BIPAD disasters, alerts, river stations, and news stories
    into a unified GeoJSON-like feed for the LiveUAMap component.
    """
    features: List[MapFeature] = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Parse filters
    category_filter = set(categories.upper().split(",")) if categories else None
    severity_filter = set(severities.upper().split(",")) if severities else None
    district_filter: Optional[set[str]] = None
    selected_province_filter: Optional[set[str]] = None
    if districts:
        district_filter = set()
        selected_province_filter = set()
        for district_token in districts.split(","):
            token = district_token.strip()
            if not token:
                continue
            resolved = resolve_district(token)
            normalized_district = resolved or token.lower().replace("_", " ")
            district_filter.add(normalized_district)

            province = get_province_for_district(normalized_district)
            normalized_province = normalize_province_name(province)
            if normalized_province:
                selected_province_filter.add(normalized_province)

    def _matches_geo_filter(
        district_name: Optional[str],
        province_candidates: Optional[List[Any]] = None,
    ) -> bool:
        """Match either district or province against selected province-based filter."""
        if not district_filter:
            return True

        normalized_district = resolve_district(district_name) if district_name else None
        if normalized_district and normalized_district in district_filter:
            return True

        if not selected_province_filter:
            return False

        provinces_to_check: set[str] = set()
        if normalized_district:
            district_province = normalize_province_name(get_province_for_district(normalized_district))
            if district_province:
                provinces_to_check.add(district_province)

        for candidate in province_candidates or []:
            normalized_candidate = normalize_province_name(candidate)
            if normalized_candidate:
                provinces_to_check.add(normalized_candidate)

        return bool(provinces_to_check & selected_province_filter)

    # ---------------------------------------------------------------------------
    # DISASTER INCIDENTS FROM BIPAD
    # ---------------------------------------------------------------------------
    if include_disasters:
        query = select(DisasterIncident).where(
            and_(
                DisasterIncident.latitude.isnot(None),
                DisasterIncident.longitude.isnot(None),
                DisasterIncident.incident_on >= cutoff,
            )
        ).order_by(DisasterIncident.incident_on.desc()).limit(limit)

        result = await db.execute(query)
        incidents = result.scalars().all()

        for inc in incidents:
            severity = severity_from_incident(inc)
            category = "DISASTER"

            if category_filter and category not in category_filter:
                continue
            if severity_filter and severity not in severity_filter:
                continue

            # Try to extract district from title if not provided by BIPAD
            district = inc.district
            if not district and inc.title:
                location_result = extract_location_from_text(inc.title)
                if location_result:
                    district = location_result[0]

            district = to_display_district(district)

            if not _matches_geo_filter(district_name=district, province_candidates=[inc.province]):
                continue

            # Build informative summary
            summary_parts = [(inc.hazard_type or 'Incident').title()]
            if district:
                summary_parts.append(district)
            elif inc.street_address:
                summary_parts.append(inc.street_address[:50])
            else:
                summary_parts.append('Nepal')
            if inc.deaths:
                summary_parts.append(f"{inc.deaths} dead")
            if inc.injured:
                summary_parts.append(f"{inc.injured} injured")

            features.append(MapFeature(
                properties=MapFeatureProperties(
                    id=f"incident_{inc.id}",
                    title=inc.title or f"{inc.hazard_type} incident",
                    category=category,
                    severity=severity,
                    timestamp=inc.incident_on or inc.created_at,
                    district=district,
                    province=inc.province,
                    source_count=1,
                    summary=" - ".join(summary_parts[:3]),
                    story_type=inc.hazard_type,
                    confidence=0.95 if inc.verified else 0.8,
                    is_consolidated=False,
                    deaths=inc.deaths,
                    injured=inc.injured,
                ),
                geometry=MapFeatureGeometry(
                    coordinates=[inc.longitude, inc.latitude]
                ),
            ))

    # ---------------------------------------------------------------------------
    # DISASTER ALERTS (Earthquakes, Warnings) FROM BIPAD
    # Only include alerts within the time window - old earthquakes are historical
    # ---------------------------------------------------------------------------
    if include_alerts:
        query = select(DisasterAlert).where(
            and_(
                DisasterAlert.latitude.isnot(None),
                DisasterAlert.longitude.isnot(None),
                DisasterAlert.issued_at >= cutoff,  # Only recent alerts
            )
        ).order_by(DisasterAlert.issued_at.desc()).limit(limit)

        result = await db.execute(query)
        alerts = result.scalars().all()

        for alert in alerts:
            severity = severity_from_alert(alert)
            category = "DISASTER"

            if category_filter and category not in category_filter:
                continue
            if severity_filter and severity not in severity_filter:
                continue

            summary = alert.title
            if alert.magnitude:
                summary = f"M{alert.magnitude} Earthquake - {alert.location_name or alert.district or 'Nepal'}"

            alert_district = to_display_district(alert.district)

            if not _matches_geo_filter(district_name=alert_district, province_candidates=[alert.province]):
                continue

            features.append(MapFeature(
                properties=MapFeatureProperties(
                    id=f"alert_{alert.id}",
                    title=alert.title or f"{alert.alert_type} alert",
                    category=category,
                    severity=severity,
                    timestamp=alert.issued_at or alert.created_at,
                    district=alert_district,
                    province=alert.province,
                    source_count=1,
                    summary=summary,
                    story_type=alert.alert_type,
                    confidence=0.99,
                    is_consolidated=False,
                    magnitude=alert.magnitude,
                ),
                geometry=MapFeatureGeometry(
                    coordinates=[alert.longitude, alert.latitude]
                ),
            ))

    # ---------------------------------------------------------------------------
    # RIVER STATIONS WITH WARNING/DANGER STATUS
    # ---------------------------------------------------------------------------
    if include_rivers:
        query = select(RiverStation).where(
            and_(
                RiverStation.latitude.isnot(None),
                RiverStation.longitude.isnot(None),
                RiverStation.is_active == True,
            )
        ).limit(200)

        result = await db.execute(query)
        stations = result.scalars().all()

        # Batch-fetch latest reading per station using window function (1 query instead of N)
        latest_sq = (
            select(
                RiverReading.station_id,
                RiverReading.water_level,
                RiverReading.status,
                RiverReading.reading_at,
                func.row_number().over(
                    partition_by=RiverReading.station_id,
                    order_by=RiverReading.reading_at.desc()
                ).label('rn')
            )
            .where(
                RiverReading.reading_at >= cutoff,
                RiverReading.water_level >= -2.0,
                RiverReading.water_level <= 200.0,
            )
            .subquery()
        )

        latest_readings_query = (
            select(latest_sq)
            .where(latest_sq.c.rn == 1)
        )
        latest_result = await db.execute(latest_readings_query)
        readings_map = {
            row.station_id: row
            for row in latest_result.all()
        }

        for station in stations:
            reading = readings_map.get(station.id)
            status = reading.status if reading else "BELOW WARNING LEVEL"

            # Only include WARNING or DANGER stations
            if status not in ("WARNING", "DANGER"):
                continue

            severity = "CRITICAL" if status == "DANGER" else "HIGH"

            if severity_filter and severity not in severity_filter:
                continue

            features.append(MapFeature(
                properties=MapFeatureProperties(
                    id=f"river_{station.id}",
                    title=f"⚠️ {station.title}",
                    category="DISASTER",
                    severity=severity,
                    timestamp=reading.reading_at if reading else station.updated_at,
                    source_count=1,
                    summary=f"Water Level: {reading.water_level:.2f}m - {status}",
                    story_type="flood_warning",
                    confidence=0.99,
                    is_consolidated=False,
                    water_level=reading.water_level if reading else None,
                    status=status,
                ),
                geometry=MapFeatureGeometry(
                    coordinates=[station.longitude, station.latitude]
                ),
            ))

    # ---------------------------------------------------------------------------
    # NEWS STORIES WITH LOCATION DATA (Enhanced Palantir-grade geolocation)
    # ---------------------------------------------------------------------------
    if include_news:
        # Bulk-load tactical enrichments for the time window
        tactical_map: Dict[str, TacticalEnrichment] = {}
        try:
            tactical_result = await db.execute(
                select(TacticalEnrichment).where(
                    TacticalEnrichment.enriched_at >= cutoff
                )
            )
            tactical_map = {
                str(t.story_id): t for t in tactical_result.scalars().all()
            }
        except Exception:
            logger.debug("tactical_enrichments table not available yet")

        # Get stories with their features and cluster info
        query = select(Story).options(
            selectinload(Story.features),
            selectinload(Story.cluster),
        ).where(
            and_(
                or_(
                    Story.published_at >= cutoff,
                    and_(
                        Story.published_at.is_(None),
                        Story.created_at >= cutoff,
                    ),
                ),
                Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
            )
        ).order_by(
            func.coalesce(Story.published_at, Story.created_at).desc()
        ).limit(limit)

        result = await db.execute(query)
        all_stories = result.scalars().all()

        # Deduplicate by cluster_id: keep one representative story per cluster.
        # Pick the story with highest severity or most recent timestamp.
        _severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        seen_clusters: dict[str, bool] = {}
        stories = []
        # Map cluster_id -> source_count for later use
        cluster_source_counts: dict[str, int] = {}
        for s in all_stories:
            cid = str(s.cluster_id) if s.cluster_id else None
            if cid:
                if cid in seen_clusters:
                    continue
                seen_clusters[cid] = True
                if s.cluster and s.cluster.source_count:
                    cluster_source_counts[cid] = s.cluster.source_count
            stories.append(s)

        for story in stories:
            category = category_from_story(story.category)
            severity = severity_from_story(story.severity)

            if category_filter and category not in category_filter:
                continue
            if severity_filter and severity not in severity_filter:
                continue

            # Enhanced multi-level location extraction
            coordinates = None
            district = None

            # Priority 1: Use pre-extracted features from StoryFeature table
            if story.features:
                # Check title_district first (most reliable)
                if story.features.title_district:
                    district = to_display_district(story.features.title_district)
                    coords = get_coordinates_for_district(district)
                    if coords:
                        # Jitter to prevent stacking
                        jittered = jitter_coordinates(coords[0], coords[1], str(story.id))
                        coordinates = [jittered[1], jittered[0]]  # [lng, lat]

                # Check districts array from features
                if not coordinates and story.features.districts:
                    for d in story.features.districts:
                        coords = get_coordinates_for_district(d)
                        if coords:
                            district = to_display_district(d)
                            jittered = jitter_coordinates(coords[0], coords[1], str(story.id))
                            coordinates = [jittered[1], jittered[0]]
                            break

                # Check constituencies
                if not coordinates and story.features.constituencies:
                    for c in story.features.constituencies:
                        # Parse constituency like "kathmandu-1"
                        parts = c.lower().replace(" ", "-").split("-")
                        if len(parts) >= 1:
                            dist = parts[0]
                            coords = get_coordinates_for_district(dist)
                            if coords:
                                district = to_display_district(dist)
                                # Use constituency as seed for jitter
                                jittered = jitter_coordinates(coords[0], coords[1], c)
                                coordinates = [jittered[1], jittered[0]]
                                break

            # Priority 1.5: Use tactical enrichment coordinates (municipality-level precision)
            tactical = tactical_map.get(str(story.id))
            if not coordinates and tactical and tactical.latitude and tactical.longitude:
                jittered = jitter_coordinates_fine(tactical.latitude, tactical.longitude, str(story.id))
                coordinates = [jittered[1], jittered[0]]
                if tactical.municipality:
                    district = tactical.municipality.replace("_", " ").title()

            # Priority 2: Enhanced text extraction using multi-level search
            if not coordinates and story.districts:
                for raw_district in story.districts:
                    if not isinstance(raw_district, str) or not raw_district.strip():
                        continue
                    coords = get_coordinates_for_district(raw_district)
                    if coords:
                        district = to_display_district(raw_district)
                        jittered = jitter_coordinates(coords[0], coords[1], str(story.id))
                        coordinates = [jittered[1], jittered[0]]
                        break

            # Priority 3: Enhanced text extraction using multi-level search
            if not coordinates:
                # Get entities from key_terms if available
                entities = None
                if story.features and story.features.key_terms:
                    entities = story.features.key_terms

                # Use enhanced extraction that handles Nepali, cities, constituencies
                location_result = extract_location_from_text(
                    title=story.title,
                    summary=story.summary,
                    content=story.content[:3000] if story.content else None,
                    entities=entities,
                )

                if location_result:
                    district, (lat, lng) = location_result
                    coordinates = [lng, lat]  # GeoJSON format [lng, lat]

            # Priority 4: Infer from source name (regional news sources)
            if not coordinates and story.source_name:
                source_lower = story.source_name.lower()
                for source_pattern, source_district in SOURCE_TO_DISTRICT.items():
                    if source_pattern in source_lower:
                        coords = DISTRICT_COORDINATES.get(source_district)
                        if coords:
                            district = to_display_district(source_district)
                            jittered = jitter_coordinates(coords[0], coords[1], str(story.id))
                            coordinates = [jittered[1], jittered[0]]
                            break

            # Priority 5: Province-level fallback when district extraction is unavailable.
            if not coordinates and story.provinces:
                for raw_province in story.provinces:
                    normalized_province = normalize_province_name(raw_province)
                    if not normalized_province:
                        continue
                    coords = get_coordinates_for_province(normalized_province)
                    if coords:
                        representative_district = PROVINCE_FALLBACK_DISTRICT.get(normalized_province)
                        district = to_display_district(representative_district) if representative_district else None
                        jittered = jitter_coordinates(coords[0], coords[1], str(story.id))
                        coordinates = [jittered[1], jittered[0]]
                        break

            # Priority 6: Default to Kathmandu for Nepal domestic news (capital city)
            # This ensures all Nepal news appears on the map with clustering
            if not coordinates and story.nepal_relevance == "NEPAL_DOMESTIC":
                coords = DISTRICT_COORDINATES["kathmandu"]
                district = "Kathmandu"
                jittered = jitter_coordinates(coords[0], coords[1], str(story.id))
                coordinates = [jittered[1], jittered[0]]

            # Skip only if truly no location can be determined
            if not coordinates:
                continue

            if not _matches_geo_filter(district_name=district, province_candidates=story.provinces):
                continue

            # Truncate summary smartly (at word boundary)
            summary_text = None
            if story.summary:
                if len(story.summary) <= 250:
                    summary_text = story.summary
                else:
                    # Truncate at word boundary
                    truncated = story.summary[:250]
                    last_space = truncated.rfind(' ')
                    if last_space > 150:
                        summary_text = truncated[:last_space] + "..."
                    else:
                        summary_text = truncated + "..."

            features.append(MapFeature(
                properties=MapFeatureProperties(
                    id=f"story_{story.id}",
                    title=story.title,
                    category=category,
                    severity=severity,
                    timestamp=story.published_at or story.created_at,
                    district=district,
                    source_count=cluster_source_counts.get(str(story.cluster_id), 1) if story.cluster_id else 1,
                    summary=summary_text,
                    story_type=story.category,
                    confidence=0.75 if story.features and story.features.title_district else 0.6,
                    is_consolidated=bool(story.cluster_id and cluster_source_counts.get(str(story.cluster_id), 1) > 1),
                    source_url=story.url,
                    cluster_id=str(story.cluster_id) if story.cluster_id else None,
                    source_name=story.source_name,
                    tactical_type=tactical.tactical_type if tactical else None,
                    tactical_context=tactical.tactical_context if tactical else None,
                    municipality=tactical.municipality if tactical else None,
                ),
                geometry=MapFeatureGeometry(
                    coordinates=coordinates
                ),
            ))

    # Sort: tactical-enriched stories first, then by timestamp (most recent first).
    # This prevents tactical markers from being pushed out by the limit during high volume.
    features.sort(
        key=lambda f: (
            1 if f.properties.tactical_type else 0,  # tactical first (higher = first with reverse)
            f.properties.timestamp,
        ),
        reverse=True,
    )

    # Apply limit
    features = features[:limit]

    return MapEventsResponse(
        features=features,
        total=len(features),
        time_range={
            "start": cutoff.isoformat(),
            "end": datetime.now(timezone.utc).isoformat(),
            "hours": hours,
        }
    )


@router.get("/stats")
async def get_map_stats(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Get statistics for map data."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Count incidents by type
    incident_query = select(
        DisasterIncident.hazard_type,
        func.count(DisasterIncident.id)
    ).where(
        DisasterIncident.incident_on >= cutoff
    ).group_by(DisasterIncident.hazard_type)

    incident_result = await db.execute(incident_query)
    incidents_by_type = {row[0]: row[1] for row in incident_result.fetchall()}

    # Count alerts by type
    alert_query = select(
        DisasterAlert.alert_type,
        func.count(DisasterAlert.id)
    ).where(
        or_(
            DisasterAlert.issued_at >= cutoff,
            DisasterAlert.is_active == True,
        )
    ).group_by(DisasterAlert.alert_type)

    alert_result = await db.execute(alert_query)
    alerts_by_type = {row[0]: row[1] for row in alert_result.fetchall()}

    # Count stories by category
    story_query = select(
        Story.category,
        func.count(Story.id)
    ).where(
        and_(
            or_(
                Story.published_at >= cutoff,
                and_(
                    Story.published_at.is_(None),
                    Story.created_at >= cutoff,
                ),
            ),
            Story.nepal_relevance.in_(["NEPAL_DOMESTIC", "NEPAL_NEIGHBOR"]),
        )
    ).group_by(Story.category)

    story_result = await db.execute(story_query)
    stories_by_category = {row[0]: row[1] for row in story_result.fetchall()}

    # River stations with warnings
    river_warning_count = 0  # Would need complex query to get actual count

    return {
        "incidents": {
            "total": sum(incidents_by_type.values()),
            "by_type": incidents_by_type,
        },
        "alerts": {
            "total": sum(alerts_by_type.values()),
            "by_type": alerts_by_type,
        },
        "stories": {
            "total": sum(stories_by_category.values()),
            "by_category": stories_by_category,
        },
        "river_warnings": river_warning_count,
        "time_range": {
            "start": cutoff.isoformat(),
            "end": datetime.now(timezone.utc).isoformat(),
        }
    }
