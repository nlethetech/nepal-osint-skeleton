"""KPI caching service with Redis backend."""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional, List

import redis.asyncio as redis

from app.schemas.kpi import KPISnapshot

logger = logging.getLogger(__name__)


class KPICacheService:
    """Redis-backed KPI caching with smart invalidation."""

    CACHE_TTL = 30  # seconds
    CACHE_KEY_PREFIX = "kpi:snapshot"

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    def _cache_key(self, hours: int, districts: Optional[List[str]] = None) -> str:
        """
        Generate cache key for given time window and districts.

        Args:
            hours: Time window in hours
            districts: Optional list of district names (creates unique cache per filter)
        """
        if not districts:
            return f"{self.CACHE_KEY_PREFIX}:{hours}"

        # Create a hash of sorted districts for consistent cache keys
        districts_sorted = sorted(d.lower() for d in districts)
        districts_hash = hashlib.md5(",".join(districts_sorted).encode()).hexdigest()[:8]
        return f"{self.CACHE_KEY_PREFIX}:{hours}:d:{districts_hash}"

    async def get(
        self, hours: int, districts: Optional[List[str]] = None
    ) -> Optional[KPISnapshot]:
        """
        Get cached KPI snapshot if available.

        Returns None if cache miss or expired.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        try:
            cached = await self.redis.get(self._cache_key(hours, districts))
            if cached:
                logger.debug(f"KPI cache hit for {hours}h window (districts={len(districts or [])})")
                return KPISnapshot.model_validate_json(cached)
        except redis.RedisError as e:
            logger.warning(f"Redis get error: {e}")
        except Exception as e:
            logger.warning(f"Cache deserialization error: {e}")

        return None

    async def set(
        self, hours: int, snapshot: KPISnapshot, districts: Optional[List[str]] = None
    ) -> bool:
        """
        Cache KPI snapshot with TTL.

        Returns True if cached successfully.

        Args:
            hours: Time window in hours
            snapshot: KPI snapshot to cache
            districts: Optional list of district names (for cache key)
        """
        try:
            await self.redis.setex(
                self._cache_key(hours, districts),
                self.CACHE_TTL,
                snapshot.model_dump_json(),
            )
            logger.debug(f"KPI cached for {hours}h window (TTL={self.CACHE_TTL}s, districts={len(districts or [])})")
            return True
        except redis.RedisError as e:
            logger.warning(f"Redis set error: {e}")
        except Exception as e:
            logger.warning(f"Cache serialization error: {e}")

        return False

    async def invalidate(
        self, hours: Optional[int] = None, districts: Optional[List[str]] = None
    ) -> int:
        """
        Invalidate KPI cache.

        If hours is None, invalidates all KPI caches.
        Returns number of keys deleted.

        Args:
            hours: Specific time window to invalidate
            districts: Specific districts filter to invalidate
        """
        try:
            if hours is not None:
                result = await self.redis.delete(self._cache_key(hours, districts))
                logger.info(f"Invalidated KPI cache for {hours}h window")
                return result

            # Invalidate all KPI caches
            pattern = f"{self.CACHE_KEY_PREFIX}:*"
            keys = []
            async for key in self.redis.scan_iter(match=pattern):
                keys.append(key)

            if keys:
                result = await self.redis.delete(*keys)
                logger.info(f"Invalidated {result} KPI cache keys")
                return result

            return 0
        except redis.RedisError as e:
            logger.warning(f"Redis invalidation error: {e}")
            return 0

    async def get_cache_status(self) -> dict:
        """
        Get cache status information.

        Returns dict with cache keys and TTLs.
        """
        try:
            pattern = f"{self.CACHE_KEY_PREFIX}:*"
            status = {}

            async for key in self.redis.scan_iter(match=pattern):
                ttl = await self.redis.ttl(key)
                # Extract hours from key
                hours = key.split(":")[-1] if isinstance(key, str) else key.decode().split(":")[-1]
                status[f"{hours}h"] = {
                    "ttl_seconds": ttl,
                    "cached": ttl > 0,
                }

            return status
        except redis.RedisError as e:
            logger.warning(f"Redis status error: {e}")
            return {}


class KPICacheManager:
    """
    High-level cache manager that combines caching with computation.

    Use this in API endpoints for automatic cache handling.
    """

    def __init__(
        self,
        cache_service: KPICacheService,
        kpi_service,  # Avoid circular import
    ):
        self.cache = cache_service
        self.kpi_service = kpi_service

    async def get_or_compute(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> KPISnapshot:
        """
        Get KPI snapshot from cache or compute fresh.

        This is the main entry point for KPI retrieval.
        Handles cache hits, misses, and refresh.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []

        # Try cache first
        cached = await self.cache.get(hours, districts)
        if cached:
            return cached

        # Compute fresh
        district_desc = f", districts={len(districts)}" if districts else ""
        logger.info(f"Computing fresh KPI snapshot for {hours}h window{district_desc}")
        snapshot = await self.kpi_service.compute_all_kpis(hours, districts)

        # Cache the result
        await self.cache.set(hours, snapshot, districts)

        return snapshot

    async def force_refresh(
        self, hours: int = 24, districts: Optional[List[str]] = None
    ) -> KPISnapshot:
        """
        Force refresh KPI snapshot (bypass cache).

        Use when you know data has changed.

        Args:
            hours: Time window in hours
            districts: Optional list of district names to filter by
        """
        districts = districts or []

        # Invalidate cache
        await self.cache.invalidate(hours, districts)

        # Compute fresh
        snapshot = await self.kpi_service.compute_all_kpis(hours, districts)

        # Cache the result
        await self.cache.set(hours, snapshot, districts)

        return snapshot
