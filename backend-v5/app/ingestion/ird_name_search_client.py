"""IRD Name Search client for discovering PANs by company name.

Extends IRD client to search by taxpayer name instead of PAN.
Uses Playwright to navigate the IRD website and extract PAN from results.

Usage:
    async with IRDNameSearchClient() as client:
        results = await client.search_by_name("Kantipur Publications")
        # results = [{"pan": "609677931", "name": "KANTIPUR PUBLICATIONS PVT LTD", ...}, ...]
"""
import asyncio
import logging
import re
from typing import Optional, List, Dict

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

logger = logging.getLogger(__name__)

_PAGE_LOAD_URL = "https://ird.gov.np/pan-search/"
_PAGE_MAX_SEARCHES = 50


class IRDNameSearchClient:
    """Playwright-based IRD name search client for PAN discovery."""

    def __init__(
        self,
        max_concurrency: int = 1,  # Be conservative with name search
        headless: bool = True,
    ):
        self._headless = headless
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._pw = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        self._page_searches = 0

    async def __aenter__(self):
        await self._start()
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def _start(self):
        """Launch browser and create initial page."""
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=self._headless)
        self._context = await self._browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        await self._ensure_page()

    async def _ensure_page(self):
        """Create or recycle the browser page."""
        if self._page and self._page_searches < _PAGE_MAX_SEARCHES:
            return

        if self._page:
            try:
                await self._page.close()
            except Exception:
                pass

        self._page = await self._context.new_page()
        await self._page.goto(_PAGE_LOAD_URL, wait_until="networkidle", timeout=30000)
        # Let reCAPTCHA initialise
        await self._page.wait_for_timeout(2000)
        self._page_searches = 0
        logger.debug("IRD name search page loaded")

    async def search_by_name(
        self,
        name: str,
        max_results: int = 5,
    ) -> List[Dict[str, str]]:
        """Search for companies by name and return list of matches with PANs.

        Args:
            name: Company name to search (English or Nepali)
            max_results: Maximum number of results to return

        Returns:
            List of dicts with keys: pan, name, address, status
        """
        async with self._semaphore:
            return await self._do_name_search(name, max_results)

    async def _do_name_search(
        self,
        name: str,
        max_results: int = 5,
        retry: int = 0,
    ) -> List[Dict[str, str]]:
        """Execute name search with result extraction."""
        try:
            await self._ensure_page()
        except Exception as e:
            logger.warning(f"Page load failed: {e}")
            self._page_searches = _PAGE_MAX_SEARCHES
            if retry < 1:
                return await self._do_name_search(name, max_results, retry=retry + 1)
            return []

        try:
            # Switch to name search mode (there should be a radio button or dropdown)
            # The IRD website may have different search modes
            # We'll use the name input field directly

            # Clear previous results
            await self._page.evaluate("""() => {
                const resultDiv = document.getElementById('result');
                const errDiv = document.getElementById('errdiv');
                if (resultDiv) resultDiv.innerHTML = '';
                if (errDiv) errDiv.innerHTML = '';
            }""")

            # Check if there's a name search input (might be different from PAN)
            # Try to find the appropriate input field
            name_input_selector = await self._find_name_input_selector()

            if not name_input_selector:
                logger.warning("Could not find name search input field")
                return []

            # Fill in the name
            await self._page.fill(name_input_selector, name)

            # Trigger search
            await self._page.evaluate("""() => {
                const e = { preventDefault: () => {} };
                // The search function might be different for name search
                if (typeof taxSearch === 'function') {
                    taxSearch(e);
                } else if (typeof searchByName === 'function') {
                    searchByName(e);
                }
            }""")

            # Wait for results (up to 15 seconds)
            await self._page.wait_for_timeout(3000)

            # Try to wait for results div to populate
            try:
                await self._page.wait_for_selector(
                    "#result .table, #result table, .search-results",
                    timeout=10000,
                )
            except Exception:
                logger.debug(f"No results table found for: {name}")

            # Extract results from the page
            results = await self._extract_search_results(max_results)

            self._page_searches += 1
            logger.info(f"Found {len(results)} results for: {name}")
            return results

        except Exception as e:
            logger.error(f"Name search error for '{name}': {e}")
            self._page_searches = _PAGE_MAX_SEARCHES
            if retry < 1:
                return await self._do_name_search(name, max_results, retry=retry + 1)
            return []

    async def _find_name_input_selector(self) -> Optional[str]:
        """Find the appropriate input field for name search."""
        # Try common selectors for name input
        possible_selectors = [
            "#taxpayerName",
            "#name",
            "#companyName",
            "input[name='name']",
            "input[name='taxpayerName']",
            "#pan",  # Fallback to PAN field (might accept names too)
        ]

        for selector in possible_selectors:
            try:
                element = await self._page.query_selector(selector)
                if element:
                    # Check if visible and enabled
                    is_visible = await element.is_visible()
                    is_enabled = await element.is_enabled()
                    if is_visible and is_enabled:
                        return selector
            except Exception:
                continue

        return None

    async def _extract_search_results(self, max_results: int) -> List[Dict[str, str]]:
        """Extract PAN and company info from search results page."""
        results = []

        try:
            # Get the HTML content of results div
            result_html = await self._page.inner_html("#result")

            # Extract PANs and names from the HTML
            # The format varies, but usually shows in a table or list
            # Look for PAN patterns (9 digits)
            pan_pattern = re.compile(r'\b(\d{9})\b')
            pans = pan_pattern.findall(result_html)

            if not pans:
                # Try to extract from table rows
                rows = await self._page.query_selector_all("#result tr, #result .result-row")

                for row in rows[:max_results]:
                    try:
                        row_text = await row.inner_text()
                        # Look for PAN in row text
                        pan_match = pan_pattern.search(row_text)
                        if pan_match:
                            pan = pan_match.group(1)
                            # Extract company name (usually near PAN)
                            lines = row_text.strip().split('\n')
                            name = lines[0] if lines else ""

                            results.append({
                                "pan": pan,
                                "name": name.strip(),
                                "match_confidence": "high" if len(results) == 0 else "medium",
                            })
                    except Exception as e:
                        logger.debug(f"Error extracting row: {e}")
                        continue

            else:
                # Found PANs in HTML - try to extract associated names
                for idx, pan in enumerate(pans[:max_results]):
                    # Find text around the PAN
                    pan_context = self._extract_context_around_pan(result_html, pan)

                    results.append({
                        "pan": pan,
                        "name": pan_context.get("name", ""),
                        "address": pan_context.get("address", ""),
                        "match_confidence": "high" if idx == 0 else "medium",
                    })

        except Exception as e:
            logger.error(f"Error extracting search results: {e}")

        return results

    def _extract_context_around_pan(self, html: str, pan: str) -> Dict[str, str]:
        """Extract company name and address from HTML context around PAN."""
        # Find the section of HTML containing this PAN
        pan_index = html.find(pan)
        if pan_index == -1:
            return {"name": "", "address": ""}

        # Extract surrounding text (500 chars before and after)
        start = max(0, pan_index - 500)
        end = min(len(html), pan_index + 500)
        context = html[start:end]

        # Remove HTML tags
        text = re.sub(r'<[^>]+>', ' ', context)
        text = re.sub(r'\s+', ' ', text).strip()

        # The name is usually before or after the PAN
        # Split by PAN and take surrounding text
        parts = text.split(pan)
        name_before = parts[0].strip().split()[-10:] if parts[0] else []
        name_after = parts[1].strip().split()[:10] if len(parts) > 1 else []

        # Combine and clean
        name_text = ' '.join(name_before + name_after)

        return {
            "name": name_text[:200],  # Limit length
            "address": "",  # Could extract address similarly
        }

    async def close(self):
        """Close browser and Playwright."""
        if self._page:
            try:
                await self._page.close()
            except Exception:
                pass
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
        if self._pw:
            try:
                await self._pw.stop()
            except Exception:
                pass
