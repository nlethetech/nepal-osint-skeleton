"""IRD PAN Search client using Playwright for reCAPTCHA v3 bypass.

Navigates to ird.gov.np/pan-search/, fills in PAN, lets reCAPTCHA v3 run
naturally in the browser, and captures the JSON response from /api/getPanSearch/.

Usage:
    async with IRDClient() as client:
        data = await client.search_pan("609677931")
        # data = {"panRegistrationDetail": [...], "businessDetail": [...], ...}
"""
import asyncio
import json
import logging
from typing import Optional

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

logger = logging.getLogger(__name__)

# How long to keep a single browser page alive before recycling
_PAGE_MAX_SEARCHES = 50
_PAGE_LOAD_URL = "https://ird.gov.np/pan-search/"


class IRDClient:
    """Playwright-based IRD PAN search client."""

    def __init__(
        self,
        max_concurrency: int = 2,
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
        logger.debug("IRD page loaded / recycled")

    async def search_pan(self, pan: str) -> Optional[dict]:
        """Search a single PAN on IRD.

        Returns the full response data dict, or None on failure.
        The response typically contains:
          - panRegistrationDetail
          - businessDetail
          - panDetails (has phone, address)
          - panTaxClearance
        """
        async with self._semaphore:
            return await self._do_search(pan)

    async def _do_search(self, pan: str, retry: int = 0) -> Optional[dict]:
        """Execute a single PAN search with response interception."""
        try:
            await self._ensure_page()
        except Exception as e:
            logger.warning(f"Page load failed: {e}")
            # Force page recreation
            self._page_searches = _PAGE_MAX_SEARCHES
            if retry < 1:
                return await self._do_search(pan, retry=retry + 1)
            return None

        api_response = None
        api_error = None

        async def handle_response(response):
            nonlocal api_response, api_error
            if "/api/getPanSearch/" in response.url:
                try:
                    data = await response.json()
                    if data.get("code") == 1 and data.get("data"):
                        api_response = data["data"]
                    else:
                        api_error = data.get("message", "Unknown error")
                except Exception as e:
                    api_error = str(e)

        self._page.on("response", handle_response)

        try:
            # Clear previous state and fill PAN
            await self._page.evaluate("""() => {
                document.getElementById('result').innerHTML = '';
                document.getElementById('errdiv').innerHTML = '';
            }""")
            await self._page.fill("#pan", str(pan))

            # Trigger the search (calls grecaptcha.execute() -> onSubmit)
            await self._page.evaluate("""() => {
                const e = { preventDefault: () => {} };
                taxSearch(e);
            }""")

            # Wait for API response (up to 15s)
            for _ in range(30):
                await self._page.wait_for_timeout(500)
                if api_response is not None or api_error is not None:
                    break

            self._page_searches += 1

            if api_response:
                return api_response

            if api_error:
                logger.warning(f"IRD search failed for PAN {pan}: {api_error}")

                # If reCAPTCHA failed, recycle the page and retry once
                if retry < 1 and "recaptcha" in str(api_error).lower():
                    self._page_searches = _PAGE_MAX_SEARCHES
                    return await self._do_search(pan, retry=retry + 1)

                return None

            # Timeout - no response received
            logger.warning(f"IRD search timeout for PAN {pan}")
            if retry < 1:
                self._page_searches = _PAGE_MAX_SEARCHES
                return await self._do_search(pan, retry=retry + 1)
            return None

        except Exception as e:
            logger.error(f"IRD search error for PAN {pan}: {e}")
            self._page_searches = _PAGE_MAX_SEARCHES
            if retry < 1:
                return await self._do_search(pan, retry=retry + 1)
            return None
        finally:
            self._page.remove_listener("response", handle_response)

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
