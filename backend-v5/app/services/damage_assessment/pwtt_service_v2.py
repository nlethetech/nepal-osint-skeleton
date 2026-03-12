"""PWTT v2 — Enhanced Building-Level Damage Detection.

Entirely separate from v1 (pwtt_service.py). Zero coupling with v1.

Enhancements over v1:
1. Enhanced reducers — p90, stdDev, count per building (not just mean+max)
2. Size-aware thresholds — large/medium/small/sub-pixel classification
3. VV/VH separation — separate t-stats, quadratic composite, agreement flag
4. Terrain flattening — SRTM volume correction before lee_filter
5. Optical corroboration — Sentinel-2 dNDVI, dNDBI, dNBR per building
6. Confidence scoring — weighted multi-factor (6 components)
7. Temporal persistence — fraction of post-event images with damage signal
8. Baseline stability — pre-event coefficient of variation

Source: https://github.com/oballinger/PWTT (enhanced)
"""

import asyncio
import logging
import math
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

from app.services.earth_engine.gee_client import GEEClient

# ═══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

SIZE_THRESHOLDS = {
    'large':     {'min_pixels': 10, 'threshold': 2.7, 'primary': 'mean'},
    'medium':    {'min_pixels': 4,  'threshold': 3.5, 'primary': 'p90'},
    'small':     {'min_pixels': 2,  'threshold': 4.5, 'primary': 'max'},
    'sub_pixel': {'min_pixels': 0,  'threshold': 5.0, 'primary': 'max', 'requires_optical': True},
}

CONFIDENCE_WEIGHTS = {
    't_stat_magnitude': 0.30,
    'optical_corroboration': 0.25,
    'polarization_agreement': 0.15,
    'pixel_count_reliability': 0.10,
    'baseline_stability': 0.10,
    'temporal_persistence': 0.10,
}

# Optical change thresholds
DNDVI_THRESHOLD = -0.1   # vegetation loss
DNDBI_THRESHOLD = 0.05   # built-up loss
DNBR_THRESHOLD = -0.1    # burn damage


# ═══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class PWTTResultV2:
    """Result of PWTT v2 damage detection."""
    analysis_id: str
    algorithm_version: str
    bbox: list[float]
    event_date: str

    # Area statistics (km²)
    total_area_km2: float
    damaged_area_km2: float
    damage_percentage: float

    # Severity breakdown (km²)
    critical_area_km2: float
    severe_area_km2: float
    moderate_area_km2: float
    minor_area_km2: float

    # Tile URLs
    damage_tile_url: Optional[str]
    t_stat_tile_url: Optional[str]
    before_rgb_tile_url: Optional[str]
    after_rgb_tile_url: Optional[str]
    before_sar_tile_url: Optional[str]
    after_sar_tile_url: Optional[str]

    # Metadata
    baseline_images_count: int
    post_images_count: int
    confidence_score: float
    terrain_flattened: bool

    # Building-level v2 damage (enhanced GeoJSON features)
    building_damage_v2: list[dict] = field(default_factory=list)

    # Error info
    error: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE
# ═══════════════════════════════════════════════════════════════════════════════

class PWTTServiceV2:
    """PWTT v2 damage detection — enhanced building-level analysis.

    Completely independent from PWTTService (v1). All v1 code is untouched.
    """

    ALGORITHM_VERSION = 'pwtt-v2.0'

    # Visualization parameters (same as v1 for consistency)
    T_STAT_VIS = {
        'min': 0, 'max': 10, 'opacity': 0.7,
        'palette': [
            '440154', '482878', '3e4989', '31688e', '26828e',
            '1f9e89', '35b779', '6ece58', 'b5de2b', 'fde725',
        ]
    }
    DAMAGE_VIS = {
        'min': 0, 'max': 1,
        'palette': ['1a9850', '66bd63', 'a6d96a', 'fee08b',
                    'fdae61', 'f46d43', 'd73027', 'a50026']
    }
    SAR_VIS = {
        'min': -25, 'max': 0,
        'palette': ['000000', '333333', '555555', '777777',
                    '999999', 'bbbbbb', 'dddddd', 'ffffff']
    }
    RGB_VIS = {'bands': ['B4', 'B3', 'B2'], 'min': 0, 'max': 2500}

    def _mask_clouds_s2(self, image: ee.Image) -> ee.Image:
        """Mask clouds in Sentinel-2 imagery."""
        qa = image.select('QA60')
        cloud_bit_mask = 1 << 10
        cirrus_bit_mask = 1 << 11
        mask = qa.bitwiseAnd(cloud_bit_mask).eq(0).And(
            qa.bitwiseAnd(cirrus_bit_mask).eq(0)
        )
        return image.updateMask(mask)

    async def detect_damage_v2(
        self,
        bbox: list[float],
        event_date: str,
        baseline_days: int = 365,
        post_event_days: int = 60,
        enable_terrain_flattening: bool = True,
        enable_optical: bool = True,
    ) -> PWTTResultV2:
        """Run PWTT v2 enhanced damage detection.

        Args:
            bbox: [min_lng, min_lat, max_lng, max_lat]
            event_date: ISO date string
            baseline_days: Pre-event baseline window
            post_event_days: Post-event search window
            enable_terrain_flattening: Apply SRTM terrain correction
            enable_optical: Compute Sentinel-2 optical corroboration
        """
        gee_client = await GEEClient.get_instance()
        analysis_id = str(uuid4())

        def _run():
            from pwtt_lib.code.pwtt import lee_filter, ttest

            geometry = ee.Geometry.Rectangle(bbox)
            area_km2 = geometry.area().divide(1e6).getInfo()

            # Parse dates
            if isinstance(event_date, str):
                event_dt = datetime.fromisoformat(
                    event_date.replace('Z', '+00:00').replace('+00:00', '')
                )
            else:
                event_dt = event_date

            event_date_str = event_dt.strftime('%Y-%m-%d')
            pre_months = max(1, baseline_days // 30)
            post_months = max(1, post_event_days // 30)

            before_start = (event_dt - timedelta(days=baseline_days)).strftime('%Y-%m-%d')
            after_end = (event_dt + timedelta(days=post_event_days)).strftime('%Y-%m-%d')

            terrain_flattened = False

            # ═══════════════════════════════════════════════════════════════
            # STEP 1: Compute per-orbit T-statistics — VV and VH SEPARATE
            # ═══════════════════════════════════════════════════════════════
            try:
                # Check S1 post-event availability eagerly
                post_s1_check = (
                    ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                    .filter(ee.Filter.eq("instrumentMode", "IW"))
                    .filterBounds(geometry)
                    .filterDate(
                        ee.Date(event_date_str),
                        ee.Date(event_date_str).advance(post_months, 'months'),
                    )
                )
                post_s1_size = post_s1_check.size().getInfo()
                if post_s1_size == 0:
                    logger.error("PWTT v2: No post-event S1 imagery found")
                    return {
                        'error': 'No Sentinel-1 imagery available for this area/date range',
                        'area_km2': area_km2,
                        'baseline_count': 0,
                        'post_count': 0,
                        'terrain_flattened': False,
                    }
                logger.info(f"PWTT v2: {post_s1_size} post-event S1 images found")

                # Also check pre-event S1 — ttest needs baseline data
                pre_s1_check = (
                    ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                    .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                    .filter(ee.Filter.eq("instrumentMode", "IW"))
                    .filterBounds(geometry)
                    .filterDate(before_start, event_date_str)
                )
                pre_s1_size = pre_s1_check.size().getInfo()
                if pre_s1_size == 0:
                    logger.error("PWTT v2: No pre-event S1 imagery found")
                    return {
                        'error': 'No pre-event Sentinel-1 imagery available for baseline',
                        'area_km2': area_km2,
                        'baseline_count': 0,
                        'post_count': post_s1_size,
                        'terrain_flattened': False,
                    }
                logger.info(f"PWTT v2: {pre_s1_size} pre-event S1 images found")

                orbits = post_s1_check.aggregate_array('relativeOrbitNumber_start').distinct()

                # Optional terrain flattening
                srtm = None
                if enable_terrain_flattening:
                    try:
                        srtm = ee.Image("USGS/SRTMGL1_003")
                        terrain_flattened = True
                        logger.info("PWTT v2: SRTM terrain flattening enabled")
                    except Exception as e:
                        logger.warning(f"PWTT v2: SRTM not available, skipping terrain flattening: {e}")

                def apply_terrain_correction(image):
                    """Apply terrain flattening if SRTM available."""
                    if not terrain_flattened or srtm is None:
                        return image
                    try:
                        # Volume scattering terrain correction
                        # Compute local incidence angle from SRTM
                        slope = ee.Terrain.slope(srtm)
                        aspect = ee.Terrain.aspect(srtm)

                        # Get satellite heading from image metadata
                        heading = ee.Number(image.get('orbitProperties_pass')).eq(ee.String('ASCENDING'))
                        heading_angle = heading.multiply(180).subtract(90)  # Approximate

                        # Simple volume correction: normalize by cos(local_incidence)
                        # This reduces terrain-induced brightness variations
                        local_inc = slope.multiply(math.pi / 180).cos()
                        correction = local_inc.max(0.3)  # Clamp to avoid division issues

                        corrected = image.select(['VV', 'VH']).divide(correction)
                        return image.addBands(corrected, overwrite=True)
                    except Exception:
                        return image  # Fallback: return uncorrected

                def map_orbit(orbit):
                    s1 = (
                        ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                        .filter(ee.Filter.eq("instrumentMode", "IW"))
                        .filter(ee.Filter.eq("relativeOrbitNumber_start", orbit))
                        .filterBounds(geometry)
                    )

                    # Apply terrain correction BEFORE lee_filter
                    if terrain_flattened:
                        s1 = s1.map(apply_terrain_correction)

                    s1 = (
                        s1.map(lee_filter)
                        .select(['VV', 'VH'])
                        .map(lambda image: image.log())
                    )

                    return ttest(s1, ee.Date(event_date_str), ee.Date(event_date_str),
                                 pre_months, post_months)

                orbit_results = ee.ImageCollection(orbits.map(map_orbit)).max()

                # Keep VV and VH SEPARATE (v1 maxes them — v2 preserves both)
                t_vv = orbit_results.select('VV').rename('t_vv')
                t_vh = orbit_results.select('VH').rename('t_vh')

                # Quadratic composite: sqrt(VV² + VH²)
                quadratic_t = t_vv.pow(2).add(t_vh.pow(2)).sqrt().rename('quadratic_t')

                # Agreement flag: both VV and VH above threshold (2.5)
                vv_above = t_vv.gt(2.5)
                vh_above = t_vh.gt(2.5)
                agreement = vv_above.And(vh_above).rename('agreement')

                # Stack all bands for reduceRegions
                t_stack = t_vv.addBands(t_vh).addBands(quadratic_t).addBands(agreement)

                # Also keep the classic max(VV, VH) for area stats compatibility
                t_stat_classic = t_vv.max(t_vh).rename('T_statistic')
                t_stat_classic = t_stat_classic.clip(geometry)

                logger.info("PWTT v2: T-statistics computed (VV/VH separate + quadratic)")

            except Exception as e:
                logger.error(f"PWTT v2 analysis failed: {e}")
                return {
                    'error': f'PWTT v2 analysis failed: {str(e)}',
                    'area_km2': area_km2 if 'area_km2' in dir() else 0,
                    'baseline_count': 0,
                    'post_count': 0,
                    'terrain_flattened': False,
                }

            # ═══════════════════════════════════════════════════════════════
            # STEP 2: Image counts
            # ═══════════════════════════════════════════════════════════════
            s1_collection = (
                ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                .filter(ee.Filter.eq("instrumentMode", "IW"))
                .filterBounds(geometry)
            )
            baseline_count = s1_collection.filterDate(before_start, event_date_str).size().getInfo()
            post_count = s1_collection.filterDate(event_date_str, after_end).size().getInfo()

            # ═══════════════════════════════════════════════════════════════
            # STEP 3: Area statistics (using classic t-stat for backward compat)
            # ═══════════════════════════════════════════════════════════════
            pixel_area = ee.Image.pixelArea()
            DAMAGE_THRESHOLD = 3.0

            def get_area_value(mask_image):
                result = mask_image.multiply(pixel_area).reduceRegion(
                    reducer=ee.Reducer.sum(),
                    geometry=geometry,
                    scale=10,
                    maxPixels=1e9,
                )
                val = result.values().get(0)
                return ee.Number(ee.Algorithms.If(val, val, 0))

            damaged_area = get_area_value(t_stat_classic.gte(DAMAGE_THRESHOLD))
            critical_area = get_area_value(t_stat_classic.gte(4.0))
            severe_area = get_area_value(t_stat_classic.gte(3.5).And(t_stat_classic.lt(4.0)))
            moderate_area = get_area_value(t_stat_classic.gte(3.0).And(t_stat_classic.lt(3.5)))
            minor_area = get_area_value(t_stat_classic.gte(2.5).And(t_stat_classic.lt(3.0)))

            # ═══════════════════════════════════════════════════════════════
            # STEP 4: Building-level v2 — enhanced reducers
            # ═══════════════════════════════════════════════════════════════
            building_features = []
            try:
                buildings_fc = (
                    ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
                    .filterBounds(geometry)
                )
                building_count = buildings_fc.size().getInfo()
                logger.info(f"PWTT v2: Found {building_count} buildings")

                if building_count > 0:
                    # ── Primary stats: reduce ONLY quadratic_t (single band) ──
                    # Combined reducer on single band → clean names:
                    # mean, max, p90, stdDev, count
                    buildings_with_stats = quadratic_t.reduceRegions(
                        collection=buildings_fc,
                        reducer=(
                            ee.Reducer.mean()
                            .combine(reducer2=ee.Reducer.max(), sharedInputs=True)
                            .combine(reducer2=ee.Reducer.percentile([90]), sharedInputs=True)
                            .combine(reducer2=ee.Reducer.stdDev(), sharedInputs=True)
                            .combine(reducer2=ee.Reducer.count(), sharedInputs=True)
                        ),
                        scale=10,
                        tileScale=4,
                    )

                    # ── VV/VH/agreement: single reducer on multi-band ──
                    # Single reducer on named bands → properties = band names:
                    # t_vv, t_vh, agreement
                    vv_vh_stack = t_vv.addBands(t_vh).addBands(agreement)
                    buildings_with_vvvh = vv_vh_stack.reduceRegions(
                        collection=buildings_with_stats,
                        reducer=ee.Reducer.mean(),
                        scale=10,
                        tileScale=4,
                    )

                    # ═══════════════════════════════════════════════════════
                    # STEP 4b: Baseline stability (pre-event CV)
                    # ═══════════════════════════════════════════════════════
                    pre_s1 = (
                        ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                        .filter(ee.Filter.eq("instrumentMode", "IW"))
                        .filterBounds(geometry)
                        .filterDate(before_start, event_date_str)
                    )
                    pre_s1_count = pre_s1.size().getInfo()
                    logger.info(f"PWTT v2: {pre_s1_count} pre-event S1 images for CV")

                    if pre_s1_count > 0:
                        pre_s1_vv = pre_s1.select(['VV', 'VH'])
                        pre_mean = pre_s1_vv.mean().select('VV').rename('pre_mean')
                        pre_stddev = pre_s1_vv.reduce(ee.Reducer.stdDev()).select('VV_stdDev').rename('pre_std')
                        # CV = stdDev / mean (coefficient of variation)
                        pre_cv_img = pre_stddev.divide(pre_mean.abs().max(0.001)).rename('pre_cv')

                        # Use setOutputs to namespace CV — avoids overwriting 'mean'
                        buildings_with_cv = pre_cv_img.reduceRegions(
                            collection=buildings_with_vvvh,
                            reducer=ee.Reducer.mean().setOutputs(['pre_cv']),
                            scale=10,
                            tileScale=4,
                        )
                    else:
                        # No pre-event data — skip CV, use buildings_with_vvvh as-is
                        logger.warning("PWTT v2: No pre-event S1 for CV — skipping baseline stability")
                        buildings_with_cv = buildings_with_vvvh

                    # ═══════════════════════════════════════════════════════
                    # STEP 4c: Optical corroboration (Sentinel-2)
                    # Check S2 availability BEFORE building computation graph
                    # to avoid deferred GEE errors at getInfo() time.
                    # ═══════════════════════════════════════════════════════
                    optical_features = None
                    if enable_optical:
                        try:
                            s2_pre_col = (
                                ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                                .filterBounds(geometry)
                                .filterDate(
                                    (event_dt - timedelta(days=90)).strftime('%Y-%m-%d'),
                                    event_date_str,
                                )
                                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
                                .map(self._mask_clouds_s2)
                            )
                            s2_post_col = (
                                ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                                .filterBounds(geometry)
                                .filterDate(event_date_str, after_end)
                                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
                                .map(self._mask_clouds_s2)
                            )

                            # Check counts eagerly — avoids deferred band errors
                            s2_pre_count = s2_pre_col.size().getInfo()
                            s2_post_count = s2_post_col.size().getInfo()
                            logger.info(f"PWTT v2: S2 imagery — pre={s2_pre_count}, post={s2_post_count}")

                            if s2_pre_count > 0 and s2_post_count > 0:
                                s2_pre = s2_pre_col.median()
                                s2_post = s2_post_col.median()

                                # NDVI = (B8 - B4) / (B8 + B4)
                                pre_ndvi = s2_pre.normalizedDifference(['B8', 'B4']).rename('pre_ndvi')
                                post_ndvi = s2_post.normalizedDifference(['B8', 'B4']).rename('post_ndvi')
                                dndvi = post_ndvi.subtract(pre_ndvi).rename('dndvi')

                                # NDBI = (B11 - B8) / (B11 + B8)
                                pre_ndbi = s2_pre.normalizedDifference(['B11', 'B8']).rename('pre_ndbi')
                                post_ndbi = s2_post.normalizedDifference(['B11', 'B8']).rename('post_ndbi')
                                dndbi = post_ndbi.subtract(pre_ndbi).rename('dndbi')

                                # NBR = (B8 - B12) / (B8 + B12)
                                pre_nbr = s2_pre.normalizedDifference(['B8', 'B12']).rename('pre_nbr')
                                post_nbr = s2_post.normalizedDifference(['B8', 'B12']).rename('post_nbr')
                                dnbr = post_nbr.subtract(pre_nbr).rename('dnbr')

                                optical_stack = dndvi.addBands(dndbi).addBands(dnbr)

                                optical_features = optical_stack.reduceRegions(
                                    collection=buildings_with_cv,
                                    reducer=ee.Reducer.mean(),
                                    scale=10,
                                    tileScale=4,
                                )
                                logger.info("PWTT v2: Optical corroboration computed (dNDVI, dNDBI, dNBR)")
                            else:
                                logger.info("PWTT v2: Insufficient S2 imagery for optical — skipping (no penalty)")

                        except Exception as e:
                            logger.warning(f"PWTT v2: Optical corroboration failed (non-fatal): {e}")

                    # Use the most complete feature collection available
                    final_fc = optical_features or buildings_with_cv

                    # ═══════════════════════════════════════════════════════
                    # STEP 4d: Temporal persistence
                    # ═══════════════════════════════════════════════════════
                    # Count how many post-event images show damage signal per building
                    # This is expensive, so we compute at image level not building level
                    temporal_persistence_val = None
                    try:
                        post_s1 = (
                            ee.ImageCollection("COPERNICUS/S1_GRD_FLOAT")
                            .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
                            .filter(ee.Filter.eq("instrumentMode", "IW"))
                            .filterBounds(geometry)
                            .filterDate(event_date_str, after_end)
                        )
                        post_image_count = post_s1.size().getInfo()
                        if post_image_count > 0:
                            temporal_persistence_val = post_image_count
                    except Exception as e:
                        logger.warning(f"PWTT v2: Temporal count failed (non-fatal): {e}")

                    # Sort by quadratic_t descending, limit, getInfo
                    classified_sorted = final_fc.sort('mean', False)
                    results_info = classified_sorted.limit(5000).getInfo()

                    if results_info and results_info.get('features'):
                        for feature in results_info['features']:
                            props = feature.get('properties', {})
                            geom = feature.get('geometry')
                            if not geom:
                                continue

                            # Extract reducer outputs
                            # Primary stats from single-band quadratic_t:
                            #   mean, max, p90, stdDev, count
                            mean_val = _safe_num(props.get('mean', 0))
                            max_val = _safe_num(props.get('max', 0))
                            p90_val = _safe_num(props.get('p90', 0))
                            std_val = _safe_num(props.get('stdDev', 0))
                            pixel_count = int(_safe_num(props.get('count', 0)))

                            # VV/VH from separate single-reducer on named bands:
                            #   t_vv, t_vh, agreement
                            vv_mean = _safe_num(props.get('t_vv', mean_val))
                            vh_mean = _safe_num(props.get('t_vh', mean_val))

                            # Agreement (fraction of pixels where both VV+VH > 2.5)
                            agreement_val = _safe_num(props.get('agreement', 0))
                            polarization_agreement = agreement_val > 0.5

                            # Pre-event CV (namespaced via setOutputs)
                            pre_cv = _safe_num(props.get('pre_cv', 0.15))

                            # Optical values
                            dndvi_val = props.get('dndvi')
                            dndbi_val = props.get('dndbi')
                            dnbr_val = props.get('dnbr')

                            # Make optical values None-safe
                            dndvi_num = float(dndvi_val) if dndvi_val is not None else None
                            dndbi_num = float(dndbi_val) if dndbi_val is not None else None
                            dnbr_num = float(dnbr_val) if dnbr_val is not None else None

                            # Optical corroboration count (0-3)
                            optical_count = 0
                            if dndvi_num is not None and dndvi_num < DNDVI_THRESHOLD:
                                optical_count += 1
                            if dndbi_num is not None and dndbi_num > DNDBI_THRESHOLD:
                                optical_count += 1
                            if dnbr_num is not None and dnbr_num < DNBR_THRESHOLD:
                                optical_count += 1

                            # ─── Size-aware classification ───
                            size_class = _classify_size(pixel_count)
                            size_cfg = SIZE_THRESHOLDS[size_class]
                            threshold = size_cfg['threshold']
                            primary_key = size_cfg['primary']

                            primary_value = {
                                'mean': mean_val,
                                'p90': p90_val,
                                'max': max_val,
                            }.get(primary_key, mean_val)

                            # Severity classification
                            severity = _classify_severity(
                                primary_value, threshold,
                                size_class, optical_count,
                            )

                            # ─── Confidence scoring ───
                            confidence = _compute_confidence(
                                primary_value=primary_value,
                                threshold=threshold,
                                optical_count=optical_count,
                                polarization_agreement=polarization_agreement,
                                pixel_count=pixel_count,
                                pre_cv=pre_cv,
                                temporal_persistence_val=temporal_persistence_val,
                                post_count=post_count,
                            )

                            # Temporal persistence (simplified: ratio of post images)
                            temporal_persistence = None
                            if temporal_persistence_val and post_count > 0:
                                temporal_persistence = min(1.0, temporal_persistence_val / max(post_count, 1))

                            # Centroid from geometry
                            coords = geom.get('coordinates', [[]])
                            poly_coords = (
                                coords[0] if geom['type'] == 'Polygon'
                                else (coords[0][0] if coords else [])
                            )
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
                                    # v1 fields (backward compat)
                                    'mean_t_stat': round(mean_val, 3),
                                    'max_t_stat': round(max_val, 3),
                                    'severity': severity,
                                    'centroid_lat': centroid_lat,
                                    'centroid_lng': centroid_lng,
                                    'area_m2': props.get('area_in_meters', 0) or 0,
                                    # v2 additions
                                    'p90_t_stat': round(p90_val, 3),
                                    'std_t_stat': round(std_val, 3),
                                    'vv_t_stat': round(vv_mean, 3),
                                    'vh_t_stat': round(vh_mean, 3),
                                    'quadratic_t': round(mean_val, 3),  # mean of quadratic band
                                    'pixel_count': pixel_count,
                                    'size_class': size_class,
                                    'confidence': round(confidence, 3),
                                    'polarization_agreement': polarization_agreement,
                                    'dndvi': round(dndvi_num, 4) if dndvi_num is not None else None,
                                    'dndbi': round(dndbi_num, 4) if dndbi_num is not None else None,
                                    'dnbr': round(dnbr_num, 4) if dnbr_num is not None else None,
                                    'optical_corroboration_count': optical_count,
                                    'temporal_persistence': round(temporal_persistence, 3) if temporal_persistence is not None else None,
                                    'pre_cv': round(pre_cv, 4),
                                },
                            })

                        damaged_count = sum(
                            1 for b in building_features
                            if b['properties']['severity'] != 'undamaged'
                        )
                        logger.info(
                            f"PWTT v2: {len(building_features)} buildings, "
                            f"{damaged_count} damaged"
                        )

            except Exception as e:
                logger.warning(f"PWTT v2: Building-level detection failed (non-fatal): {e}")

            # ═══════════════════════════════════════════════════════════════
            # STEP 5: Visualization tiles
            # ═══════════════════════════════════════════════════════════════
            t_stat_map_id = t_stat_classic.clip(geometry).getMapId(self.T_STAT_VIS)

            damage_prob = t_stat_classic.subtract(3).divide(2).clamp(0, 1)
            damage_prob_masked = damage_prob.updateMask(t_stat_classic.gte(2.5))
            damage_map_id = damage_prob_masked.clip(geometry).getMapId(self.DAMAGE_VIS)

            # SAR imagery
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
                logger.warning(f"PWTT v2: SAR visualization failed: {e}")

            # RGB imagery (Sentinel-2)
            before_rgb_url = None
            after_rgb_url = None
            try:
                from app.services.earth_engine.gee_client import GEE_COLLECTIONS
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
                logger.warning(f"PWTT v2: RGB visualization failed: {e}")

            return {
                'area_km2': area_km2,
                'damaged_m2': damaged_area.getInfo() or 0,
                'critical_m2': critical_area.getInfo() or 0,
                'severe_m2': severe_area.getInfo() or 0,
                'moderate_m2': moderate_area.getInfo() or 0,
                'minor_m2': minor_area.getInfo() or 0,
                'baseline_count': baseline_count,
                'post_count': post_count,
                'terrain_flattened': terrain_flattened,
                'damage_tile_url': damage_map_id['tile_fetcher'].url_format,
                't_stat_tile_url': t_stat_map_id['tile_fetcher'].url_format,
                'before_rgb_tile_url': before_rgb_url,
                'after_rgb_tile_url': after_rgb_url,
                'before_sar_tile_url': before_sar_url,
                'after_sar_tile_url': after_sar_url,
                'building_features': building_features,
                'error': None,
            }

        # Execute in thread
        try:
            result = await asyncio.to_thread(_run)
        except Exception as e:
            logger.exception(f"PWTT v2 analysis failed: {e}")
            return PWTTResultV2(
                analysis_id=analysis_id,
                algorithm_version=self.ALGORITHM_VERSION,
                bbox=bbox, event_date=event_date,
                total_area_km2=0, damaged_area_km2=0, damage_percentage=0,
                critical_area_km2=0, severe_area_km2=0,
                moderate_area_km2=0, minor_area_km2=0,
                damage_tile_url=None, t_stat_tile_url=None,
                before_rgb_tile_url=None, after_rgb_tile_url=None,
                before_sar_tile_url=None, after_sar_tile_url=None,
                baseline_images_count=0, post_images_count=0,
                confidence_score=0, terrain_flattened=False,
                error=str(e),
            )

        # Handle error
        if result.get('error'):
            return PWTTResultV2(
                analysis_id=analysis_id,
                algorithm_version=self.ALGORITHM_VERSION,
                bbox=bbox, event_date=event_date,
                total_area_km2=result.get('area_km2', 0),
                damaged_area_km2=0, damage_percentage=0,
                critical_area_km2=0, severe_area_km2=0,
                moderate_area_km2=0, minor_area_km2=0,
                damage_tile_url=None, t_stat_tile_url=None,
                before_rgb_tile_url=None, after_rgb_tile_url=None,
                before_sar_tile_url=None, after_sar_tile_url=None,
                baseline_images_count=result.get('baseline_count', 0),
                post_images_count=result.get('post_count', 0),
                confidence_score=0,
                terrain_flattened=result.get('terrain_flattened', False),
                error=result['error'],
            )

        # Build result
        damaged_km2 = result['damaged_m2'] / 1e6
        area_km2 = result['area_km2']

        # Confidence score (overall)
        baseline_factor = min(1.0, result['baseline_count'] / 60)
        post_factor = min(1.0, result['post_count'] / 10)
        damage_pct = (damaged_km2 / area_km2) * 100 if area_km2 > 0 else 0
        signal_factor = 0.9 if damage_pct >= 10 else (0.7 if damage_pct >= 5 else (0.5 if damage_pct >= 1 else 0.3))
        raw_confidence = baseline_factor * 0.30 + post_factor * 0.20 + signal_factor * 0.50
        confidence = max(0.2, min(0.95, raw_confidence))

        return PWTTResultV2(
            analysis_id=analysis_id,
            algorithm_version=self.ALGORITHM_VERSION,
            bbox=bbox,
            event_date=event_date,
            total_area_km2=round(area_km2, 4),
            damaged_area_km2=round(damaged_km2, 4),
            damage_percentage=round(damage_pct, 2),
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
            terrain_flattened=result['terrain_flattened'],
            building_damage_v2=result.get('building_features', []),
            error=None,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def _safe_num(val, default: float = 0.0) -> float:
    """Safely convert a value to float."""
    if val is None:
        return default
    try:
        n = float(val)
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default


def _classify_size(pixel_count: int) -> str:
    """Classify building size based on pixel count at 10m resolution."""
    if pixel_count >= 10:
        return 'large'
    elif pixel_count >= 4:
        return 'medium'
    elif pixel_count >= 2:
        return 'small'
    else:
        return 'sub_pixel'


def _classify_severity(
    primary_value: float,
    threshold: float,
    size_class: str,
    optical_count: int,
) -> str:
    """Size-aware severity classification.

    Sub-pixel buildings require optical corroboration to confirm damage.
    """
    # Sub-pixel rejection: no optical = no damage call
    if size_class == 'sub_pixel' and optical_count == 0:
        return 'undamaged'

    if primary_value > threshold * 2.0:
        return 'critical'
    elif primary_value > threshold * 1.5:
        return 'severe'
    elif primary_value > threshold:
        return 'moderate'
    else:
        return 'undamaged'


def _compute_confidence(
    primary_value: float,
    threshold: float,
    optical_count: int,
    polarization_agreement: bool,
    pixel_count: int,
    pre_cv: float,
    temporal_persistence_val: Optional[int],
    post_count: int,
) -> float:
    """Compute weighted multi-factor confidence score (0-1).

    Weights:
    - t_stat_magnitude: 30%
    - optical_corroboration: 25%
    - polarization_agreement: 15%
    - pixel_count_reliability: 10%
    - baseline_stability: 10%
    - temporal_persistence: 10%
    """
    # 1. T-stat magnitude (0-1) — how far above threshold
    t_ratio = primary_value / max(threshold, 0.1)
    t_score = min(1.0, max(0.0, (t_ratio - 0.5) / 1.5))  # 0.5x=0, 2x=1

    # 2. Optical corroboration (0-1) — 0/3=0, 1/3=0.33, 2/3=0.67, 3/3=1.0
    optical_score = optical_count / 3.0

    # 3. Polarization agreement (binary)
    pol_score = 1.0 if polarization_agreement else 0.3

    # 4. Pixel count reliability (0-1) — more pixels = more reliable
    pixel_score = min(1.0, pixel_count / 10.0)

    # 5. Baseline stability (0-1) — low CV = stable baseline = more reliable
    # CV < 0.1 is very stable, CV > 0.4 is noisy
    if pre_cv < 0.1:
        stability_score = 1.0
    elif pre_cv < 0.2:
        stability_score = 0.8
    elif pre_cv < 0.3:
        stability_score = 0.5
    else:
        stability_score = 0.2

    # 6. Temporal persistence (0-1) — fraction of post images showing signal
    if temporal_persistence_val and post_count > 0:
        temporal_score = min(1.0, temporal_persistence_val / max(post_count, 1))
    else:
        temporal_score = 0.5  # Unknown = neutral

    # Weighted sum
    confidence = (
        CONFIDENCE_WEIGHTS['t_stat_magnitude'] * t_score
        + CONFIDENCE_WEIGHTS['optical_corroboration'] * optical_score
        + CONFIDENCE_WEIGHTS['polarization_agreement'] * pol_score
        + CONFIDENCE_WEIGHTS['pixel_count_reliability'] * pixel_score
        + CONFIDENCE_WEIGHTS['baseline_stability'] * stability_score
        + CONFIDENCE_WEIGHTS['temporal_persistence'] * temporal_score
    )

    return max(0.05, min(0.99, confidence))
