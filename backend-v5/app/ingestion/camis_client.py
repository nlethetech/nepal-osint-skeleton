"""CAMIS API client for enriching company data from camis.ocr.gov.np."""
import asyncio
import base64
import logging
from typing import Optional

import httpx

from app.core.redis import get_redis

logger = logging.getLogger(__name__)

CAMIS_TOKEN_REDIS_KEY = "camis:access_token"
CAMIS_TOKEN_TTL_SECONDS = 30 * 24 * 3600  # 30 days (tokens last ~41 days)


class CAMISClient:
    """OAuth2 client for the CAMIS (Company Administration & Management Information System) API.

    Supports concurrent requests via an async semaphore. Safe to share across workers.
    """

    GATEWAY = "https://camis.ocr.gov.np/gateway"
    AUTH_URL = "https://camis.ocr.gov.np/gateway/auth/api/ocr-login"
    CLIENT_ID = "external-ocr-client"
    CLIENT_SECRET = "OCR@pp123"

    def __init__(
        self,
        username: Optional[str] = None,
        password: Optional[str] = None,
        max_concurrency: int = 8,
    ):
        from app.config import get_settings
        settings = get_settings()

        self.username = username or settings.camis_username or ""
        self.password = password or settings.camis_password or ""
        self._token: Optional[str] = None
        self._token_lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._http: Optional[httpx.AsyncClient] = None

    async def _get_http(self) -> httpx.AsyncClient:
        """Get or create a reusable httpx client with connection pooling."""
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(
                timeout=30,
                verify=False,
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                ),
            )
        return self._http

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._http and not self._http.is_closed:
            await self._http.aclose()
            self._http = None

    async def _get_token(self) -> str:
        """Get access token, using Redis cache or authenticating fresh. Thread-safe."""
        if self._token:
            return self._token

        async with self._token_lock:
            # Double-check after acquiring lock
            if self._token:
                return self._token

            # Check Redis cache
            try:
                redis = await get_redis()
                cached = await redis.get(CAMIS_TOKEN_REDIS_KEY)
                if cached:
                    self._token = cached
                    return cached
            except Exception:
                logger.debug("Redis unavailable for CAMIS token cache")

            # Authenticate
            token = await self._authenticate()
            self._token = token

            # Cache in Redis
            try:
                redis = await get_redis()
                await redis.set(CAMIS_TOKEN_REDIS_KEY, token, ex=CAMIS_TOKEN_TTL_SECONDS)
            except Exception:
                logger.debug("Failed to cache CAMIS token in Redis")

            return token

    async def _authenticate(self) -> str:
        """OAuth2 password grant against CAMIS auth endpoint."""
        if not self.username or not self.password:
            raise ValueError(
                "CAMIS credentials not configured. Set CAMIS_USERNAME and CAMIS_PASSWORD environment variables."
            )

        basic_creds = base64.b64encode(
            f"{self.CLIENT_ID}:{self.CLIENT_SECRET}".encode()
        ).decode()

        http = await self._get_http()
        resp = await http.post(
            self.AUTH_URL,
            headers={
                "Authorization": f"Basic {basic_creds}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "username": self.username,
                "password": self.password,
                "grant_type": "password",
            },
        )

        if resp.status_code != 200:
            raise RuntimeError(f"CAMIS auth failed ({resp.status_code}): {resp.text[:500]}")

        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError(f"CAMIS auth response missing access_token: {list(data.keys())}")

        logger.info("CAMIS authentication successful")
        return token

    async def _request(
        self,
        method: str,
        path: str,
        json_body: Optional[dict] = None,
        params: Optional[dict] = None,
        retries: int = 2,
    ) -> dict:
        """Make an authenticated request to CAMIS with retry + concurrency control."""
        token = await self._get_token()
        url = f"{self.GATEWAY}/{path.lstrip('/')}"
        http = await self._get_http()

        for attempt in range(retries + 1):
            async with self._semaphore:
                try:
                    resp = await http.request(
                        method,
                        url,
                        headers={"Authorization": f"Bearer {token}"},
                        json=json_body,
                        params=params,
                    )

                    if resp.status_code == 401:
                        logger.info("CAMIS token expired, re-authenticating")
                        async with self._token_lock:
                            self._token = None
                            try:
                                redis = await get_redis()
                                await redis.delete(CAMIS_TOKEN_REDIS_KEY)
                            except Exception:
                                pass
                        token = await self._get_token()
                        continue

                    if resp.status_code >= 500 and attempt < retries:
                        wait = 2 ** attempt
                        logger.warning(f"CAMIS {resp.status_code} on {path}, retrying in {wait}s")
                        await asyncio.sleep(wait)
                        continue

                    resp.raise_for_status()
                    return resp.json()

                except httpx.TimeoutException:
                    if attempt < retries:
                        wait = 2 ** attempt
                        logger.warning(f"CAMIS timeout on {path}, retrying in {wait}s")
                        await asyncio.sleep(wait)
                        continue
                    raise

        raise RuntimeError(f"CAMIS request failed after {retries + 1} attempts: {method} {path}")

    # ---- Public API methods ----

    async def search_companies(
        self,
        name: Optional[str] = None,
        reg_number: Optional[str] = None,
    ) -> list[dict]:
        """Search companies by name or registration number via CAMIS."""
        body: dict = {}
        if name:
            body["companyNameEnglish"] = name
        if reg_number:
            body["companyRegistrationNumber"] = reg_number

        data = await self._request(
            "POST",
            "external/api/company-registration/search-company-details",
            json_body=body,
        )
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data", data.get("content", [data]))
        return []

    async def get_company_detail(self, reg_number: str) -> Optional[dict]:
        """Get eService company detail (CAMIS ID, masked contact). Returns None if not found."""
        try:
            data = await self._request(
                "GET",
                "external/api/eservice/company-details",
                params={"registrationNo": reg_number},
            )
            return data
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (400, 404):
                return None
            raise

    async def get_cro_detail(self, reg_number: str) -> Optional[dict]:
        """Get CRO migration detail (includes UNMASKED PAN number). Returns None if not found."""
        try:
            data = await self._request(
                "GET",
                "migration/api/eservice/company-details",
                params={"registrationNo": reg_number},
            )
            return data
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (400, 404):
                return None
            raise

    async def get_govt_shareholders(self) -> list[dict]:
        """Get government/institutional shareholder entities (817+ records)."""
        data = await self._request(
            "GET",
            "external/api/shareholder-gov-body/get-all",
        )
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data", data.get("content", []))
        return []

    async def invalidate_token(self) -> None:
        """Clear cached token (useful when credentials change)."""
        self._token = None
        try:
            redis = await get_redis()
            await redis.delete(CAMIS_TOKEN_REDIS_KEY)
        except Exception:
            pass
