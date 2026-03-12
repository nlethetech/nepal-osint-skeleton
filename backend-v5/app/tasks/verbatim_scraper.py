"""Verbatim PDF scraper and speech parser.

Scrapes parliamentary verbatim PDFs from hr.parliament.gov.np,
extracts text, and parses individual speeches.

Speech pattern: (HH:MM बजे)माननीय Name (Party):- speech text...
Chair pattern: सम्माननीय अध्यक्ष:-माननीय सदस्य...
"""
import re
import ssl
import logging
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

# Nepali months for BS date parsing
NEPALI_MONTHS = {
    "बैशाख": 1, "जेठ": 2, "असार": 3, "श्रावण": 4, "साउन": 4,
    "भदौ": 5, "भाद्र": 5, "असोज": 6, "कार्तिक": 7, "मंसिर": 8,
    "माघ": 9, "फागुन": 10, "फाल्गुन": 10, "चैत": 11, "चैत्र": 11,
    "पुष": 12, "पौष": 12,
}

PARLIAMENT_BASE = "https://na.parliament.gov.np"

# Speech extraction regex — flexible to handle both clean and garbled Unicode
# Pattern 1: Clean text (National Assembly PDFs)
#   (13:24 बजे)माननीय श्री Name (Party):-
# Pattern 2: Garbled PyPDF2 text (HoR PDFs)
#   (१३:२३ बजे) माननीय Įी Name (Party):-
SPEECH_PATTERN = re.compile(
    r'\(([०-९\d]{1,2}[:\uff1a][०-९\d]{2})\s*बजे\)'   # (HH:MM बजे) - supports Nepali & ASCII digits
    r'\s*'
    r'(?:माननीय|सम्माननीय)'                             # Title (honorific)
    r'([^(]{1,150}?)'                                     # Name + any garbled chars (up to 150) - CAPTURED
    r'\(([^)]{2,200})\)'                                  # (Party) - 2-200 chars
    r'\s*:?-?\s*',                                        # :- separator
    re.UNICODE
)

# Alternate pattern for when Devanagari is really garbled
SPEECH_PATTERN_ALT = re.compile(
    r'\(([०-९\d]{1,2}[:\uff1a][०-९\d]{2})\s*बजे\)'
    r'(.{1,300}?)'
    r'\(([^)]{2,200})\)'
    r'\s*:?-?',
    re.UNICODE
)

# Chair interjection pattern — matches both garbled and clean OCR text
CHAIR_PATTERN = re.compile(
    r'(?:सम्माननीय|स[àa-z]*माननीय)\s*(?:अध्यक्ष|अÚय¢)|'
    r'^अध्यक्ष\s*[:：]',  # Clean OCR: name starts with "अध्यक्ष:"
    re.UNICODE
)


async def fetch_verbatim_listing(
    start_date: str = "2025-01-01",
    end_date: str = "2026-12-31",
) -> list[dict]:
    """Fetch list of verbatim PDFs from parliament website.

    Returns list of dicts with: title_ne, pdf_url, date_str
    """
    url = f"{PARLIAMENT_BASE}/np/verbatims"
    params = {"start_date": start_date, "end_date": end_date}

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    async with httpx.AsyncClient(verify=ssl_ctx, timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()

    html = resp.text
    results = []

    # Parse table rows: <tr> with date | title | PDF link
    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.DOTALL)
        if len(cells) < 2:
            continue

        # Extract PDF link
        links = re.findall(r'href="([^"]*\.pdf[^"]*)"', row)
        if not links:
            continue

        # Clean cell text
        cells_clean = [re.sub(r'<[^>]+>', '', c).strip() for c in cells]

        # Skip header row
        if cells_clean[0] == "क्र.स.":
            continue

        date_str = cells_clean[1] if len(cells_clean) > 1 else ""
        title_ne = cells_clean[2] if len(cells_clean) > 2 else ""

        results.append({
            "title_ne": title_ne,
            "pdf_url": links[0],
            "date_str": date_str,
        })

    logger.info(f"Found {len(results)} verbatim PDFs")
    return results


def parse_ad_date(date_str: str) -> Optional[date]:
    """Parse AD date string like '2025-01-26' to date object."""
    try:
        return date.fromisoformat(date_str.strip())
    except (ValueError, AttributeError):
        return None


def extract_session_info(title: str) -> dict:
    """Extract session/meeting numbers from Nepali title.

    Example: "सत्रौँ अधिवेशन_कार्यवाहीको सम्पूर्ण विवरण_२४ माघ २०८१ (बैठक सङ्ख्या- ३)"
    """
    info = {"session_no": None, "meeting_no": None, "session_date_bs": None}

    # Session number ordinals
    ordinals = {
        "पहिलो": 1, "दोस्रो": 2, "तेस्रो": 3, "चौथो": 4, "पाँचौँ": 5,
        "छैठौँ": 6, "सातौँ": 7, "आठौँ": 8, "नवौँ": 9, "दशौँ": 10,
        "एघारौँ": 11, "बाह्रौँ": 12, "तेह्रौँ": 13, "चौधौँ": 14,
        "पन्ध्रौँ": 15, "सोह्रौँ": 16, "सत्रौँ": 17, "अठारौँ": 18,
        "उन्नाइसौँ": 19, "बीसौँ": 20,
    }
    for word, num in ordinals.items():
        if word in title:
            info["session_no"] = num
            break

    # Meeting number: बैठक सङ्ख्या- ३ or (बैठक सङ्ख्या- १२)
    meeting_match = re.search(r'बैठक\s*सङ्?ख्या-?\s*(\d+)', title)
    if not meeting_match:
        # Try Nepali digits
        nep_match = re.search(r'बैठक\s*सङ्?ख्या-?\s*([०-९]+)', title)
        if nep_match:
            nep_digits = nep_match.group(1)
            info["meeting_no"] = int(nep_digits.translate(
                str.maketrans("०१२३४५६७८९", "0123456789")
            ))
    else:
        info["meeting_no"] = int(meeting_match.group(1))

    # BS date extraction: "२४ माघ २०८१"
    bs_match = re.search(r'([०-९\d]+)\s+(\S+)\s+([०-९\d]{4})', title)
    if bs_match:
        info["session_date_bs"] = bs_match.group(0)

    return info


async def download_pdf(pdf_url: str) -> bytes:
    """Download a PDF file, handling SSL issues."""
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    async with httpx.AsyncClient(verify=ssl_ctx, timeout=120.0) as client:
        resp = await client.get(pdf_url)
        resp.raise_for_status()
        return resp.content


def _is_garbled(text: str) -> bool:
    """Check if extracted text has mojibake (garbled Unicode from legacy fonts).

    Nepal parliament PDFs often produce text with valid Devanagari mixed with
    Latin Extended-B chars (ǒ,Ǔ,ƶ,Û,ȣ,Ĥ,Į etc.) that indicate mojibake.
    We check for these specific corruption markers rather than Devanagari ratio.
    """
    if not text or len(text.strip()) < 50:
        return True
    # Sample a chunk to check for mojibake markers
    sample = text[:5000]
    # Latin Extended-B (U+0180-U+024F) and Latin Extended Additional (U+1E00-U+1EFF)
    # These should NOT appear in clean Nepali text
    mojibake_count = sum(
        1 for c in sample
        if (0x0180 <= ord(c) <= 0x024F) or  # ǒ,Ǔ,ƶ,ȣ,Ĥ,Į,ĩ etc.
           (0x1E00 <= ord(c) <= 0x1EFF) or  # Latin Extended Additional
           ord(c) in (0x00D7, 0x00DB, 0x00C9, 0x00CF, 0x00CC)  # ×,Û,É,Ï,Ì
    )
    total_alpha = sum(1 for c in sample if c.isalpha())
    if total_alpha == 0:
        return True
    mojibake_ratio = mojibake_count / total_alpha
    logger.info(f"  Mojibake markers: {mojibake_count} in {total_alpha} alpha chars ({mojibake_ratio:.1%})")
    # Even 1% mojibake chars = garbled (clean text has 0%)
    return mojibake_ratio > 0.005


def _extract_text_direct(pdf_bytes: bytes) -> str:
    """Fast text extraction via PyMuPDF (fitz) or PyPDF2."""
    try:
        import fitz  # PyMuPDF
        import io
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = [page.get_text() or "" for page in doc]
        doc.close()
        return "\n\n".join(pages)
    except ImportError:
        pass

    try:
        from PyPDF2 import PdfReader
        import io
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages)
    except ImportError:
        pass

    return ""


def _extract_text_ocr(pdf_bytes: bytes, lang: str = "nep+hin", dpi: int = 300) -> str:
    """OCR-based extraction for non-Unicode Nepali PDFs using Tesseract.

    Renders each page to an image via PyMuPDF, then runs Tesseract OCR.
    Gives ~99.8% accuracy on Nepali text vs garbled output from direct extraction.
    """
    import fitz  # PyMuPDF
    import pytesseract
    from PIL import Image
    import io

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    all_pages = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        text = pytesseract.image_to_string(
            img, lang=lang,
            config="--psm 6 --oem 1",  # Block of text, LSTM engine
        )
        all_pages.append(text)
        if page_num % 10 == 0:
            logger.info(f"  OCR page {page_num + 1}/{len(doc)}")

    doc.close()
    return "\n\n".join(all_pages)


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF — tries direct extraction first, falls back to OCR.

    Nepal parliament PDFs often use legacy non-Unicode Devanagari fonts that
    produce garbled text with direct extraction. OCR via Tesseract gives clean output.
    """
    # Stage 1: Try fast direct extraction
    text = _extract_text_direct(pdf_bytes)
    if text and not _is_garbled(text):
        logger.info("  Direct extraction OK — clean Devanagari text")
        return text

    # Stage 2: Fall back to OCR
    logger.info("  Direct extraction garbled — falling back to Tesseract OCR")
    try:
        ocr_text = _extract_text_ocr(pdf_bytes)
        if ocr_text and len(ocr_text.strip()) > 50:
            return ocr_text
        logger.warning("  OCR returned empty/short text, using direct extraction")
    except Exception as e:
        logger.warning(f"  OCR failed ({e}), using direct extraction")

    return text  # Fall back to garbled text if OCR not available


def parse_speeches(raw_text: str) -> list[dict]:
    """Parse individual speeches from verbatim text.

    Returns list of dicts with: speaker_name_ne, speaker_party_ne,
    speaker_role, timestamp, speech_text, speech_order
    """
    speeches = []

    # Try primary pattern first
    matches = list(SPEECH_PATTERN.finditer(raw_text))

    # Fall back to alternate pattern if primary finds nothing
    if not matches:
        matches = list(SPEECH_PATTERN_ALT.finditer(raw_text))

    if not matches:
        logger.warning("No speech patterns found in text")
        return speeches

    for i, match in enumerate(matches):
        groups = match.groups()
        timestamp = groups[0]

        if len(groups) == 3:
            # Primary pattern: timestamp, name_blob, party
            name_blob = groups[1].strip()
            party = groups[2].strip()
        else:
            # Alt pattern: timestamp, party only
            name_blob = ""
            party = groups[1].strip() if len(groups) > 1 else ""

        # Clean name: remove honorifics and garbled chars
        name = name_blob
        # Remove common prefixes
        for prefix in ["माननीय", "सम्माननीय", "श्री", "Įी", "Ĥ"]:
            name = name.replace(prefix, "")
        name = re.sub(r'^\s*[:\-]+\s*', '', name)
        name = name.strip()

        # If name is empty or too short, skip (likely a chair interjection)
        if len(name) < 2:
            name = name_blob.strip()

        # Clean party name: remove newlines, excess whitespace
        party = re.sub(r'\s+', ' ', party).strip()

        # Truncate to fit varchar(255) - leave room
        name = name[:200]
        party = party[:200]

        # Text starts after this match, ends at next match or end
        text_start = match.end()
        text_end = matches[i + 1].start() if i + 1 < len(matches) else len(raw_text)
        speech_text = raw_text[text_start:text_end].strip()

        # Clean up: remove page numbers, headers
        speech_text = re.sub(r'\n\s*\d+\s*\n', '\n', speech_text)

        if not speech_text or len(speech_text) < 10:
            continue

        # Determine role
        is_chair = bool(CHAIR_PATTERN.search(name_blob))
        role = "सम्माननीय अध्यक्ष" if is_chair else "माननीय"

        speeches.append({
            "speaker_name_ne": name[:250],
            "speaker_party_ne": party[:250] if not is_chair else None,
            "speaker_role": role,
            "timestamp": timestamp,
            "speech_text": speech_text,
            "word_count": len(speech_text.split()),
            "speech_order": i,
        })

    logger.info(f"Parsed {len(speeches)} speeches from verbatim text")
    return speeches


# ── Party normalization ──────────────────────────────────────
# Garbled PDF text produces many mojibake variants of the same party.
# We match by keyword fragments that survive the corruption.
# Each entry: (keyword_fragments, clean_nepali, english)
# Order matters — most specific first.
PARTY_RULES: list[tuple[list[str], str, str]] = [
    # Maoist Center: माओवाद is the most reliable surviving fragment
    (["माओवाद"], "नेपाल कम्युनिष्ट पार्टी (माओवादी केन्द्र)", "Nepal Communist Party (Maoist Center)"),
    # Unified Socialist: एकȧक or एकीकृत + समाजवाद
    (["एक", "समाजवाद"], "नेपाल कम्युनिष्ट पार्टी (एकीकृत समाजवादी)", "Communist Party of Nepal (Unified Socialist)"),
    # UML: एमाले
    (["एमाले"], "नेपाल कम्युनिष्ट पार्टी (एमाले)", "Nepal Communist Party (UML)"),
    (["UML"], "नेपाल कम्युनिष्ट पार्टी (एमाले)", "Nepal Communist Party (UML)"),
    # Nepali Congress: काँग्रेस or काँĒेस or काÌĒेस or कांग्रेस
    (["काँग्रेस"], "नेपाली काँग्रेस", "Nepali Congress"),
    (["कांग्रेस"], "नेपाली काँग्रेस", "Nepali Congress"),
    (["काँĒेस"], "नेपाली काँग्रेस", "Nepali Congress"),
    (["काÌĒेस"], "नेपाली काँग्रेस", "Nepali Congress"),
    # Rastriya Janamorcha: जनमोचा or जनमोर्चा
    (["जनमोचा"], "राष्ट्रिय जनमोर्चा", "Rastriya Janamorcha"),
    (["जनमोर्चा"], "राष्ट्रिय जनमोर्चा", "Rastriya Janamorcha"),
    # Loktantrik Samajwadi: लोकता + समाजवाद (before Janata to avoid clash)
    (["लोकता", "समाजवाद"], "लोकतान्त्रिक समाजवादी पार्टी, नेपाल", "Loktantrik Samajwadi Party Nepal"),
    # Janata Samajbadi: जनता + (समाज or स माज with broken space)
    (["जनता", "समाज"], "जनता समाजवादी पार्टी नेपाल", "Janata Samajbadi Party Nepal"),
    (["जनता", "स माज"], "जनता समाजवादी पार्टी नेपाल", "Janata Samajbadi Party Nepal"),
    # Rastriya Swotantra Party
    (["स्वतन्त्र"], "राष्ट्रिय स्वतन्त्र पार्टी", "Rastriya Swotantra Party"),
    (["èवतÛğ"], "राष्ट्रिय स्वतन्त्र पार्टी", "Rastriya Swotantra Party"),
    # Rastriya Prajatantra Party
    (["प्रजातन्त्र"], "राष्ट्रिय प्रजातन्त्र पार्टी", "Rastriya Prajatantra Party"),
    # Nominated members
    (["मनोनीत"], "मनोनीत", "Nominated"),
    (["मनो"], "मनोनीत", "Nominated"),
    # Janamat Party
    (["जनमत"], "जनमत पार्टी", "Janamat Party"),
    # Nagarik Unmukti
    (["उन्मुक्ति"], "नागरिक उन्मुक्ति पार्टी", "Nagarik Unmukti Party"),
    # Nepal Workers Peasants Party
    (["मजदुर", "किसान"], "नेपाल मजदुर किसान पार्टी", "Nepal Workers Peasants Party"),
]

# Fragments that indicate a misparse (not a real party name)
INVALID_PARTY_FRAGMENTS = ["संशोधन", "बजे", "ǐरमा", "गरिमा", "ग ǐरमा"]


def normalize_party(raw: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Normalize garbled party name → (clean_nepali, english).

    Returns (None, None) for invalid/misparse entries.
    """
    if not raw:
        return None, None

    cleaned = re.sub(r'\s+', ' ', raw).strip().rstrip('[').strip()
    if not cleaned:
        return None, None

    # Reject misparses
    for frag in INVALID_PARTY_FRAGMENTS:
        if frag in cleaned:
            return None, None

    # Match by keyword fragments
    for fragments, ne, en in PARTY_RULES:
        if all(f in cleaned for f in fragments):
            return ne, en

    # No match — return cleaned original with no English
    return cleaned, None


def translate_party(party_ne: Optional[str]) -> Optional[str]:
    """Translate Nepali party name to English (backward-compatible wrapper)."""
    _, en = normalize_party(party_ne)
    return en
