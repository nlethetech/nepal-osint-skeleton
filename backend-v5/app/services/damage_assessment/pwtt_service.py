"""PWTT (Pixel-Wise T-Test) Damage Detection Service.

Wraps the oballinger/PWTT library for accurate satellite-based damage detection.
Source: https://github.com/oballinger/PWTT

Key methodology:
1. Two-sample pooled t-test for change detection using Sentinel-1 SAR
2. Lee speckle filter with 2-pixel kernel
3. Multi-scale Gaussian convolution (50m, 100m, 150m radii)
4. Dynamic World urban masking (built-up >= 0.1)
5. Uses both VV and VH polarization, takes max change

Original benchmark: AUC 84.17%, validated across 23 cities in 4 countries.
"""

import asyncio
import logging
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from uuid import uuid4

import ee

logger = logging.getLogger(__name__)

# Add the PWTT library to path
PWTT_LIB_PATH = Path(__file__).parent.parent.parent.parent / "pwtt_lib" / "code"
if str(PWTT_LIB_PATH) not in sys.path:
    sys.path.insert(0, str(PWTT_LIB_PATH))

def _load_pwtt_lib():
    """Load the optional PWTT library.

    The bundled PWTT implementation depends on optional heavy geo packages
    (e.g. `geemap`). We import lazily so the core API can boot without these
    extras, while PWTT endpoints return a clear error when unavailable.
    """
    try:
        import pwtt as pwtt_lib  # type: ignore
        return pwtt_lib
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(
            "PWTT optional dependencies are not installed (missing `geemap` or related packages). "
            "Install the PWTT extras to enable damage detection."
        ) from exc

from app.services.earth_engine.gee_client import GEEClient, GEE_COLLECTIONS

# Damage threshold — matches oballinger/PWTT (t > 3.0 is damaged)
DAMAGE_THRESHOLD = 3.0


@dataclass
class DamageHotspot:
    """A detected damage hotspot (cluster of damaged pixels)."""
    hotspot_id: str
    centroid_lat: float
    centroid_lng: float
    area_km2: float
    severity: str  # critical, severe, moderate, minor
    mean_t_stat: float
    pixel_count: int


@dataclass
class PWTTResult:
    """Result of PWTT damage detection."""
    analysis_id: str
    bbox: list[float]
    event_date: str

    # Area statistics (km²)
    total_area_km2: float
    damaged_area_km2: float
    damage_percentage: float

    # Severity breakdown (km²) - based on |t| values
    critical_area_km2: float   # |t| > 4.0 (very high confidence)
    severe_area_km2: float     # 3.5 < |t| <= 4.0
    moderate_area_km2: float   # 3.0 < |t| <= 3.5
    minor_area_km2: float      # 2.5 < |t| <= 3.0

    # Tile URLs for visualization
    damage_tile_url: Optional[str]      # Damage probability heatmap
    t_stat_tile_url: Optional[str]      # Raw t-statistic (absolute value)
    before_rgb_tile_url: Optional[str]  # Pre-event Sentinel-2
    after_rgb_tile_url: Optional[str]   # Post-event Sentinel-2
    before_sar_tile_url: Optional[str]  # Pre-event SAR
    after_sar_tile_url: Optional[str]   # Post-event SAR

    # Metadata
    baseline_images_count: int
    post_images_count: int
    confidence_score: float

    # Detected hotspots
    hotspots: list[DamageHotspot] = field(default_factory=list)

    # Building-level damage (GeoJSON features with per-building t-stat)
    building_damage_geojson: Optional[list[dict]] = field(default_factory=list)

    # Error info (if any)
    error: Optional[str] = None


class PWTTService:
    """PWTT damage detection service using oballinger/PWTT library.

    Uses the validated Pixel-Wise T-Test algorithm for SAR-based damage detection.
    Achieves ~84% AUC across 23 cities in 4 countries (Gaza, Ukraine, Syria, Iraq).
    """

    # Severity thresholds based on t-statistic values
    T_STAT_CRITICAL = 4.0    # Very high confidence damage
    T_STAT_SEVERE = 3.5      # High confidence damage
    T_STAT_MODERATE = 3.0    # Confirmed damage (original threshold)
    T_STAT_MINOR = 2.5       # Possible damage

    # Visualization parameters
    DAMAGE_VIS = {
        'min': 0,
        'max': 1,
        'palette': [
            '1a9850',  # Dark green - no damage
            '66bd63',  # Medium green - minimal
            'a6d96a',  # Light green - very minor
            'fee08b',  # Yellow - minor damage
            'fdae61',  # Light orange - moderate
            'f46d43',  # Orange - significant
            'd73027',  # Red - severe
            'a50026',  # Dark red - critical
        ]
    }

    T_STAT_VIS = {
        'min': 0,
        'max': 10,
        'opacity': 0.7,
        'palette': [
            '440154',  # Deep purple - no change
            '482878',  # Dark purple
            '3e4989',  # Indigo
            '31688e',  # Blue-teal
            '26828e',  # Teal
            '1f9e89',  # Green-teal
            '35b779',  # Green
            '6ece58',  # Light green
            'b5de2b',  # Yellow-green
            'fde725',  # Yellow - significant damage
        ]
    }

    SAR_VIS = {
        'min': -25,
        'max': 0,
        'palette': ['000000', '333333', '555555', '777777', '999999', 'bbbbbb', 'dddddd', 'ffffff']
    }

    RGB_VIS = {'bands': ['B4', 'B3', 'B2'], 'min': 0, 'max': 2500}

    def _mask_clouds_s2(self, image: ee.Image) -> ee.Image:
        """Mask clouds in Sentinel-2 imagery using QA60 band."""
        qa = image.select('QA60')
        cloud_bit_mask = 1 << 10
        cirrus_bit_mask = 1 << 11
        mask = qa.bitwiseAnd(cloud_bit_mask).eq(0).And(
            qa.bitwiseAnd(cirrus_bit_mask).eq(0)
        )
        return image.updateMask(mask)

    async def detect_damage(
        self,
        bbox: list[float],
        event_date: str,
        baseline_days: int = 365,  # 12 months baseline
        post_event_days: int = 60,  # 2 months post-event
    ) -> PWTTResult:
        """
        Run PWTT damage detection using oballinger/PWTT algorithm.

        Args:
            bbox: Bounding box [min_lng, min_lat, max_lng, max_lat]
            event_date: Date of damage event (ISO format, e.g., "2025-09-08")
            baseline_days: Days before event for baseline imagery (default 365)
            post_event_days: Days after event to search (default 60)

        Returns:
            PWTTResult with damage statistics, tile URLs, and detected hotspots
        """
        gee_client = await GEEClient.get_instance()
        analysis_id = str(uuid4())

        def _run_pwtt():
            # Import PWTT core functions (lee_filter, ttest from oballinger/PWTT)
            from pwtt_lib.code.pwtt import lee_filter, ttest

            geometry = ee.Geometry.Rectangle(bbox)
            area_km2 = geometry.area().divide(1e6).getInfo()

            # Parse dates
            if isinstance(event_date, str):
                event_dt = datetime.fromisoformat(event_date.replace('Z', '+00:00').replace('+00:00', ''))
            else:
                event_dt = event_date

            event_date_str = event_dt.strftime('%Y-%m-%d')
            pre_months = max(1, baseline_days // 30)
            post_months = max(1, post_event_days // 30)

            # ═══════════════════════════════════════════════════════════════
            # Compute raw T-statistic — exact pwtt_building_level.py approach
            # Uses oballinger/PWTT lee_filter + ttest functions directly
            # NO Gaussian smoothing, NO urban masking — raw per-pixel values
            # for maximum building-level accuracy
            # ═══════════════════════════════════════════════════════════════
            try:
                # Get orbits available in post-event period
                orbits = (
                    ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                    .filter(ee.Filter.eq("instrumentMode", "IW"))
                    .filterBounds(geometry)
                    .filterDate(
                        ee.Date(event_date_str),
                        ee.Date(event_date_str).advance(post_months, 'months'),
                    )
                    .aggregate_array('relativeOrbitNumber_start')
                    .distinct()
                )

                # Per-orbit: lee_filter → log → ttest, then max across orbits
                def map_orbit(orbit):
                    s1 = (
                        ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                        .filter(ee.Filter.eq("instrumentMode", "IW"))
                        .filter(ee.Filter.eq("relativeOrbitNumber_start", orbit))
                        .map(lee_filter)
                        .select(['VV', 'VH'])
                        .map(lambda image: image.log())
                        .filterBounds(geometry)
                    )
                    # CRITICAL: both inference_start and war_start = event_date
                    # Pre-event: event_date - pre_months → event_date
                    # Post-event: event_date → event_date + post_months
                    return ttest(s1, ee.Date(event_date_str), ee.Date(event_date_str), pre_months, post_months)

                image = ee.ImageCollection(orbits.map(map_orbit)).max()

                # Max of VV and VH t-statistics (as per PWTT flowchart: Max[T])
                t_stat = image.select('VV').max(image.select('VH')).rename('T_statistic')
                t_stat = t_stat.clip(geometry)

                logger.info("PWTT raw T-statistic computed — oballinger/PWTT lee_filter + ttest")
            except Exception as e:
                logger.error(f"PWTT analysis failed: {e}")
                return {
                    'error': f'PWTT analysis failed: {str(e)}',
                    'area_km2': area_km2,
                    'baseline_count': 0,
                    'post_count': 0,
                }

            # ═══════════════════════════════════════════════════════════════
            # Image counts for confidence scoring
            # ═══════════════════════════════════════════════════════════════
            s1_collection = (
                ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                .filter(ee.Filter.eq("instrumentMode", "IW"))
                .filterBounds(geometry)
            )

            before_start = (event_dt - timedelta(days=baseline_days)).strftime('%Y-%m-%d')
            after_end = (event_dt + timedelta(days=post_event_days)).strftime('%Y-%m-%d')

            baseline_count = s1_collection.filterDate(before_start, event_date_str).size().getInfo()
            post_count = s1_collection.filterDate(event_date_str, after_end).size().getInfo()

            # ═══════════════════════════════════════════════════════════════
            # Area statistics from raw T-statistic
            # ═══════════════════════════════════════════════════════════════
            pixel_area = ee.Image.pixelArea()
            damage_binary = t_stat.gte(DAMAGE_THRESHOLD)

            def get_area_value(mask_image):
                result = mask_image.multiply(pixel_area).reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=geometry,
                    scale=10,
                    maxPixels=1e9,
                )
                val = result.values().get(0)
                return ee.Number(ee.Algorithms.If(val, val, 0))

            damaged_area = get_area_value(damage_binary)
            critical_area = get_area_value(t_stat.gte(self.T_STAT_CRITICAL))
            severe_area = get_area_value(
                t_stat.gte(self.T_STAT_SEVERE).And(t_stat.lt(self.T_STAT_CRITICAL))
            )
            moderate_area = get_area_value(
                t_stat.gte(self.T_STAT_MODERATE).And(t_stat.lt(self.T_STAT_SEVERE))
            )
            minor_area = get_area_value(
                t_stat.gte(self.T_STAT_MINOR).And(t_stat.lt(self.T_STAT_MODERATE))
            )

            # ═══════════════════════════════════════════════════════════════
            # Building-level damage — exact pwtt_building_level.py approach
            # reduceRegions with mean+max reducers at scale=10
            # ═══════════════════════════════════════════════════════════════
            building_features = []
            try:
                buildings_fc = (
                    ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
                    .filterBounds(geometry)
                )

                building_count = buildings_fc.size().getInfo()
                logger.info(f"Found {building_count} buildings from Google Open Buildings")

                if building_count > 0:
                    # reduceRegions on ALL buildings (no pre-limit) — matching
                    # the reference script which processes all buildings then
                    # limits at getInfo time. This ensures large important
                    # buildings (like Singha Durbar) are never excluded.
                    buildings_with_stats = t_stat.reduceRegions(
                        collection=buildings_fc,
                        reducer=ee.Reducer.mean().combine(
                            reducer2=ee.Reducer.max(),
                            sharedInputs=True,
                        ),
                        scale=10,
                        tileScale=4,
                    )

                    # Classify damage per building based on mean T_statistic
                    # Guard against null (buildings outside raster coverage)
                    def classify_building(feature):
                        mean_raw = feature.get('mean')
                        max_raw = feature.get('max')
                        mean_t = ee.Number(ee.Algorithms.If(mean_raw, mean_raw, 0)).max(0)
                        max_t = ee.Number(ee.Algorithms.If(max_raw, max_raw, 0)).max(0)
                        severity = ee.Algorithms.If(
                            mean_t.gt(6), 'critical',
                            ee.Algorithms.If(
                                mean_t.gt(4.5), 'severe',
                                ee.Algorithms.If(
                                    mean_t.gt(DAMAGE_THRESHOLD), 'moderate',
                                    'undamaged'
                                )
                            )
                        )
                        return feature.set({
                            'mean_t_stat': mean_t,
                            'max_t_stat': max_t,
                            'severity': severity,
                        })

                    classified = buildings_with_stats.map(classify_building)

                    # Sort by t-stat descending so damaged buildings are always
                    # included even if we hit the getInfo limit
                    classified_sorted = classified.sort('mean_t_stat', False)
                    results_info = classified_sorted.limit(2000).getInfo()

                    if results_info and results_info.get('features'):
                        for feature in results_info['features']:
                            props = feature.get('properties', {})
                            geom = feature.get('geometry')
                            if not geom:
                                continue

                            mean_t = props.get('mean_t_stat', 0) or 0
                            max_t = props.get('max_t_stat', 0) or 0
                            severity = props.get('severity', 'undamaged') or 'undamaged'

                            coords = geom.get('coordinates', [[]])
                            poly_coords = coords[0] if geom['type'] == 'Polygon' else (coords[0][0] if coords else [])
                            if poly_coords:
                                lngs = [c[0] for c in poly_coords]
                                lats = [c[1] for c in poly_coords]
                                centroid_lng = sum(lngs) / len(lngs)
                                centroid_lat = sum(lats) / len(lats)
                            else:
                                centroid_lat = centroid_lng = 0

                            building_features.append({
                                'type': 'Feature',
                                'geometry': geom,
                                'properties': {
                                    'mean_t_stat': round(mean_t, 3) if isinstance(mean_t, (int, float)) else 0,
                                    'max_t_stat': round(max_t, 3) if isinstance(max_t, (int, float)) else 0,
                                    'severity': severity,
                                    'centroid_lat': centroid_lat,
                                    'centroid_lng': centroid_lng,
                                    'area_m2': props.get('area_in_meters', 0) or 0,
                                },
                            })

                        damaged_count = sum(1 for b in building_features if b['properties']['severity'] != 'undamaged')
                        logger.info(
                            f"Building-level: {len(building_features)} total, {damaged_count} damaged"
                        )
            except Exception as e:
                logger.warning(f"Building-level detection failed (non-fatal): {e}")

            # ═══════════════════════════════════════════════════════════════
            # Generate visualization tiles
            # ═══════════════════════════════════════════════════════════════
            # T-statistic heatmap (raw, viridis, min=0, max=10)
            t_stat_map_id = t_stat.clip(geometry).getMapId(self.T_STAT_VIS)

            # Damage probability overlay (normalized 0-1)
            damage_prob = t_stat.subtract(3).divide(2).clamp(0, 1)
            damage_prob_masked = damage_prob.updateMask(t_stat.gte(2.5))
            damage_map_id = damage_prob_masked.clip(geometry).getMapId(self.DAMAGE_VIS)

            # SAR imagery (before/after)
            before_sar_url = None
            after_sar_url = None
            try:
                s1_vv = (
                    ee.ImageCollection("COPERNICUS/S1_GRD")
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
                    .filter(ee.Filter.eq("instrumentMode", "IW"))
                    .filterBounds(geometry)
                    .select('VV')
                )
                before_sar = s1_vv.filterDate(before_start, event_date_str).mean().clip(geometry)
                before_sar_map_id = before_sar.getMapId(self.SAR_VIS)
                before_sar_url = before_sar_map_id['tile_fetcher'].url_format

                after_sar = s1_vv.filterDate(event_date_str, after_end).mean().clip(geometry)
                after_sar_map_id = after_sar.getMapId(self.SAR_VIS)
                after_sar_url = after_sar_map_id['tile_fetcher'].url_format
            except Exception as e:
                logger.warning(f"SAR visualization failed: {e}")

            # RGB imagery (Sentinel-2)
            before_rgb_url = None
            after_rgb_url = None
            try:
                s2 = (
                    ee.ImageCollection(GEE_COLLECTIONS['sentinel2'])
                    .filterBounds(geometry)
                    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
                    .map(self._mask_clouds_s2)
                )
                before_rgb = s2.filterDate(
                    (event_dt - timedelta(days=90)).strftime('%Y-%m-%d'),
                    event_date_str,
                ).median().clip(geometry)
                before_rgb_map_id = before_rgb.getMapId(self.RGB_VIS)
                before_rgb_url = before_rgb_map_id['tile_fetcher'].url_format

                after_rgb = s2.filterDate(event_date_str, after_end).median().clip(geometry)
                after_rgb_map_id = after_rgb.getMapId(self.RGB_VIS)
                after_rgb_url = after_rgb_map_id['tile_fetcher'].url_format
            except Exception as e:
                logger.warning(f"RGB visualization failed: {e}")

            return {
                'area_km2': area_km2,
                'damaged_m2': damaged_area.getInfo() or 0,
                'critical_m2': critical_area.getInfo() or 0,
                'severe_m2': severe_area.getInfo() or 0,
                'moderate_m2': moderate_area.getInfo() or 0,
                'minor_m2': minor_area.getInfo() or 0,
                'baseline_count': baseline_count,
                'post_count': post_count,
                'damage_tile_url': damage_map_id['tile_fetcher'].url_format,
                't_stat_tile_url': t_stat_map_id['tile_fetcher'].url_format,
                'before_rgb_tile_url': before_rgb_url,
                'after_rgb_tile_url': after_rgb_url,
                'before_sar_tile_url': before_sar_url,
                'after_sar_tile_url': after_sar_url,
                'hotspots': [],
                'building_features': building_features,
                'error': None,
            }

        try:
            result = await asyncio.to_thread(_run_pwtt)
        except Exception as e:
            logger.exception(f"PWTT analysis failed: {e}")
            return PWTTResult(
                analysis_id=analysis_id,
                bbox=bbox,
                event_date=event_date,
                total_area_km2=0,
                damaged_area_km2=0,
                damage_percentage=0,
                critical_area_km2=0,
                severe_area_km2=0,
                moderate_area_km2=0,
                minor_area_km2=0,
                damage_tile_url=None,
                t_stat_tile_url=None,
                before_rgb_tile_url=None,
                after_rgb_tile_url=None,
                before_sar_tile_url=None,
                after_sar_tile_url=None,
                baseline_images_count=0,
                post_images_count=0,
                confidence_score=0,
                hotspots=[],
                error=str(e),
            )

        # Handle error case
        if result.get('error'):
            return PWTTResult(
                analysis_id=analysis_id,
                bbox=bbox,
                event_date=event_date,
                total_area_km2=result.get('area_km2', 0),
                damaged_area_km2=0,
                damage_percentage=0,
                critical_area_km2=0,
                severe_area_km2=0,
                moderate_area_km2=0,
                minor_area_km2=0,
                damage_tile_url=None,
                t_stat_tile_url=None,
                before_rgb_tile_url=None,
                after_rgb_tile_url=None,
                before_sar_tile_url=None,
                after_sar_tile_url=None,
                baseline_images_count=result.get('baseline_count', 0),
                post_images_count=result.get('post_count', 0),
                confidence_score=0,
                hotspots=[],
                error=result['error'],
            )

        # Convert m² to km²
        damaged_km2 = result['damaged_m2'] / 1e6
        area_km2 = result['area_km2']

        # Calculate confidence score
        baseline_factor = min(1.0, result['baseline_count'] / 60)
        post_factor = min(1.0, result['post_count'] / 10)

        damage_pct = (damaged_km2 / area_km2) * 100 if area_km2 > 0 else 0
        if damage_pct >= 10:
            signal_factor = 0.9
        elif damage_pct >= 5:
            signal_factor = 0.7
        elif damage_pct >= 1:
            signal_factor = 0.5
        else:
            signal_factor = 0.3

        raw_confidence = (
            baseline_factor * 0.30 +
            post_factor * 0.20 +
            signal_factor * 0.50
        )
        confidence = max(0.2, min(0.95, raw_confidence))

        # Convert hotspot dicts to dataclass
        hotspot_objects = [
            DamageHotspot(
                hotspot_id=h['hotspot_id'],
                centroid_lat=bbox[1] + (bbox[3] - bbox[1]) / 2,
                centroid_lng=bbox[0] + (bbox[2] - bbox[0]) / 2,
                area_km2=h['area_km2'],
                severity=h['severity'],
                mean_t_stat=3.5,
                pixel_count=h['pixel_count'],
            )
            for h in result.get('hotspots', [])
        ]

        return PWTTResult(
            analysis_id=analysis_id,
            bbox=bbox,
            event_date=event_date,
            total_area_km2=round(area_km2, 4),
            damaged_area_km2=round(damaged_km2, 4),
            damage_percentage=round((damaged_km2 / area_km2) * 100, 2) if area_km2 else 0,
            critical_area_km2=round(result['critical_m2'] / 1e6, 4),
            severe_area_km2=round(result['severe_m2'] / 1e6, 4),
            moderate_area_km2=round(result['moderate_m2'] / 1e6, 4),
            minor_area_km2=round(result['minor_m2'] / 1e6, 4),
            damage_tile_url=result['damage_tile_url'],
            t_stat_tile_url=result['t_stat_tile_url'],
            before_rgb_tile_url=result['before_rgb_tile_url'],
            after_rgb_tile_url=result['after_rgb_tile_url'],
            before_sar_tile_url=result['before_sar_tile_url'],
            after_sar_tile_url=result['after_sar_tile_url'],
            baseline_images_count=result['baseline_count'],
            post_images_count=result['post_count'],
            confidence_score=round(confidence, 3),
            hotspots=hotspot_objects,
            building_damage_geojson=result.get('building_features', []),
            error=None,
        )

    async def analyze_polygon(
        self,
        geometry_geojson: dict,
        event_date: str,
        baseline_days: int = 365,
        post_event_days: int = 60,
    ) -> PWTTResult:
        """Run PWTT damage detection on a custom polygon."""
        coords = geometry_geojson.get('coordinates', [[]])[0]
        if coords:
            lngs = [c[0] for c in coords]
            lats = [c[1] for c in coords]
            bbox = [min(lngs), min(lats), max(lngs), max(lats)]
        else:
            bbox = [0, 0, 0, 0]
        return await self.detect_damage(bbox, event_date, baseline_days, post_event_days)

    async def generate_three_panel_image(
        self,
        bbox: list[float],
        event_date: str,
        baseline_days: int = 365,
        post_event_days: int = 60,
    ) -> bytes:
        """
        Generate a high-quality 3-panel PNG: Pre Destruction | Post Destruction | PWTT Heatmap.

        Uses inline helper functions to avoid importing from scripts that have
        ee.Initialize() at module level (which conflicts with async GEE init).
        """
        import io
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.patheffects as path_effects
        from matplotlib.patches import Rectangle, Polygon
        import numpy as np
        from PIL import Image
        import requests
        from io import BytesIO

        gee_client = await GEEClient.get_instance()

        # Import PWTT functions from the bundled library (safe - no ee.Initialize)
        from pwtt_lib.code.pwtt import lee_filter, ttest

        def _run_analysis():
            """Run PWTT analysis and generate three-panel image."""
            # Calculate dimensions for logging
            lon_diff = bbox[2] - bbox[0]
            lat_diff = bbox[3] - bbox[1]
            lat_center = (bbox[1] + bbox[3]) / 2
            width_km = lon_diff * 111.32 * np.cos(np.radians(lat_center))
            height_km = lat_diff * 111.32
            logger.info(f"[THREE-PANEL] Starting analysis:")
            logger.info(f"[THREE-PANEL]   bbox: [{bbox[0]:.6f}, {bbox[1]:.6f}, {bbox[2]:.6f}, {bbox[3]:.6f}]")
            logger.info(f"[THREE-PANEL]   size: {width_km:.3f} km x {height_km:.3f} km")
            logger.info(f"[THREE-PANEL]   area: {width_km * height_km:.4f} km²")

            # Parse event date
            if isinstance(event_date, str):
                event_dt = datetime.fromisoformat(event_date.replace('Z', '+00:00').replace('+00:00', ''))
            else:
                event_dt = event_date

            before_start = (event_dt - timedelta(days=baseline_days)).strftime('%Y-%m-%d')
            before_end = (event_dt - timedelta(days=1)).strftime('%Y-%m-%d')
            after_start = event_dt.strftime('%Y-%m-%d')
            after_end = (event_dt + timedelta(days=post_event_days)).strftime('%Y-%m-%d')

            logger.info(f"[THREE-PANEL] Before: {before_start} to {before_end}")
            logger.info(f"[THREE-PANEL] After: {after_start} to {after_end}")

            region = ee.Geometry.Rectangle(bbox)

            # ─────────────────────────────────────────────────────────────────
            # Helper: Calculate raw T-statistic (inline to avoid import issues)
            # ─────────────────────────────────────────────────────────────────
            def _calc_tstat(aoi, event_date_str, pre_months, post_months):
                inference_start = ee.Date(event_date_str)
                war_start = ee.Date(event_date_str)

                orbits = ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT") \
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")) \
                    .filter(ee.Filter.eq("instrumentMode", "IW")) \
                    .filterBounds(aoi) \
                    .filterDate(inference_start, inference_start.advance(post_months, 'months')) \
                    .aggregate_array('relativeOrbitNumber_start') \
                    .distinct()

                def map_orbit(orbit):
                    s1 = ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT") \
                        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH")) \
                        .filter(ee.Filter.eq("instrumentMode", "IW")) \
                        .filter(ee.Filter.eq("relativeOrbitNumber_start", orbit)) \
                        .map(lee_filter) \
                        .select(['VV', 'VH']) \
                        .map(lambda image: image.log()) \
                        .filterBounds(aoi)
                    return ttest(s1, inference_start, war_start, pre_months, post_months)

                image = ee.ImageCollection(orbits.map(map_orbit)).max()
                t_stat = image.select('VV').max(image.select('VH')).rename('T_statistic')
                return t_stat.clip(aoi)

            # ─────────────────────────────────────────────────────────────────
            # Helper: Get building footprints (strictly within selected region)
            # ─────────────────────────────────────────────────────────────────
            def _get_buildings(bbox_coords):
                region_geom = ee.Geometry.Rectangle(bbox_coords)

                # Try Google Open Buildings first — return ALL, no pre-limit
                # (reduceRegions handles any count; we limit at getInfo time)
                try:
                    buildings = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons') \
                        .filterBounds(region_geom)
                    count = buildings.size().getInfo()
                    if count > 0:
                        logger.info(f"[THREE-PANEL] Found {count} buildings from Google Open Buildings")
                        return buildings
                except Exception as e:
                    logger.warning(f"Google Open Buildings not available: {e}")

                # Try OSM buildings
                try:
                    osm = ee.FeatureCollection('projects/sat-io/open-datasets/OSM_Polygons/OSM_Polygons_Building') \
                        .filterBounds(region_geom)
                    count = osm.size().getInfo()
                    if count > 0:
                        logger.info(f"[THREE-PANEL] Found {count} buildings from OSM")
                        return osm
                except Exception:
                    pass

                logger.warning("[THREE-PANEL] No building footprints available")
                return None

            # ─────────────────────────────────────────────────────────────────
            # Helper: Calculate building damage
            # ─────────────────────────────────────────────────────────────────
            def _calc_building_damage(t_stat_img, buildings_fc, threshold=3.0):
                buildings_with_stats = t_stat_img.reduceRegions(
                    collection=buildings_fc,
                    reducer=ee.Reducer.mean().combine(
                        reducer2=ee.Reducer.max(),
                        sharedInputs=True
                    ),
                    scale=10,
                    tileScale=4
                )

                def classify_damage(feature):
                    mean_raw = feature.get('mean')
                    mean_t = ee.Number(ee.Algorithms.If(mean_raw, mean_raw, 0)).max(0)
                    severity = ee.Algorithms.If(
                        mean_t.gt(6), 'critical',
                        ee.Algorithms.If(
                            mean_t.gt(4.5), 'severe',
                            ee.Algorithms.If(
                                mean_t.gt(threshold), 'moderate',
                                'undamaged'
                            )
                        )
                    )
                    return feature.set({'mean_t_stat': mean_t, 'severity': severity})

                return buildings_with_stats.map(classify_damage)

            # ─────────────────────────────────────────────────────────────────
            # Helper: Get RGB imagery (clipped to exact region)
            # ─────────────────────────────────────────────────────────────────
            def _get_rgb(bbox_coords, start_date, end_date):
                region_geom = ee.Geometry.Rectangle(bbox_coords)
                s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED') \
                    .filterBounds(region_geom) \
                    .filterDate(start_date, end_date) \
                    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20)) \
                    .median()
                rgb = s2.select(['B4', 'B3', 'B2']).divide(3000).clamp(0, 1)
                return rgb.clip(region_geom)  # Clip to exact region

            # Step 1: Calculate T-statistic
            logger.info("[THREE-PANEL] Step 1: Calculating T-statistic...")
            pre_months = baseline_days // 30
            post_months = max(1, post_event_days // 30)
            t_stat = _calc_tstat(region, after_start, pre_months, post_months)

            # Step 2: Get building footprints
            logger.info("[THREE-PANEL] Step 2: Getting building footprints...")
            buildings = _get_buildings(bbox)

            all_buildings = []
            if buildings:
                # Step 3: Calculate damage per building
                logger.info("[THREE-PANEL] Step 3: Calculating mean T-stat per building...")
                buildings_with_damage = _calc_building_damage(t_stat, buildings, DAMAGE_THRESHOLD)
                # Sort by damage (highest t-stat first) so important buildings
                # are always included even if we hit the limit
                results = buildings_with_damage.sort('mean_t_stat', False).limit(2000).getInfo()

                for feature in results['features']:
                    props = feature['properties']
                    coords = feature['geometry']['coordinates']
                    mean_t = props.get('mean_t_stat', 0) or 0
                    severity = props.get('severity', 'undamaged')

                    all_buildings.append({
                        'coordinates': coords,
                        'geometry_type': feature['geometry']['type'],
                        'mean_t_stat': mean_t,
                        'severity': severity
                    })

                damaged_count = sum(1 for b in all_buildings if b['severity'] != 'undamaged')
                logger.info(f"[THREE-PANEL] Buildings: {len(all_buildings)} total, {damaged_count} damaged")

            # Step 4: Get imagery
            logger.info("[THREE-PANEL] Step 4: Fetching imagery...")
            rgb_before = _get_rgb(bbox, before_start, before_end)
            rgb_after = _get_rgb(bbox, after_start, after_end)

            # Download images as arrays - use scale instead of dimensions for precise region
            # For small areas (like 0.4km radius), dimensions=512 can cause GEE to expand the view
            def get_image_array(image, target_pixels=512):
                # Use the EXACT bbox to create region
                region_geom = ee.Geometry.Rectangle(bbox)

                # Calculate the appropriate scale to get ~target_pixels while maintaining exact region
                # Width in meters = lon_diff * meters_per_degree * cos(lat)
                lon_diff = bbox[2] - bbox[0]
                lat_center = (bbox[1] + bbox[3]) / 2
                width_meters = lon_diff * 111320 * np.cos(np.radians(lat_center))

                # Calculate scale to get approximately target_pixels
                # Scale = meters per pixel
                scale = max(10, width_meters / target_pixels)  # At least 10m resolution

                logger.info(f"[THREE-PANEL] Image export: bbox={bbox}, width_m={width_meters:.1f}, scale={scale:.1f}m/px")

                url = image.visualize(min=0, max=1).getThumbURL({
                    'region': region_geom,
                    'scale': scale,
                    'format': 'png'
                })
                response = requests.get(url)
                img = Image.open(BytesIO(response.content))
                return np.array(img)

            before_arr = get_image_array(rgb_before)
            after_arr = get_image_array(rgb_after)

            # Get T-stat visualization - use same scale as RGB for consistency
            t_stat_vis = t_stat.visualize(
                min=0,
                max=10,
                palette=['#440154', '#482878', '#3e4a89', '#31688e', '#26828e',
                         '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']
            )
            # Calculate scale for consistent output
            lon_diff = bbox[2] - bbox[0]
            lat_center = (bbox[1] + bbox[3]) / 2
            width_meters = lon_diff * 111320 * np.cos(np.radians(lat_center))
            scale = max(10, width_meters / 512)

            t_stat_url = t_stat_vis.getThumbURL({
                'region': region,
                'scale': scale,
                'format': 'png'
            })
            logger.info(f"[THREE-PANEL] T-stat URL: scale={scale:.1f}m/px")
            response = requests.get(t_stat_url)
            t_stat_arr = np.array(Image.open(BytesIO(response.content)))

            logger.info("[THREE-PANEL] Step 5: Creating visualization...")

            # Create visualization (EXACT copy from pwtt_building_level.py)
            fig, axes = plt.subplots(1, 3, figsize=(15, 5))

            # Calculate scale bar
            lat_center = (bbox[1] + bbox[3]) / 2
            lon_diff = bbox[2] - bbox[0]
            meters_per_deg = 111320 * np.cos(np.radians(lat_center))
            total_meters = lon_diff * meters_per_deg

            if total_meters > 1000:
                scale_meters = 100
            elif total_meters > 500:
                scale_meters = 50
            else:
                scale_meters = 25

            scale_pixels = (scale_meters / total_meters) * before_arr.shape[1]
            img_height, img_width = before_arr.shape[:2]

            bar_x = img_width - scale_pixels - 20
            bar_y = img_height - 30

            # Panel 1: Pre Destruction
            axes[0].imshow(before_arr)
            axes[0].set_title('Pre Destruction', fontsize=14, fontweight='bold')
            axes[0].axis('off')
            axes[0].add_patch(Rectangle((bar_x, bar_y), scale_pixels, 5,
                                         facecolor='white', edgecolor='black', linewidth=1))
            axes[0].text(bar_x + scale_pixels/2, bar_y - 8, f'{scale_meters} m',
                         ha='center', va='bottom', fontsize=9, color='white', fontweight='bold',
                         path_effects=[path_effects.withStroke(linewidth=2, foreground='black')])

            # Panel 2: Post Destruction
            axes[1].imshow(after_arr)
            axes[1].set_title('Post Destruction', fontsize=14, fontweight='bold')
            axes[1].axis('off')
            axes[1].add_patch(Rectangle((bar_x, bar_y), scale_pixels, 5,
                                         facecolor='white', edgecolor='black', linewidth=1))
            axes[1].text(bar_x + scale_pixels/2, bar_y - 8, f'{scale_meters} m',
                         ha='center', va='bottom', fontsize=9, color='white', fontweight='bold',
                         path_effects=[path_effects.withStroke(linewidth=2, foreground='black')])

            # Panel 3: PWTT with building footprints
            axes[2].imshow(t_stat_arr)
            axes[2].set_title('PWTT', fontsize=14, fontweight='bold')
            axes[2].axis('off')
            axes[2].add_patch(Rectangle((bar_x, bar_y), scale_pixels, 5,
                                         facecolor='white', edgecolor='black', linewidth=1))
            axes[2].text(bar_x + scale_pixels/2, bar_y - 8, f'{scale_meters} m',
                         ha='center', va='bottom', fontsize=9, color='white', fontweight='bold',
                         path_effects=[path_effects.withStroke(linewidth=2, foreground='black')])

            # Draw building footprints with damage coloring
            severity_colors = {
                'undamaged': 'white',
                'moderate': 'yellow',
                'severe': 'orange',
                'critical': 'red'
            }

            buildings_drawn = 0
            for building in all_buildings:
                coords = building['coordinates']
                severity = building['severity']
                color = severity_colors.get(severity, 'white')

                # Convert coordinates to pixels
                if building['geometry_type'] == 'Polygon':
                    poly_coords = coords[0]
                elif building['geometry_type'] == 'MultiPolygon':
                    poly_coords = coords[0][0]
                else:
                    continue

                pixels = []
                in_bounds = False  # Track if any vertex is within bounds
                for lon, lat in poly_coords:
                    px = (lon - bbox[0]) / (bbox[2] - bbox[0]) * img_width
                    py = (bbox[3] - lat) / (bbox[3] - bbox[1]) * img_height
                    pixels.append([px, py])
                    # Check if this vertex is within the image bounds
                    if 0 <= px <= img_width and 0 <= py <= img_height:
                        in_bounds = True

                # Skip buildings entirely outside the selected region
                if not in_bounds:
                    continue

                if len(pixels) > 2:
                    pixels = np.array(pixels)
                    # Clip coordinates to image bounds
                    pixels[:, 0] = np.clip(pixels[:, 0], 0, img_width)
                    pixels[:, 1] = np.clip(pixels[:, 1], 0, img_height)

                    buildings_drawn += 1
                    if severity == 'undamaged':
                        # Just outline for undamaged
                        axes[2].plot(pixels[:, 0], pixels[:, 1], 'w-', linewidth=0.3, alpha=0.5)
                    else:
                        # Filled polygon for damaged
                        poly = Polygon(pixels, facecolor=color, edgecolor='white',
                                      alpha=0.6, linewidth=0.5)
                        axes[2].add_patch(poly)

            logger.info(f"[THREE-PANEL] Drew {buildings_drawn} buildings on image")

            plt.tight_layout()

            # Save to bytes
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=150, bbox_inches='tight', facecolor='white')
            plt.close(fig)
            buf.seek(0)

            logger.info("[THREE-PANEL] Analysis complete!")
            return buf.read()

        return await asyncio.to_thread(_run_analysis)
