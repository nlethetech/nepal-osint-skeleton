"""DFIMS (Development Finance Information Management System) API client.

Fetches organization data from dfims-api.naxa.com.np for integration into
the NARADA unified graph. Public API — no authentication required.
"""
import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

import os

# Use DFIMS_API_BASE env var to switch to production (dfims.mof.gov.np)
# when running from a Nepal-based server.
BASE_URL = os.getenv("DFIMS_API_BASE", "https://dfims-api.naxa.com.np/api/v1")
TIMEOUT = 30.0
PAGE_SIZE = 100
MAX_RETRIES = 3


async def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """GET request with exponential backoff retry."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                resp = await client.get(f"{BASE_URL}/{path}", params=params)
                resp.raise_for_status()
                return resp.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            if attempt == MAX_RETRIES:
                raise
            wait = 2 ** attempt
            logger.warning("DFIMS API attempt %d failed: %s — retrying in %ds", attempt, e, wait)
            await asyncio.sleep(wait)
    raise RuntimeError("Unreachable")  # satisfies type checker


async def fetch_organizations() -> list[dict[str, Any]]:
    """Fetch all organizations from DFIMS, handling pagination.

    Returns a flat list of organization dicts with fields:
      id, name, name_ne, code, iati_identifier, abbreviation,
      development_cooperation_group__id, development_cooperation_group__name,
      development_cooperation_group__architecture__id,
      development_cooperation_group__architecture__name
    """
    all_orgs: list[dict[str, Any]] = []
    page = 1

    while True:
        data = await _get("organization/", params={"page": page, "page_size": PAGE_SIZE})
        results = data.get("results", [])
        all_orgs.extend(results)
        logger.info("DFIMS organizations page %d: %d results (total so far: %d)", page, len(results), len(all_orgs))

        if data.get("next_page") is None or not results:
            break
        page = data["next_page"]

    logger.info("Fetched %d DFIMS organizations total", len(all_orgs))
    return all_orgs
