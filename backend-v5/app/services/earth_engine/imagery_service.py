"""Disaster imagery analysis service using Google Earth Engine.

Provides flood extent detection, landslide detection, and
before/after comparison imagery.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

import ee

from .gee_client import GEEClient, GEE_COLLECTIONS, NEPAL_BBOX

logger = logging.getLogger(__name__)


@dataclass
class FloodAnalysisResult:
    """Result of flood extent analysis."""
    analysis_id: str
    before_date: str
    after_date: str
    flood_extent_km2: float
    affected_area_pct: float
    permanent_water_km2: float
    flooded_area_km2: float  # New flooding (not permanent water)
    tile_url_template: Optional[str]
    before_image_url: Optional[str]
    after_image_url: Optional[str]
    geojson: Optional[dict[str, Any]]  # Flood polygon


@dataclass
class LandslideDetection:
    """A detected potential landslide."""
    id: str
    center: list[float]  # [lng, lat]
    area_km2: float
    confidence: float  # 0-1
    slope_degrees: float
    ndvi_change: float  # Negative = vegetation loss
    geojson: Optional[dict[str, Any]]


@dataclass
class LandslideAnalysisResult:
    """Result of landslide detection analysis."""
    analysis_id: str
    before_date: str
    after_date: str
    detections: list[LandslideDetection]
    total_affected_km2: float
    tile_url_template: Optional[str]


@dataclass
class BeforeAfterResult:
    """Before/after comparison imagery."""
    before_date: str
    after_date: str
    before_image_url: str
    after_image_url: str
    difference_image_url: Optional[str]


class ImageryService:
    """Service for disaster-related satellite imagery analysis."""

    # SAR water detection threshold (VV backscatter in dB)
    WATER_THRESHOLD_DB = -15

    # Landslide detection parameters
    NDVI_CHANGE_THRESHOLD = -0.2  # Minimum NDVI decrease
    MIN_SLOPE_DEGREES = 15  # Minimum slope for landslide risk
    MIN_LANDSLIDE_AREA_KM2 = 0.001  # ~1000 sq meters

    async def detect_flood_extent(
        self,
        bbox: list[float],
        before_date: str,
        after_date: str,
        water_threshold: float = -15,
    ) -> FloodAnalysisResult:
        """Detect flood extent using Sentinel-1 SAR imagery.

        Uses VV polarization backscatter to detect water:
        - Water surfaces have low backscatter (< -15 dB typically)
        - Compares before/after to identify new flooding

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            before_date: Date before flood (ISO format)
            after_date: Date after/during flood (ISO format)
            water_threshold: SAR threshold for water detection (dB)

        Returns:
            FloodAnalysisResult with extent statistics and imagery URLs
        """
        gee_client = await GEEClient.get_instance()
        analysis_id = str(uuid4())

        def _detect_flood():
            geometry = ee.Geometry.Rectangle(bbox)
            area_km2 = geometry.area().divide(1e6).getInfo()

            # Parse dates
            before_dt = datetime.fromisoformat(before_date.replace("Z", "+00:00"))
            after_dt = datetime.fromisoformat(after_date.replace("Z", "+00:00"))

            # Get Sentinel-1 imagery - BEFORE
            before_collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel1"])
                .filterBounds(geometry)
                .filterDate(
                    (before_dt - timedelta(days=15)).strftime("%Y-%m-%d"),
                    before_dt.strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.eq("instrumentMode", "IW"))
                .select("VV")
            )
            before_image = before_collection.median().clip(geometry)

            # Get Sentinel-1 imagery - AFTER
            after_collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel1"])
                .filterBounds(geometry)
                .filterDate(
                    after_dt.strftime("%Y-%m-%d"),
                    (after_dt + timedelta(days=15)).strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                .filter(ee.Filter.eq("instrumentMode", "IW"))
                .select("VV")
            )
            after_image = after_collection.median().clip(geometry)

            # Detect water in both periods
            water_before = before_image.lt(water_threshold)
            water_after = after_image.lt(water_threshold)

            # New flooding = water after but not before
            new_flooding = water_after.And(water_before.Not())

            # Calculate areas
            pixel_area = ee.Image.pixelArea()

            permanent_water_area = (
                water_before.multiply(pixel_area)
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=geometry,
                    scale=10,
                    maxPixels=1e9,
                )
                .get("VV")
            )

            flood_area = (
                new_flooding.multiply(pixel_area)
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=geometry,
                    scale=10,
                    maxPixels=1e9,
                )
                .get("VV")
            )

            total_water_area = (
                water_after.multiply(pixel_area)
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=geometry,
                    scale=10,
                    maxPixels=1e9,
                )
                .get("VV")
            )

            # Get tile URLs
            flood_vis = {"min": 0, "max": 1, "palette": ["000000", "0000ff"]}
            flood_map_id = new_flooding.selfMask().getMapId(flood_vis)

            sar_vis = {"min": -25, "max": 0}
            before_map_id = before_image.getMapId(sar_vis)
            after_map_id = after_image.getMapId(sar_vis)

            return {
                "area_km2": area_km2,
                "permanent_water_m2": ee.Number(permanent_water_area).getInfo() or 0,
                "flood_m2": ee.Number(flood_area).getInfo() or 0,
                "total_water_m2": ee.Number(total_water_area).getInfo() or 0,
                "flood_tile_url": flood_map_id["tile_fetcher"].url_format,
                "before_tile_url": before_map_id["tile_fetcher"].url_format,
                "after_tile_url": after_map_id["tile_fetcher"].url_format,
            }

        result = await asyncio.to_thread(_detect_flood)

        # Convert to km2
        permanent_water_km2 = result["permanent_water_m2"] / 1e6
        flooded_km2 = result["flood_m2"] / 1e6
        total_water_km2 = result["total_water_m2"] / 1e6
        area_km2 = result["area_km2"]

        return FloodAnalysisResult(
            analysis_id=analysis_id,
            before_date=before_date,
            after_date=after_date,
            flood_extent_km2=round(total_water_km2, 4),
            affected_area_pct=round((total_water_km2 / area_km2) * 100, 2) if area_km2 else 0,
            permanent_water_km2=round(permanent_water_km2, 4),
            flooded_area_km2=round(flooded_km2, 4),
            tile_url_template=result["flood_tile_url"],
            before_image_url=result["before_tile_url"],
            after_image_url=result["after_tile_url"],
            geojson=None,  # Could add vectorization in future
        )

    async def detect_landslides(
        self,
        bbox: list[float],
        before_date: str,
        after_date: str,
        sensitivity: float = 0.5,
    ) -> LandslideAnalysisResult:
        """Detect potential landslides from vegetation loss on steep terrain.

        Algorithm:
        1. Compute NDVI for before and after dates
        2. Calculate NDVI difference
        3. Get slope from SRTM DEM
        4. Identify areas with significant vegetation loss on steep slopes
        5. Cluster and filter detections

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            before_date: Date before event (ISO format)
            after_date: Date after event (ISO format)
            sensitivity: Detection sensitivity (0-1), higher = more detections

        Returns:
            LandslideAnalysisResult with detections and tile URL
        """
        gee_client = await GEEClient.get_instance()
        analysis_id = str(uuid4())

        # Adjust thresholds based on sensitivity
        ndvi_threshold = self.NDVI_CHANGE_THRESHOLD * (2 - sensitivity)
        min_slope = self.MIN_SLOPE_DEGREES * (1.5 - sensitivity * 0.5)

        def _detect_landslides():
            geometry = ee.Geometry.Rectangle(bbox)

            # Parse dates
            before_dt = datetime.fromisoformat(before_date.replace("Z", "+00:00"))
            after_dt = datetime.fromisoformat(after_date.replace("Z", "+00:00"))

            # Get Sentinel-2 imagery - BEFORE
            before_collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                .filterBounds(geometry)
                .filterDate(
                    (before_dt - timedelta(days=30)).strftime("%Y-%m-%d"),
                    before_dt.strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
            )
            before_image = before_collection.median()
            before_ndvi = before_image.normalizedDifference(["B8", "B4"])

            # Get Sentinel-2 imagery - AFTER
            after_collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                .filterBounds(geometry)
                .filterDate(
                    after_dt.strftime("%Y-%m-%d"),
                    (after_dt + timedelta(days=30)).strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
            )
            after_image = after_collection.median()
            after_ndvi = after_image.normalizedDifference(["B8", "B4"])

            # NDVI difference (negative = vegetation loss)
            ndvi_diff = after_ndvi.subtract(before_ndvi)

            # Get slope from SRTM DEM
            dem = ee.Image(GEE_COLLECTIONS["srtm"])
            slope = ee.Terrain.slope(dem)

            # Identify potential landslides
            # Criteria: significant vegetation loss on steep slopes
            potential_landslides = (
                ndvi_diff.lt(ndvi_threshold)
                .And(slope.gt(min_slope))
            ).selfMask()

            # Calculate total affected area
            pixel_area = ee.Image.pixelArea()
            affected_area = (
                potential_landslides.multiply(pixel_area)
                .reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=geometry,
                    scale=10,
                    maxPixels=1e9,
                )
                .values()
                .get(0)
            )

            # Get tile URL for visualization
            diff_vis = {
                "min": -0.5,
                "max": 0.5,
                "palette": ["ff0000", "ffff00", "ffffff", "00ff00"],
            }
            diff_map_id = ndvi_diff.clip(geometry).getMapId(diff_vis)

            landslide_vis = {"min": 0, "max": 1, "palette": ["000000", "ff4500"]}
            landslide_map_id = potential_landslides.clip(geometry).getMapId(landslide_vis)

            return {
                "affected_area_m2": ee.Number(affected_area).getInfo() or 0,
                "diff_tile_url": diff_map_id["tile_fetcher"].url_format,
                "landslide_tile_url": landslide_map_id["tile_fetcher"].url_format,
            }

        result = await asyncio.to_thread(_detect_landslides)

        affected_km2 = result["affected_area_m2"] / 1e6

        # For now, return aggregate result
        # In production, would cluster and return individual detections
        detections = []
        if affected_km2 > self.MIN_LANDSLIDE_AREA_KM2:
            # Single aggregate detection for simplicity
            center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
            detections.append(
                LandslideDetection(
                    id=str(uuid4()),
                    center=center,
                    area_km2=round(affected_km2, 4),
                    confidence=min(0.9, 0.5 + sensitivity * 0.3),
                    slope_degrees=25,  # Placeholder
                    ndvi_change=self.NDVI_CHANGE_THRESHOLD,
                    geojson=None,
                )
            )

        return LandslideAnalysisResult(
            analysis_id=analysis_id,
            before_date=before_date,
            after_date=after_date,
            detections=detections,
            total_affected_km2=round(affected_km2, 4),
            tile_url_template=result["landslide_tile_url"],
        )

    async def generate_before_after(
        self,
        bbox: list[float],
        before_date: str,
        after_date: str,
        visualization: str = "true-color",
    ) -> BeforeAfterResult:
        """Generate before/after comparison imagery.

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            before_date: Date before event (ISO format)
            after_date: Date after event (ISO format)
            visualization: 'true-color' or 'false-color'

        Returns:
            BeforeAfterResult with image URLs
        """
        gee_client = await GEEClient.get_instance()

        vis_params = {
            "true-color": {"bands": ["B4", "B3", "B2"], "min": 0, "max": 3000},
            "false-color": {"bands": ["B8", "B4", "B3"], "min": 0, "max": 5000},
        }.get(visualization, {"bands": ["B4", "B3", "B2"], "min": 0, "max": 3000})

        def _generate_imagery():
            geometry = ee.Geometry.Rectangle(bbox)

            # Parse dates
            before_dt = datetime.fromisoformat(before_date.replace("Z", "+00:00"))
            after_dt = datetime.fromisoformat(after_date.replace("Z", "+00:00"))

            # Get before image (extend range to 60 days and relax cloud filter to 50%)
            before_collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                .filterBounds(geometry)
                .filterDate(
                    (before_dt - timedelta(days=60)).strftime("%Y-%m-%d"),
                    before_dt.strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 50))
            )

            # Check if collection has images
            before_count = before_collection.size().getInfo()
            if before_count == 0:
                raise ValueError(f"No Sentinel-2 imagery available for 'before' date range (60 days before {before_date})")

            before_image = before_collection.median().clip(geometry)

            # Get after image (extend range to 60 days and relax cloud filter to 50%)
            after_collection = (
                ee.ImageCollection(GEE_COLLECTIONS["sentinel2"])
                .filterBounds(geometry)
                .filterDate(
                    after_dt.strftime("%Y-%m-%d"),
                    (after_dt + timedelta(days=60)).strftime("%Y-%m-%d"),
                )
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 50))
            )

            # Check if collection has images
            after_count = after_collection.size().getInfo()
            if after_count == 0:
                raise ValueError(f"No Sentinel-2 imagery available for 'after' date range (60 days after {after_date})")

            after_image = after_collection.median().clip(geometry)

            # Generate tile URLs
            before_map_id = before_image.getMapId(vis_params)
            after_map_id = after_image.getMapId(vis_params)

            return {
                "before_url": before_map_id["tile_fetcher"].url_format,
                "after_url": after_map_id["tile_fetcher"].url_format,
                "before_count": before_count,
                "after_count": after_count,
            }

        result = await asyncio.to_thread(_generate_imagery)

        return BeforeAfterResult(
            before_date=before_date,
            after_date=after_date,
            before_image_url=result["before_url"],
            after_image_url=result["after_url"],
            difference_image_url=None,  # Skip diff to avoid band mismatch issues
        )
