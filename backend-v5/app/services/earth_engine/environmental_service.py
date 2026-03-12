"""Environmental analysis service using Google Earth Engine.

Provides NDVI, precipitation, and temperature analysis with
historical anomaly detection.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import ee

from .gee_client import GEEClient, GEE_COLLECTIONS, NEPAL_BBOX

logger = logging.getLogger(__name__)


@dataclass
class NDVIResult:
    """Result of NDVI analysis."""
    date: str
    mean_ndvi: float
    min_ndvi: float
    max_ndvi: float
    median_ndvi: float
    std_ndvi: float
    anomaly_pct: float  # Deviation from historical mean
    tile_url_template: Optional[str]
    legend: dict[str, Any]


@dataclass
class PrecipitationResult:
    """Result of precipitation analysis."""
    start_date: str
    end_date: str
    total_mm: float
    daily_values: list[dict[str, Any]]
    anomaly_pct: float
    flood_risk_score: float  # 0-1
    tile_url_template: Optional[str]


@dataclass
class TemperatureResult:
    """Result of temperature analysis."""
    date: str
    mean_celsius: float
    min_celsius: float
    max_celsius: float
    anomaly_celsius: float
    tile_url_template: Optional[str]


class EnvironmentalService:
    """Service for environmental satellite data analysis."""

    # Historical baselines for Nepal (approximate values)
    NEPAL_BASELINES = {
        "ndvi_mean": 0.45,  # Average NDVI for Nepal
        "ndvi_std": 0.15,
        "precip_monthly_mm": {
            1: 15, 2: 25, 3: 35, 4: 65, 5: 120,
            6: 350, 7: 550, 8: 450, 9: 280, 10: 50,
            11: 8, 12: 10,
        },
        "temp_mean_celsius": 20,  # Varies significantly by elevation
    }

    async def get_ndvi(
        self,
        bbox: list[float],
        date: Optional[str] = None,
        compare_date: Optional[str] = None,
    ) -> NDVIResult:
        """Compute NDVI for a region.

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            date: Target date (ISO format). Defaults to most recent.
            compare_date: Optional date to compare against for change detection

        Returns:
            NDVIResult with statistics and tile URL
        """
        gee_client = await GEEClient.get_instance()

        def _compute_ndvi():
            geometry = ee.Geometry.Rectangle(bbox)

            # Determine date range
            if date:
                end_date = datetime.fromisoformat(date.replace("Z", "+00:00"))
            else:
                end_date = datetime.now(timezone.utc)

            start_date = end_date - timedelta(days=30)

            # Get Sentinel-2 imagery
            collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                .filterBounds(geometry)
                .filterDate(
                    start_date.strftime("%Y-%m-%d"),
                    end_date.strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
            )

            # Create median composite
            image = collection.median()

            # Compute NDVI
            ndvi = image.normalizedDifference(["B8", "B4"]).rename("NDVI")

            # Compute statistics
            stats = ndvi.reduceRegion(
                reducer=ee.Reducer.mean()
                .combine(ee.Reducer.min(), "", True)
                .combine(ee.Reducer.max(), "", True)
                .combine(ee.Reducer.median(), "", True)
                .combine(ee.Reducer.stdDev(), "", True),
                geometry=geometry,
                scale=100,
                maxPixels=1e9,
            ).getInfo()

            # Get tile URL
            vis_params = {
                "min": -1,
                "max": 1,
                "palette": [
                    "d73027", "fc8d59", "fee08b",
                    "d9ef8b", "91cf60", "1a9850",
                ],
            }
            map_id = ndvi.clip(geometry).getMapId(vis_params)
            tile_url = map_id["tile_fetcher"].url_format

            return {
                "date": end_date.isoformat(),
                "mean": stats.get("NDVI_mean", 0),
                "min": stats.get("NDVI_min", 0),
                "max": stats.get("NDVI_max", 0),
                "median": stats.get("NDVI_median", 0),
                "std": stats.get("NDVI_stdDev", 0),
                "tile_url": tile_url,
            }

        result = await asyncio.to_thread(_compute_ndvi)

        # Calculate anomaly
        baseline = self.NEPAL_BASELINES["ndvi_mean"]
        anomaly_pct = ((result["mean"] - baseline) / baseline) * 100 if baseline else 0

        return NDVIResult(
            date=result["date"],
            mean_ndvi=round(result["mean"], 4),
            min_ndvi=round(result["min"], 4),
            max_ndvi=round(result["max"], 4),
            median_ndvi=round(result["median"], 4),
            std_ndvi=round(result["std"], 4),
            anomaly_pct=round(anomaly_pct, 2),
            tile_url_template=result["tile_url"],
            legend={
                "colors": ["#d73027", "#fc8d59", "#fee08b", "#d9ef8b", "#91cf60", "#1a9850"],
                "labels": ["< -0.2", "-0.2 to 0", "0 to 0.2", "0.2 to 0.4", "0.4 to 0.6", "> 0.6"],
                "title": "NDVI",
            },
        )

    async def get_precipitation(
        self,
        bbox: list[float],
        start_date: str,
        end_date: str,
    ) -> PrecipitationResult:
        """Get precipitation analysis for a region.

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            start_date: Start date (ISO format)
            end_date: End date (ISO format)

        Returns:
            PrecipitationResult with totals and flood risk score
        """
        gee_client = await GEEClient.get_instance()

        def _compute_precipitation():
            geometry = ee.Geometry.Rectangle(bbox)

            # Get CHIRPS precipitation data
            collection = (
                ee.ImageCollection(GEE_COLLECTIONS["chirps"])
                .filterBounds(geometry)
                .filterDate(start_date, end_date)
            )

            # Compute total
            total_image = collection.sum()
            total_stats = total_image.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=5000,
                maxPixels=1e9,
            ).getInfo()

            # Get daily values
            def get_daily_mean(img):
                date = ee.Date(img.get("system:time_start"))
                mean = img.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=geometry,
                    scale=5000,
                    maxPixels=1e9,
                ).get("precipitation")
                return ee.Feature(None, {
                    "date": date.format("YYYY-MM-dd"),
                    "mm": mean,
                })

            daily = collection.map(get_daily_mean).getInfo()
            daily_values = [
                {"date": f["properties"]["date"], "mm": f["properties"]["mm"] or 0}
                for f in daily["features"]
            ]

            # Get tile URL for total
            vis_params = {
                "min": 0,
                "max": 200,
                "palette": ["ffffff", "add8e6", "0000ff", "00008b"],
            }
            map_id = total_image.clip(geometry).getMapId(vis_params)

            return {
                "total_mm": total_stats.get("precipitation", 0),
                "daily_values": daily_values,
                "tile_url": map_id["tile_fetcher"].url_format,
            }

        result = await asyncio.to_thread(_compute_precipitation)

        # Calculate anomaly and flood risk
        start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        days = (end_dt - start_dt).days or 1

        # Expected precipitation based on month
        month = start_dt.month
        expected_daily = self.NEPAL_BASELINES["precip_monthly_mm"].get(month, 100) / 30
        expected_total = expected_daily * days

        anomaly_pct = ((result["total_mm"] - expected_total) / expected_total) * 100 if expected_total else 0

        # Flood risk score (0-1) based on precipitation intensity
        # High risk if > 3x expected
        flood_risk = min(1.0, max(0.0, (result["total_mm"] / (expected_total * 3)))) if expected_total else 0

        return PrecipitationResult(
            start_date=start_date,
            end_date=end_date,
            total_mm=round(result["total_mm"], 2),
            daily_values=result["daily_values"],
            anomaly_pct=round(anomaly_pct, 2),
            flood_risk_score=round(flood_risk, 3),
            tile_url_template=result["tile_url"],
        )

    async def get_temperature(
        self,
        bbox: list[float],
        date: Optional[str] = None,
    ) -> TemperatureResult:
        """Get land surface temperature analysis.

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            date: Target date (ISO format). Defaults to most recent.

        Returns:
            TemperatureResult with statistics
        """
        gee_client = await GEEClient.get_instance()

        def _compute_temperature():
            geometry = ee.Geometry.Rectangle(bbox)

            # Determine date range
            if date:
                end_date = datetime.fromisoformat(date.replace("Z", "+00:00"))
            else:
                end_date = datetime.now(timezone.utc)

            start_date = end_date - timedelta(days=8)

            # Get MODIS LST data
            collection = (
                ee.ImageCollection(GEE_COLLECTIONS["modis_temp"])
                .filterBounds(geometry)
                .filterDate(
                    start_date.strftime("%Y-%m-%d"),
                    end_date.strftime("%Y-%m-%d"),
                )
                .select("LST_Day_1km")
            )

            # Create composite and convert to Celsius
            # MODIS LST scale factor: 0.02, offset: 0 (result in Kelvin)
            image = collection.median().multiply(0.02).subtract(273.15)

            # Compute statistics
            stats = image.reduceRegion(
                reducer=ee.Reducer.mean()
                .combine(ee.Reducer.min(), "", True)
                .combine(ee.Reducer.max(), "", True),
                geometry=geometry,
                scale=1000,
                maxPixels=1e9,
            ).getInfo()

            # Get tile URL
            vis_params = {
                "min": -10,
                "max": 45,
                "palette": [
                    "040274", "0000ff", "00ffff",
                    "00ff00", "ffff00", "ff0000",
                ],
            }
            map_id = image.clip(geometry).getMapId(vis_params)

            return {
                "date": end_date.isoformat(),
                "mean": stats.get("LST_Day_1km_mean", 0),
                "min": stats.get("LST_Day_1km_min", 0),
                "max": stats.get("LST_Day_1km_max", 0),
                "tile_url": map_id["tile_fetcher"].url_format,
            }

        result = await asyncio.to_thread(_compute_temperature)

        # Calculate anomaly
        baseline = self.NEPAL_BASELINES["temp_mean_celsius"]
        anomaly = result["mean"] - baseline

        return TemperatureResult(
            date=result["date"],
            mean_celsius=round(result["mean"], 2),
            min_celsius=round(result["min"], 2),
            max_celsius=round(result["max"], 2),
            anomaly_celsius=round(anomaly, 2),
            tile_url_template=result["tile_url"],
        )
