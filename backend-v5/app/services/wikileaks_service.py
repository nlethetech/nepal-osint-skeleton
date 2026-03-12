"""
WikiLeaks Search Service

Searches WikiLeaks for mentions of candidates in diplomatic cables and leaked documents.
Useful for enriching candidate profiles with international intelligence context.
"""
import asyncio
import hashlib
import re
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel


class WikiLeaksDocument(BaseModel):
    """A WikiLeaks document/cable mentioning a candidate."""

    title: str
    url: str
    collection: str  # e.g., "Cable gate", "GI Files", "PlusD"
    snippet: str  # Text snippet showing the match
    date_created: Optional[datetime] = None
    date_released: Optional[datetime] = None
    relevance_score: float = 0.0


class WikiLeaksSearchResult(BaseModel):
    """Search results from WikiLeaks."""

    candidate_name: str
    query: str
    documents: List[WikiLeaksDocument]
    total_results: int
    searched_at: datetime
    cache_hit: bool = False


# In-memory cache for WikiLeaks results (avoid hammering their servers)
_wikileaks_cache: Dict[str, tuple[WikiLeaksSearchResult, datetime]] = {}
CACHE_TTL = timedelta(hours=24)

# Mapping of Nepali names to English names for WikiLeaks search
# WikiLeaks documents are in English, so we need English names
NEPALI_TO_ENGLISH_NAMES: Dict[str, str] = {
    "के.पी शर्मा ओली": "KP Sharma Oli",
    "के.पी. शर्मा ओली": "KP Sharma Oli",
    "केपी शर्मा ओली": "KP Sharma Oli",
    "शेर बहादुर देउवा": "Sher Bahadur Deuba",
    "पुष्प कमल दाहाल": "Pushpa Kamal Dahal",
    "प्रचण्ड": "Prachanda",
    "माधव कुमार नेपाल": "Madhav Kumar Nepal",
    "झलनाथ खनाल": "Jhala Nath Khanal",
    "बाबुराम भट्टराई": "Baburam Bhattarai",
    "सुशील कोइराला": "Sushil Koirala",
    "गिरिजा प्रसाद कोइराला": "Girija Prasad Koirala",
    "विष्णु प्रसाद पौडेल": "Bishnu Prasad Poudel",
    "रवि लामिछाने": "Rabi Lamichhane",
    "वालेन्द्र शाह": "Balen Shah",
}


class WikiLeaksService:
    """Service for searching WikiLeaks for candidate mentions."""

    BASE_URL = "https://search.wikileaks.org/"
    TIMEOUT = 30.0  # seconds

    def __init__(self):
        self.client = httpx.AsyncClient(
            timeout=self.TIMEOUT,
            follow_redirects=True,
            headers={
                "User-Agent": "NARADA Intelligence Platform / Research",
                "Accept": "text/html,application/xhtml+xml",
            }
        )

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    def _is_nepali(self, text: str) -> bool:
        """Check if text contains Devanagari (Nepali) characters."""
        if not text:
            return False
        # Devanagari Unicode range: U+0900 to U+097F
        return any('\u0900' <= char <= '\u097F' for char in text)

    def _get_english_name(self, nepali_name: str) -> Optional[str]:
        """Convert Nepali name to English using mapping."""
        # Direct lookup
        if nepali_name in NEPALI_TO_ENGLISH_NAMES:
            return NEPALI_TO_ENGLISH_NAMES[nepali_name]

        # Try normalized (remove extra spaces)
        normalized = ' '.join(nepali_name.split())
        if normalized in NEPALI_TO_ENGLISH_NAMES:
            return NEPALI_TO_ENGLISH_NAMES[normalized]

        # Try partial matches (for names with slight variations)
        for nepali, english in NEPALI_TO_ENGLISH_NAMES.items():
            # Check if key is contained in the name or vice versa
            if nepali in nepali_name or nepali_name in nepali:
                return english

        return None

    def _get_cache_key(self, query: str) -> str:
        """Generate cache key for a query."""
        return hashlib.md5(query.lower().strip().encode()).hexdigest()

    def _check_cache(self, query: str) -> Optional[WikiLeaksSearchResult]:
        """Check if we have a cached result."""
        key = self._get_cache_key(query)
        if key in _wikileaks_cache:
            result, cached_at = _wikileaks_cache[key]
            if datetime.utcnow() - cached_at < CACHE_TTL:
                result.cache_hit = True
                return result
            else:
                # Expired
                del _wikileaks_cache[key]
        return None

    def _set_cache(self, query: str, result: WikiLeaksSearchResult):
        """Store result in cache."""
        key = self._get_cache_key(query)
        _wikileaks_cache[key] = (result, datetime.utcnow())

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse WikiLeaks date formats."""
        if not date_str:
            return None

        # Try various formats WikiLeaks uses
        formats = [
            "%Y-%m-%d",        # 2010-01-15 (most common in WikiLeaks)
            "%B %d, %Y",       # January 15, 2010
            "%b %d, %Y",       # Jan 15, 2010
            "%d %B %Y",        # 15 January 2010
            "%d %b %Y",        # 15 Jan 2010
            "%B %d %Y",        # January 15 2010 (no comma)
            "%b %d %Y",        # Jan 15 2010 (no comma)
            "%d/%m/%Y",        # 15/01/2010
            "%m/%d/%Y",        # 01/15/2010
        ]

        date_str = date_str.strip()
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue

        return None

    def _extract_collection(self, text: str) -> str:
        """Extract collection name from WikiLeaks result."""
        collections = {
            "cable": "Cable Gate",
            "plusd": "PlusD Public Library",
            "gifiles": "GI Files",
            "syria": "Syria Files",
            "tpp": "TPP",
            "ice": "ICE Patrol",
            "kissinger": "Kissinger Cables",
            "carter": "Carter Cables",
            "afghan": "Afghan War Diary",
            "iraq": "Iraq War Logs",
        }

        text_lower = text.lower()
        for key, name in collections.items():
            if key in text_lower:
                return name

        return "Unknown Collection"

    def _name_appears_in_text(self, candidate_name: str, text: str) -> bool:
        """Check if candidate name actually appears in text (strict matching)."""
        if not text:
            return False

        text_lower = text.lower()
        name_lower = candidate_name.lower()

        # Check full name
        if name_lower in text_lower:
            return True

        # Check if multiple name parts appear (surname is most important)
        # Include initials like "KP" (length >= 2)
        name_parts = [p.replace(".", "") for p in name_lower.split() if len(p.replace(".", "")) >= 2]
        if len(name_parts) >= 2:
            # Check if last name (surname) appears - this is most important
            surname = name_parts[-1]
            surname_match = surname in text_lower

            if surname_match:
                # Surname found, check if at least one other part appears
                other_matches = sum(1 for part in name_parts[:-1] if part in text_lower)
                if other_matches >= 1:
                    return True
                # Even just surname might be enough for well-known figures
                # But also check if title suggests the person (e.g., "MINISTER OLI")
                position_words = ["minister", "pm", "prime", "deputy", "leader", "chairman"]
                if any(word in text_lower for word in position_words):
                    return True

        # Check common name variations
        # e.g., "K.P. Sharma Oli" -> also check "KP Oli", "Oli"
        name_variations = self._get_name_variations(candidate_name)
        for variation in name_variations:
            if variation.lower() in text_lower:
                return True

        return False

    def _get_name_variations(self, name: str) -> List[str]:
        """Generate common variations of a name for searching.

        For "K.P. Sharma Oli" generates:
        - "KP Sharma Oli" (full name without periods)
        - "KP Oli" (first + last, most common reference)
        - "Oli" (last name, even if short like 3 chars)
        """
        variations = []
        parts = name.split()

        # Remove periods from initials: "K.P." -> "KP"
        no_periods = name.replace(".", "")
        if no_periods != name:
            variations.append(no_periods)

        # First + Last name WITH periods removed (most important!)
        # "K.P. Sharma Oli" -> "KP Oli"
        if len(parts) >= 2:
            first_part = parts[0].replace(".", "")
            last_part = parts[-1]
            short_name = f"{first_part} {last_part}"
            if short_name not in variations and short_name != no_periods:
                variations.append(short_name)

        # Last name only - include even short names like "Oli" (3 chars)
        # Many people are referred to by just their last name
        if parts and len(parts[-1]) >= 3:
            if parts[-1] not in variations:
                variations.append(parts[-1])

        # First + Last name only (with original formatting)
        if len(parts) >= 3:
            first_last = f"{parts[0]} {parts[-1]}"
            if first_last not in variations:
                variations.append(first_last)

        return variations

    async def search(
        self,
        candidate_name: str,
        candidate_name_ne: Optional[str] = None,
        max_results: int = 20,
    ) -> WikiLeaksSearchResult:
        """
        Search WikiLeaks for mentions of a candidate.

        Args:
            candidate_name: English name of the candidate (may actually be Nepali due to data issues)
            candidate_name_ne: Nepali name (optional, rarely in WikiLeaks)
            max_results: Maximum number of documents to return

        Returns:
            WikiLeaksSearchResult with matching documents (only those actually mentioning the candidate)
        """
        # Handle case where name_en is actually in Nepali (data quality issue)
        search_name = candidate_name
        if self._is_nepali(candidate_name):
            english_name = self._get_english_name(candidate_name)
            if english_name:
                search_name = english_name
                print(f"[WikiLeaks] Converted Nepali name '{candidate_name}' to English: '{search_name}'")
            else:
                # Can't search WikiLeaks with Nepali name
                print(f"[WikiLeaks] Warning: Name '{candidate_name}' is in Nepali with no English mapping")
                return WikiLeaksSearchResult(
                    candidate_name=candidate_name,
                    query="(Nepali name - no English mapping available)",
                    documents=[],
                    total_results=0,
                    searched_at=datetime.utcnow(),
                    cache_hit=False,
                )

        # Get name variations for searching
        variations = self._get_name_variations(search_name)

        # Build query string showing what we searched
        searched_terms = variations[:3] if variations else [search_name]
        query = " | ".join(f'"{t}"' for t in searched_terms)

        # Check cache first (use original name for cache key)
        cached = self._check_cache(candidate_name)
        if cached:
            return cached

        try:
            # Try multiple search strategies
            all_documents: List[WikiLeaksDocument] = []

            # Strategy 1: Try common variations FIRST (e.g., "KP Oli" before "K.P. Sharma Oli")
            # These are more likely to match WikiLeaks documents
            for variation in variations[:3]:  # Try top 3 variations
                if len(variation) >= 4:  # Only search if variation is meaningful
                    var_docs = await self._scrape_search_results(f'"{variation}"', max_results)
                    all_documents.extend(var_docs)
                    if len(all_documents) >= max_results:
                        break

            # Strategy 2: Try full name if variations didn't get enough results
            if len(all_documents) < 5:
                docs = await self._scrape_search_results(f'"{search_name}"', max_results * 2)
                all_documents.extend(docs)

            # Deduplicate by URL
            seen_urls = set()
            unique_docs = []
            for doc in all_documents:
                if doc.url not in seen_urls:
                    seen_urls.add(doc.url)
                    unique_docs.append(doc)

            # Calculate relevance and FILTER - only keep docs that actually mention the candidate
            # Use search_name (English) for relevance checking
            relevant_docs = []
            for doc in unique_docs:
                # Strict check: name must actually appear in title or snippet
                appears_in_title = self._name_appears_in_text(search_name, doc.title)
                appears_in_snippet = self._name_appears_in_text(search_name, doc.snippet)

                if appears_in_title or appears_in_snippet:
                    doc.relevance_score = self._calculate_relevance(
                        search_name, doc.title, doc.snippet
                    )
                    # Only include if relevance score is meaningful
                    if doc.relevance_score >= 0.5:
                        relevant_docs.append(doc)

            # Sort by relevance
            relevant_docs.sort(key=lambda d: d.relevance_score, reverse=True)

            result = WikiLeaksSearchResult(
                candidate_name=candidate_name,
                query=query,
                documents=relevant_docs[:max_results],
                total_results=len(relevant_docs),
                searched_at=datetime.utcnow(),
                cache_hit=False,
            )

            # Cache the result
            self._set_cache(candidate_name, result)

            return result

        except Exception as e:
            # Return empty result on error
            return WikiLeaksSearchResult(
                candidate_name=candidate_name,
                query=query,
                documents=[],
                total_results=0,
                searched_at=datetime.utcnow(),
                cache_hit=False,
            )

    async def _scrape_search_results(
        self,
        query: str,
        max_results: int,
    ) -> List[WikiLeaksDocument]:
        """Scrape WikiLeaks search page.

        WikiLeaks search (search.wikileaks.org) HTML structure:
        <div class="result">
          <div class="info">
            <h4><a href="...">TITLE</a></h4>
            <div class="excerpt">snippet with <b>highlighted</b> terms</div>
          </div>
          <div class="other-info">
            <div class="leak-label">
              <div><b>Plusd</b></div>
            </div>
          </div>
        </div>
        """
        documents = []

        # URL encode the query (remove quotes for URL)
        clean_query = query.strip('"')
        encoded_query = quote_plus(clean_query)
        url = f"{self.BASE_URL}?query={encoded_query}"

        try:
            response = await self.client.get(url)
            response.raise_for_status()

            html = response.text
            soup = BeautifulSoup(html, "html.parser")
            seen_urls = set()

            # Primary Strategy: Find <div class="result"> containers
            result_divs = soup.find_all("div", class_="result")

            for result_div in result_divs:
                if len(documents) >= max_results:
                    break

                # Find title link in h4
                h4 = result_div.find("h4")
                if not h4:
                    continue

                link = h4.find("a", href=True)
                if not link:
                    continue

                href = link.get("href", "")
                title = link.get_text(strip=True)

                if not href or not title or len(title) < 10:
                    continue

                # Only include document links
                doc_patterns = ["/plusd/", "/cable/", "/gifiles/", "/sony/",
                               "/hackingteam/", "/bnd-nsa/", "/saudi-cables/"]
                if not any(pattern in href.lower() for pattern in doc_patterns):
                    continue

                full_url = self._normalize_url(href)
                if full_url in seen_urls:
                    continue
                seen_urls.add(full_url)

                # Extract snippet from <div class="excerpt">
                snippet = ""
                excerpt_div = result_div.find("div", class_="excerpt")
                if excerpt_div:
                    snippet = excerpt_div.get_text(strip=True)
                    snippet = " ".join(snippet.split())[:500]

                # Extract collection from <div class="leak-label">
                collection = "Unknown"
                leak_label = result_div.find("div", class_="leak-label")
                if leak_label:
                    b_tag = leak_label.find("b")
                    if b_tag:
                        collection_text = b_tag.get_text(strip=True)
                        collection = self._normalize_collection(collection_text)
                    else:
                        # Try getting text directly
                        label_text = leak_label.get_text(strip=True)
                        if label_text:
                            collection = self._normalize_collection(label_text)

                # If no leak-label found, try to extract from URL
                if collection == "Unknown":
                    collection = self._extract_collection(href)

                # Extract dates from <dl> if present
                date_created = None
                date_released = None
                dl = result_div.find("dl")
                if dl:
                    dts = dl.find_all("dt")
                    dds = dl.find_all("dd")
                    for dt, dd in zip(dts, dds):
                        label = dt.get_text(strip=True).lower()
                        value = dd.get_text(strip=True)
                        if "created" in label:
                            date_created = self._parse_date(value)
                        elif "released" in label:
                            date_released = self._parse_date(value)

                doc = WikiLeaksDocument(
                    title=title,
                    url=full_url,
                    collection=collection,
                    snippet=snippet,
                    date_created=date_created,
                    date_released=date_released,
                )
                documents.append(doc)

            # Fallback: If container strategy got few results, try h4 links directly
            if len(documents) < 3:
                h4_elements = soup.find_all("h4")
                for h4 in h4_elements:
                    if len(documents) >= max_results:
                        break

                    link = h4.find("a", href=True)
                    if not link:
                        continue

                    href = link.get("href", "")
                    title = link.get_text(strip=True)

                    if not href or not title or len(title) < 10:
                        continue

                    doc_patterns = ["/plusd/", "/cable/", "/gifiles/"]
                    if not any(pattern in href.lower() for pattern in doc_patterns):
                        continue

                    full_url = self._normalize_url(href)
                    if full_url in seen_urls:
                        continue
                    seen_urls.add(full_url)

                    # Try to get snippet from parent
                    parent = h4.find_parent("div")
                    snippet = ""
                    if parent:
                        excerpt = parent.find("div", class_="excerpt")
                        if excerpt:
                            snippet = excerpt.get_text(strip=True)[:500]

                    doc = WikiLeaksDocument(
                        title=title,
                        url=full_url,
                        collection=self._extract_collection(href),
                        snippet=snippet,
                    )
                    documents.append(doc)

            print(f"[WikiLeaks] Scraped {len(documents)} documents for query: {query}")

        except httpx.HTTPError as e:
            print(f"[WikiLeaks] HTTP error fetching {url}: {e}")
        except Exception as e:
            print(f"[WikiLeaks] Error parsing results: {e}")
            import traceback
            traceback.print_exc()

        return documents

    def _is_collection_name(self, text: str) -> bool:
        """Check if text is a known WikiLeaks collection name."""
        known_collections = {
            "plusd", "cablegate", "cable gate", "cables",
            "global intelligence", "gifiles", "gi files",
            "sony", "hacking team", "hackingteam",
            "kissinger", "carter", "afghan", "iraq",
            "saudi", "syria", "tpp", "ice", "bnd",
            "dnc", "podesta", "macron", "cia", "vault"
        }
        text_lower = text.lower().strip()
        return any(coll in text_lower for coll in known_collections)

    def _normalize_collection(self, text: str) -> str:
        """Normalize collection name to standardized form."""
        text_lower = text.lower().strip()

        collection_map = {
            "plusd": "PlusD Public Library",
            "cablegate": "Cable Gate",
            "cable gate": "Cable Gate",
            "global intelligence": "GI Files",
            "gifiles": "GI Files",
            "gi files": "GI Files",
            "sony": "Sony Documents",
            "hacking team": "Hacking Team",
            "hackingteam": "Hacking Team",
            "kissinger": "Kissinger Cables",
            "carter": "Carter Cables",
            "afghan": "Afghan War Diary",
            "iraq": "Iraq War Logs",
            "saudi": "Saudi Cables",
            "syria": "Syria Files",
            "dnc": "DNC Emails",
            "podesta": "Podesta Emails",
            "cia": "CIA Vault 7",
        }

        for key, value in collection_map.items():
            if key in text_lower:
                return value

        # Return cleaned version of original if no match
        return text.title() if text else "Unknown"

    def _parse_result_element(self, element) -> Optional[WikiLeaksDocument]:
        """Parse a single search result element."""
        try:
            # Find the title/link
            title_link = element.find("a", href=True)
            if not title_link:
                return None

            title = title_link.get_text(strip=True)
            url = self._normalize_url(title_link.get("href", ""))

            # Find snippet/description
            snippet_el = element.find(class_="snippet") or \
                         element.find(class_="description") or \
                         element.find("p")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""

            # Find dates
            date_created = None
            date_released = None

            date_els = element.find_all(class_="date") or \
                       element.find_all("time")
            for date_el in date_els:
                date_text = date_el.get_text(strip=True)
                date_val = self._parse_date(date_text)
                if date_val:
                    if "created" in date_el.get("class", []) or not date_created:
                        date_created = date_val
                    else:
                        date_released = date_val

            return WikiLeaksDocument(
                title=title or "Untitled Document",
                url=url,
                collection=self._extract_collection(url),
                snippet=snippet[:500],
                date_created=date_created,
                date_released=date_released,
            )
        except Exception:
            return None

    def _normalize_url(self, url: str) -> str:
        """Normalize WikiLeaks URL to absolute."""
        if url.startswith("//"):
            return f"https:{url}"
        elif url.startswith("/"):
            return f"https://wikileaks.org{url}"
        elif not url.startswith("http"):
            return f"https://wikileaks.org/{url}"
        return url

    def _calculate_relevance(
        self,
        candidate_name: str,
        title: str,
        snippet: str,
    ) -> float:
        """
        Calculate relevance score for a document.

        Score breakdown:
        - Full name in title: 1.0
        - Full name in snippet: 0.6
        - Multiple name parts in title: 0.8
        - Multiple name parts in snippet: 0.4
        - Name variation match: 0.5-0.7
        - Nepal context: +0.1 bonus

        Minimum score of 0.5 required for inclusion.
        """
        score = 0.0
        name_lower = candidate_name.lower()
        name_parts = [p for p in name_lower.split() if len(p) > 2]  # Only significant parts

        title_lower = title.lower() if title else ""
        snippet_lower = snippet.lower() if snippet else ""

        # Full name match in title = highest score
        if name_lower in title_lower:
            score += 1.0
        elif len(name_parts) >= 2 and all(part in title_lower for part in name_parts):
            score += 0.8
        else:
            # Check variations in title
            for variation in self._get_name_variations(candidate_name):
                if variation.lower() in title_lower:
                    score += 0.7
                    break

        # Full name match in snippet
        if name_lower in snippet_lower:
            score += 0.6
        elif len(name_parts) >= 2 and all(part in snippet_lower for part in name_parts):
            score += 0.4
        else:
            # Check variations in snippet
            for variation in self._get_name_variations(candidate_name):
                if variation.lower() in snippet_lower:
                    score += 0.3
                    break

        # Nepal context gives small bonus (document is about Nepal)
        if "nepal" in snippet_lower or "nepal" in title_lower:
            score += 0.1
        if "kathmandu" in snippet_lower or "kathmandu" in title_lower:
            score += 0.05

        return min(score, 2.0)  # Cap at 2.0


# Singleton instance
_service: Optional[WikiLeaksService] = None


async def get_wikileaks_service() -> WikiLeaksService:
    """Get or create the WikiLeaks service singleton."""
    global _service
    if _service is None:
        _service = WikiLeaksService()
    return _service
