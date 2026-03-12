"""Google Earth Engine client with multiple authentication methods.

This module provides a singleton client for GEE that handles:
- Application Default Credentials (recommended - `gcloud auth application-default login`)
- Service account authentication (file path, base64, or JSON string)
- Async wrapper for synchronous GEE API
- Connection health checking
- Automatic reconnection on token expiry
"""

import asyncio
import base64
import json
import logging
import os
import tempfile
from typing import Any, Optional

import ee
import google.auth
from google.oauth2 import service_account

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class GEEClient:
    """Manages Google Earth Engine authentication and operations.

    Uses singleton pattern to maintain a single authenticated connection.
    All GEE operations are wrapped in asyncio.to_thread() since the
    earthengine-api is synchronous.
    """

    _instance: Optional["GEEClient"] = None
    _initialized: bool = False
    _lock = asyncio.Lock()

    def __new__(cls) -> "GEEClient":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @classmethod
    async def get_instance(cls) -> "GEEClient":
        """Get or create the singleton GEE client instance."""
        async with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            if not cls._initialized:
                await cls._instance.initialize()
            return cls._instance

    @property
    def is_configured(self) -> bool:
        """Check if GEE credentials are configured.

        Returns True if:
        - Project ID is set (can use Application Default Credentials)
        - OR both service account JSON and project ID are set
        """
        return bool(settings.gee_project_id)

    async def initialize(self) -> bool:
        """Initialize GEE with available credentials.

        Tries authentication methods in order:
        1. Service account credentials (if GEE_SERVICE_ACCOUNT_JSON is set)
        2. Application Default Credentials (gcloud auth application-default login)

        Returns:
            True if initialization successful, False otherwise.
        """
        if self._initialized:
            return True

        if not settings.gee_project_id:
            logger.warning("GEE not configured: GEE_PROJECT_ID required")
            return False

        try:
            credentials = None
            auth_method = "unknown"

            # Try service account credentials first if configured
            if settings.gee_service_account_json:
                credentials = await self._get_service_account_credentials()
                if credentials:
                    auth_method = "service_account"

            # Fall back to Application Default Credentials
            if credentials is None:
                credentials = await self._get_adc_credentials()
                if credentials:
                    auth_method = "application_default"

            if credentials is None:
                logger.error(
                    "No valid GEE credentials found. Either:\n"
                    "  1. Run: gcloud auth application-default login\n"
                    "  2. Set GEE_SERVICE_ACCOUNT_JSON to a service account key file"
                )
                return False

            # Initialize GEE in thread pool (synchronous operation)
            await asyncio.to_thread(
                ee.Initialize,
                credentials=credentials,
                project=settings.gee_project_id,
            )

            self._initialized = True
            logger.info(
                f"GEE initialized with project: {settings.gee_project_id} "
                f"(auth: {auth_method})"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to initialize GEE: {e}")
            return False

    async def _get_adc_credentials(self) -> Optional[google.auth.credentials.Credentials]:
        """Load Application Default Credentials.

        Requires running: gcloud auth application-default login
        """
        try:
            def _get_adc():
                credentials, project = google.auth.default(
                    scopes=["https://www.googleapis.com/auth/earthengine"]
                )
                return credentials

            credentials = await asyncio.to_thread(_get_adc)
            logger.debug("Loaded GEE credentials from Application Default Credentials")
            return credentials

        except google.auth.exceptions.DefaultCredentialsError as e:
            logger.debug(f"Application Default Credentials not available: {e}")
            return None
        except Exception as e:
            logger.debug(f"Error loading ADC: {e}")
            return None

    async def _get_service_account_credentials(self) -> Optional[service_account.Credentials]:
        """Load service account credentials from file or base64 string."""
        cred_input = settings.gee_service_account_json

        if not cred_input:
            return None

        try:
            # Try as file path first
            if os.path.isfile(cred_input):
                logger.debug(f"Loading GEE credentials from file: {cred_input}")
                credentials = service_account.Credentials.from_service_account_file(
                    cred_input,
                    scopes=["https://www.googleapis.com/auth/earthengine"],
                )
                return credentials

            # Try as base64-encoded JSON
            try:
                decoded = base64.b64decode(cred_input)
                cred_dict = json.loads(decoded)
                credentials = service_account.Credentials.from_service_account_info(
                    cred_dict,
                    scopes=["https://www.googleapis.com/auth/earthengine"],
                )
                logger.debug("Loaded GEE credentials from base64")
                return credentials
            except (ValueError, json.JSONDecodeError):
                pass

            # Try as raw JSON string
            try:
                cred_dict = json.loads(cred_input)
                credentials = service_account.Credentials.from_service_account_info(
                    cred_dict,
                    scopes=["https://www.googleapis.com/auth/earthengine"],
                )
                logger.debug("Loaded GEE credentials from JSON string")
                return credentials
            except json.JSONDecodeError:
                pass

            logger.warning(
                "GEE_SERVICE_ACCOUNT_JSON is set but not a valid file path, base64 string, or JSON"
            )
            return None

        except Exception as e:
            logger.exception(f"Error loading service account credentials: {e}")
            return None

    async def get_image(
        self,
        collection: str,
        bbox: list[float],
        date: Optional[str] = None,
        days_before: int = 30,
    ) -> ee.Image:
        """Get a satellite image for a region.

        Args:
            collection: GEE collection ID (e.g., 'COPERNICUS/S2_SR_HARMONIZED')
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            date: Target date (ISO format). If None, uses most recent.
            days_before: Days to look back from target date

        Returns:
            ee.Image object
        """
        if not self._initialized:
            await self.initialize()

        def _get_image():
            # Create geometry from bbox
            geometry = ee.Geometry.Rectangle(bbox)

            # Build image collection with filters
            collection_obj = ee.ImageCollection(collection)

            if date:
                from datetime import datetime, timedelta
                end_date = datetime.fromisoformat(date.replace("Z", "+00:00"))
                start_date = end_date - timedelta(days=days_before)
                collection_obj = collection_obj.filterDate(
                    start_date.strftime("%Y-%m-%d"),
                    end_date.strftime("%Y-%m-%d"),
                )

            collection_obj = collection_obj.filterBounds(geometry)

            # Get median composite (reduces cloud impact)
            return collection_obj.median().clip(geometry)

        return await asyncio.to_thread(_get_image)

    async def get_image_collection(
        self,
        collection: str,
        bbox: list[float],
        start_date: str,
        end_date: str,
        cloud_cover_max: float = 30,
    ) -> ee.ImageCollection:
        """Get an image collection with filters.

        Args:
            collection: GEE collection ID
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            start_date: Start date (ISO format)
            end_date: End date (ISO format)
            cloud_cover_max: Maximum cloud cover percentage

        Returns:
            ee.ImageCollection object
        """
        if not self._initialized:
            await self.initialize()

        def _get_collection():
            geometry = ee.Geometry.Rectangle(bbox)

            collection_obj = (
                ee.ImageCollection(collection)
                .filterBounds(geometry)
                .filterDate(start_date, end_date)
            )

            # Apply cloud filter for optical collections
            if "S2" in collection or "LANDSAT" in collection:
                cloud_property = "CLOUDY_PIXEL_PERCENTAGE" if "S2" in collection else "CLOUD_COVER"
                collection_obj = collection_obj.filter(
                    ee.Filter.lt(cloud_property, cloud_cover_max)
                )

            return collection_obj

        return await asyncio.to_thread(_get_collection)

    async def get_map_id(
        self,
        image: ee.Image,
        vis_params: dict[str, Any],
    ) -> dict[str, str]:
        """Get map tile URL parameters for an image.

        Args:
            image: ee.Image to visualize
            vis_params: Visualization parameters (min, max, bands, palette)

        Returns:
            Dict with 'tile_url' template and 'token'
        """
        if not self._initialized:
            await self.initialize()

        def _get_map_id():
            map_id = image.getMapId(vis_params)
            return {
                "tile_url": map_id["tile_fetcher"].url_format,
                "token": map_id.get("token", ""),
            }

        return await asyncio.to_thread(_get_map_id)

    async def compute_stats(
        self,
        image: ee.Image,
        region: ee.Geometry,
        scale: int = 100,
        reducer: str = "mean",
    ) -> dict[str, float]:
        """Compute statistics for an image over a region.

        Args:
            image: ee.Image to analyze
            region: ee.Geometry region
            scale: Resolution in meters
            reducer: Reducer type ('mean', 'min', 'max', 'sum', 'std')

        Returns:
            Dict of band statistics
        """
        if not self._initialized:
            await self.initialize()

        def _compute_stats():
            reducers = {
                "mean": ee.Reducer.mean(),
                "min": ee.Reducer.min(),
                "max": ee.Reducer.max(),
                "sum": ee.Reducer.sum(),
                "std": ee.Reducer.stdDev(),
            }

            stats = image.reduceRegion(
                reducer=reducers.get(reducer, ee.Reducer.mean()),
                geometry=region,
                scale=scale,
                maxPixels=1e9,
            )
            return stats.getInfo()

        return await asyncio.to_thread(_compute_stats)

    async def health_check(self) -> bool:
        """Check if GEE connection is healthy."""
        if not self._initialized:
            return False

        try:
            # Simple computation to verify connection
            def _check():
                return ee.Number(1).add(1).getInfo() == 2

            return await asyncio.to_thread(_check)
        except Exception as e:
            logger.warning(f"GEE health check failed: {e}")
            return False


# Nepal bounding box for convenience
NEPAL_BBOX = [80.0, 26.3, 88.2, 30.5]

# Common GEE collections for Nepal
GEE_COLLECTIONS = {
    "sentinel2": "COPERNICUS/S2_SR_HARMONIZED",
    "sentinel1": "COPERNICUS/S1_GRD",
    "landsat8": "LANDSAT/LC08/C02/T1_L2",
    "landsat9": "LANDSAT/LC09/C02/T1_L2",
    "modis_temp": "MODIS/061/MOD11A1",
    "chirps": "UCSB-CHG/CHIRPS/DAILY",
    "srtm": "USGS/SRTMGL1_003",
}
