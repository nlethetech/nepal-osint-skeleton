"""Tile proxy service for GEE satellite imagery.

Proxies tile requests through the backend to:
1. Keep GEE credentials secure (not exposed to frontend)
2. Cache tile URL templates in Redis
3. Handle tile URL expiration gracefully
"""

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import ee
import httpx

from app.config import get_settings
from app.core.redis import get_redis
from .gee_client import GEEClient, GEE_COLLECTIONS, NEPAL_BBOX

logger = logging.getLogger(__name__)
settings = get_settings()


# Visualization parameters for different layer types
VIS_PARAMS: dict[str, dict[str, Any]] = {
    "sentinel2-rgb": {
        "bands": ["B4", "B3", "B2"],
        "min": 0,
        "max": 3000,
    },
    "sentinel2-false-color": {
        "bands": ["B8", "B4", "B3"],
        "min": 0,
        "max": 5000,
    },
    "ndvi": {
        "min": -1,
        "max": 1,
        "palette": [
            "d73027",  # Red (bare/water)
            "fc8d59",  # Orange
            "fee08b",  # Yellow
            "d9ef8b",  # Light green
            "91cf60",  # Green
            "1a9850",  # Dark green (dense vegetation)
        ],
    },
    "flood-extent": {
        "min": 0,
        "max": 1,
        "palette": ["000000", "0000ff"],  # Black to blue
    },
    "temperature": {
        "min": 273,  # Kelvin
        "max": 320,
        "palette": [
            "040274",  # Deep blue (cold)
            "0000ff",
            "00ffff",
            "00ff00",
            "ffff00",
            "ff0000",  # Red (hot)
        ],
    },
    "precipitation": {
        "min": 0,
        "max": 50,  # mm
        "palette": [
            "ffffff",  # White (no rain)
            "add8e6",  # Light blue
            "0000ff",  # Blue
            "00008b",  # Dark blue (heavy rain)
        ],
    },
}


class TileProxyService:
    """Service for proxying GEE tile requests with caching."""

    def __init__(self, redis_client=None):
        self.redis = redis_client
        self._http_client: Optional[httpx.AsyncClient] = None

    async def get_http_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client."""
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client

    async def close(self):
        """Close HTTP client."""
        if self._http_client and not self._http_client.is_closed:
            await self._http_client.aclose()

    def _get_cache_key(self, layer_type: str, date: Optional[str]) -> str:
        """Generate cache key for tile URL template."""
        date_str = date or "latest"
        return f"gee:tiles:{layer_type}:{date_str}:url"

    async def get_tile_url_template(
        self,
        layer_type: str,
        date: Optional[str] = None,
        bbox: Optional[list[float]] = None,
    ) -> Optional[str]:
        """Get tile URL template for a layer type.

        Args:
            layer_type: Type of layer (sentinel2-rgb, ndvi, etc.)
            date: Target date (ISO format)
            bbox: Bounding box (defaults to Nepal)

        Returns:
            Tile URL template with {z}/{x}/{y} placeholders, or None if error
        """
        # Check cache first
        if self.redis is None:
            self.redis = await get_redis()

        cache_key = self._get_cache_key(layer_type, date)
        cached = await self.redis.get(cache_key)

        if cached:
            logger.debug(f"Cache hit for {cache_key}")
            return cached

        # Generate new tile URL from GEE
        try:
            gee_client = await GEEClient.get_instance()
            if not gee_client.is_configured:
                logger.warning("GEE not configured, cannot generate tiles")
                return None

            bbox = bbox or NEPAL_BBOX
            image = await self._get_image_for_layer(gee_client, layer_type, bbox, date)

            if image is None:
                return None

            vis_params = VIS_PARAMS.get(layer_type, VIS_PARAMS["sentinel2-rgb"])
            map_info = await gee_client.get_map_id(image, vis_params)
            tile_url = map_info["tile_url"]

            # Cache for configured TTL (default 1 hour)
            await self.redis.setex(
                cache_key,
                settings.gee_tile_cache_ttl,
                tile_url,
            )

            logger.info(f"Generated and cached tile URL for {layer_type}")
            return tile_url

        except Exception as e:
            logger.exception(f"Error generating tile URL for {layer_type}: {e}")
            return None

    async def _get_image_for_layer(
        self,
        gee_client: GEEClient,
        layer_type: str,
        bbox: list[float],
        date: Optional[str],
    ) -> Optional[ee.Image]:
        """Get the appropriate GEE image for a layer type."""

        def _build_image():
            geometry = ee.Geometry.Rectangle(bbox)

            if layer_type in ["sentinel2-rgb", "sentinel2-false-color"]:
                collection = ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                if date:
                    from datetime import datetime as dt, timedelta
                    end = dt.fromisoformat(date.replace("Z", "+00:00"))
                    start = end - timedelta(days=30)
                    collection = collection.filterDate(
                        start.strftime("%Y-%m-%d"),
                        end.strftime("%Y-%m-%d"),
                    )
                else:
                    # Last 30 days
                    collection = collection.filterDate(
                        ee.Date.fromYMD(
                            ee.Date(datetime.now(timezone.utc).isoformat()).get("year"),
                            ee.Date(datetime.now(timezone.utc).isoformat()).get("month"),
                            1,
                        ).advance(-30, "day"),
                        ee.Date(datetime.now(timezone.utc).isoformat()),
                    )

                collection = collection.filterBounds(geometry).filter(
                    ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30)
                )
                return collection.median().clip(geometry)

            elif layer_type == "ndvi":
                # NDVI from Sentinel-2
                collection = ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                if date:
                    from datetime import datetime as dt, timedelta
                    end = dt.fromisoformat(date.replace("Z", "+00:00"))
                    start = end - timedelta(days=30)
                    collection = collection.filterDate(
                        start.strftime("%Y-%m-%d"),
                        end.strftime("%Y-%m-%d"),
                    )

                collection = collection.filterBounds(geometry).filter(
                    ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30)
                )
                image = collection.median().clip(geometry)

                # Compute NDVI: (NIR - Red) / (NIR + Red)
                ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")
                return ndvi

            elif layer_type == "flood-extent":
                # Water detection using Sentinel-1 SAR
                collection = ee.ImageCollection(GEE_COLLECTIONS["sentinel1"])
                if date:
                    from datetime import datetime as dt, timedelta
                    end = dt.fromisoformat(date.replace("Z", "+00:00"))
                    start = end - timedelta(days=15)
                    collection = collection.filterDate(
                        start.strftime("%Y-%m-%d"),
                        end.strftime("%Y-%m-%d"),
                    )

                collection = (
                    collection.filterBounds(geometry)
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                    .filter(ee.Filter.eq("instrumentMode", "IW"))
                    .select("VV")
                )
                image = collection.median().clip(geometry)

                # Water detection: VV backscatter < -15 dB
                water = image.lt(-15).selfMask()
                return water

            elif layer_type == "temperature":
                # MODIS Land Surface Temperature
                collection = ee.ImageCollection(GEE_COLLECTIONS["modis_temp"])
                if date:
                    from datetime import datetime as dt, timedelta
                    end = dt.fromisoformat(date.replace("Z", "+00:00"))
                    start = end - timedelta(days=8)
                    collection = collection.filterDate(
                        start.strftime("%Y-%m-%d"),
                        end.strftime("%Y-%m-%d"),
                    )

                collection = collection.filterBounds(geometry).select("LST_Day_1km")
                return collection.median().multiply(0.02).clip(geometry)  # Scale factor

            elif layer_type == "precipitation":
                # CHIRPS precipitation
                collection = ee.ImageCollection(GEE_COLLECTIONS["chirps"])
                if date:
                    from datetime import datetime as dt, timedelta
                    end = dt.fromisoformat(date.replace("Z", "+00:00"))
                    start = end - timedelta(days=7)
                    collection = collection.filterDate(
                        start.strftime("%Y-%m-%d"),
                        end.strftime("%Y-%m-%d"),
                    )

                collection = collection.filterBounds(geometry)
                return collection.sum().clip(geometry)  # Total precipitation

            else:
                # Default to Sentinel-2 RGB
                return None

        try:
            return await asyncio.to_thread(_build_image)
        except Exception as e:
            logger.exception(f"Error building image for {layer_type}: {e}")
            return None

    async def proxy_tile(
        self,
        layer_type: str,
        z: int,
        x: int,
        y: int,
        date: Optional[str] = None,
        bbox: Optional[list[float]] = None,
    ) -> Optional[bytes]:
        """Proxy a tile request to GEE.

        Args:
            layer_type: Type of layer
            z, x, y: Tile coordinates
            date: Target date
            bbox: Optional bounding box for analysis layers

        Returns:
            PNG tile bytes, or None if error
        """
        tile_url_template = await self.get_tile_url_template(layer_type, date, bbox)

        if not tile_url_template:
            return None

        # Replace placeholders with actual coordinates
        tile_url = tile_url_template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))

        try:
            client = await self.get_http_client()
            response = await client.get(tile_url)

            if response.status_code == 200:
                return response.content
            else:
                logger.warning(f"GEE tile request failed: {response.status_code}")
                return None

        except Exception as e:
            logger.exception(f"Error proxying tile: {e}")
            return None

    async def invalidate_cache(self, layer_type: Optional[str] = None):
        """Invalidate tile URL cache.

        Args:
            layer_type: Specific layer to invalidate, or None for all
        """
        if self.redis is None:
            self.redis = await get_redis()

        if layer_type:
            pattern = f"gee:tiles:{layer_type}:*"
        else:
            pattern = "gee:tiles:*"

        keys = await self.redis.keys(pattern)
        if keys:
            await self.redis.delete(*keys)
            logger.info(f"Invalidated {len(keys)} tile cache entries")
