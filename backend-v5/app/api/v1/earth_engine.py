"""Google Earth Engine API - Satellite Imagery, Environmental Layers, Change Detection.

Provides satellite analysis capabilities:
- Tile proxy for Sentinel-2, NDVI, flood extent, temperature
- Environmental analysis (NDVI, precipitation, temperature)
- Disaster detection (flood extent, landslide)
- Change detection alerts
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db
from app.services.earth_engine import (
    GEEClient,
    TileProxyService,
    EnvironmentalService,
    ImageryService,
    ChangeDetectorService,
)

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/earth-engine", tags=["Earth Engine"])


# =============================================================================
# RESPONSE SCHEMAS
# =============================================================================

class GEEStatusResponse(BaseModel):
    """GEE service status."""
    initialized: bool
    project_id: Optional[str]
    error: Optional[str] = None


class NDVIResponse(BaseModel):
    """NDVI analysis response."""
    mean_ndvi: float = Field(description="Mean NDVI value (-1 to 1)")
    min_ndvi: float
    max_ndvi: float
    anomaly_pct: float = Field(description="Percentage anomaly from historical baseline")
    tile_url_template: Optional[str] = Field(description="Tile URL template for map display")
    analysis_date: str
    bbox: List[float]


class PrecipitationResponse(BaseModel):
    """Precipitation analysis response."""
    total_mm: float = Field(description="Total precipitation in mm")
    mean_daily_mm: float
    max_daily_mm: float
    anomaly_pct: float
    flood_risk_score: float = Field(ge=0, le=1, description="Flood risk score (0-1)")
    daily_values: List[Dict[str, Any]] = Field(description="Daily precipitation values")
    tile_url_template: Optional[str]
    start_date: str
    end_date: str
    bbox: List[float]


class TemperatureResponse(BaseModel):
    """Temperature analysis response."""
    mean_celsius: float
    min_celsius: float
    max_celsius: float
    anomaly_celsius: float = Field(description="Deviation from historical mean")
    tile_url_template: Optional[str]
    analysis_date: str
    bbox: List[float]


class FloodAnalysisRequest(BaseModel):
    """Request for flood extent analysis."""
    bbox: str = Field(description="Bounding box: minLng,minLat,maxLng,maxLat")
    before_date: str = Field(description="Date before flood (YYYY-MM-DD)")
    after_date: str = Field(description="Date after flood (YYYY-MM-DD)")


class FloodAnalysisResponse(BaseModel):
    """Flood extent analysis response."""
    flooded_area_km2: float
    water_before_km2: float
    water_after_km2: float
    change_pct: float
    before_image_url: Optional[str]
    after_image_url: Optional[str]
    tile_url_template: Optional[str]
    geojson: Optional[Dict[str, Any]] = Field(description="GeoJSON of flooded areas")
    bbox: List[float]
    before_date: str
    after_date: str


class LandslideDetection(BaseModel):
    """Individual landslide detection."""
    center: List[float] = Field(description="[lng, lat]")
    area_km2: float
    confidence: float
    geojson: Optional[Dict[str, Any]]


class LandslideAnalysisRequest(BaseModel):
    """Request for landslide detection."""
    bbox: str = Field(description="Bounding box: minLng,minLat,maxLng,maxLat")
    before_date: str = Field(description="Date before event (YYYY-MM-DD)")
    after_date: str = Field(description="Date after event (YYYY-MM-DD)")
    sensitivity: float = Field(0.5, ge=0.1, le=1.0, description="Detection sensitivity")


class LandslideAnalysisResponse(BaseModel):
    """Landslide detection response."""
    detections: List[LandslideDetection]
    total_affected_km2: float
    tile_url_template: Optional[str]
    bbox: List[float]
    before_date: str
    after_date: str


class BeforeAfterResponse(BaseModel):
    """Before/after comparison imagery."""
    before_image_url: str
    after_image_url: str
    before_date: str
    after_date: str
    bbox: List[float]


class ChangeSubscriptionRequest(BaseModel):
    """Request to subscribe for change detection."""
    region_type: str = Field(description="Type: bbox, district, polygon")
    region_value: str = Field(description="Region definition (coords, name, or GeoJSON)")
    detection_types: List[str] = Field(
        description="Types to monitor: flood, landslide, vegetation-loss"
    )
    sensitivity: float = Field(0.5, ge=0.1, le=1.0, description="Detection sensitivity")
    min_area_km2: float = Field(1.0, ge=0.01, description="Minimum area for alerts")


class ChangeSubscriptionResponse(BaseModel):
    """Change detection subscription response."""
    subscription_id: str
    region_type: str
    region_value: str
    detection_types: List[str]
    is_active: bool
    created_at: str


class ChangeAlertResponse(BaseModel):
    """A detected change alert."""
    id: str
    detection_type: str
    severity: str
    confidence: float
    district: Optional[str]
    center: List[float] = Field(description="[lng, lat]")
    area_km2: float
    before_image_url: Optional[str]
    after_image_url: Optional[str]
    difference_tile_url: Optional[str]
    detected_at: str
    description: str
    geojson: Optional[Dict[str, Any]]


class ChangeAlertsResponse(BaseModel):
    """List of change alerts."""
    alerts: List[ChangeAlertResponse]
    total_count: int
    hours_queried: int


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_bbox(bbox_str: str) -> List[float]:
    """Parse bbox string to list of floats."""
    try:
        coords = [float(x.strip()) for x in bbox_str.split(",")]
        if len(coords) != 4:
            raise ValueError("Must have exactly 4 coordinates")
        return coords
    except (ValueError, AttributeError) as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid bbox format. Expected 'minLng,minLat,maxLng,maxLat': {e}"
        )


async def get_gee_client() -> GEEClient:
    """Get initialized GEE client or raise error."""
    client = await GEEClient.get_instance()
    if not client._initialized:
        raise HTTPException(
            status_code=503,
            detail="Google Earth Engine not initialized. Check GEE_SERVICE_ACCOUNT_JSON configuration."
        )
    return client


# =============================================================================
# STATUS ENDPOINT
# =============================================================================

@router.get("/status", response_model=GEEStatusResponse)
async def get_gee_status():
    """Check Google Earth Engine service status.

    Returns initialization status and project configuration.
    """
    try:
        client = await GEEClient.get_instance()
        return GEEStatusResponse(
            initialized=client._initialized,
            project_id=settings.gee_project_id,
        )
    except Exception as e:
        return GEEStatusResponse(
            initialized=False,
            project_id=settings.gee_project_id,
            error=str(e),
        )


# =============================================================================
# TILE PROXY ENDPOINTS
# =============================================================================

@router.get("/tiles/{layer_type}/{z}/{x}/{y}.png")
async def get_tile(
    layer_type: str,
    z: int,
    x: int,
    y: int,
    date: Optional[str] = Query(None, description="Date (YYYY-MM-DD), defaults to latest"),
    bbox: Optional[str] = Query(None, description="Optional bbox for analysis tiles"),
):
    """Proxy satellite tiles from Google Earth Engine.

    Supported layer types:
    - sentinel2-rgb: True color Sentinel-2 imagery
    - sentinel2-false-color: NIR false color composite
    - ndvi: Normalized Difference Vegetation Index
    - flood-extent: Water/flood detection mask
    - temperature: Land surface temperature (MODIS)
    - precipitation: Rainfall data (CHIRPS)

    Tiles are cached in Redis for 1 hour (GEE URLs expire after ~2 hours).
    """
    valid_layer_types = [
        "sentinel2-rgb", "sentinel2-false-color", "ndvi",
        "flood-extent", "temperature", "precipitation"
    ]

    if layer_type not in valid_layer_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid layer type. Must be one of: {', '.join(valid_layer_types)}"
        )

    # Validate zoom level
    if z < 0 or z > 18:
        raise HTTPException(status_code=400, detail="Zoom level must be between 0 and 18")

    await get_gee_client()  # Ensure GEE is initialized

    # Use default date if not provided
    if not date:
        date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

    tile_service = TileProxyService()
    bbox_list = parse_bbox(bbox) if bbox else None

    try:
        tile_bytes = await tile_service.proxy_tile(
            layer_type=layer_type,
            z=z,
            x=x,
            y=y,
            date=date,
            bbox=bbox_list,
        )

        return Response(
            content=tile_bytes,
            media_type="image/png",
            headers={
                "Cache-Control": "public, max-age=3600",  # 1 hour browser cache
            },
        )

    except Exception as e:
        logger.exception(f"Error fetching tile {layer_type}/{z}/{x}/{y}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch tile: {e}")


@router.get("/tiles/{layer_type}/url")
async def get_tile_url_template(
    layer_type: str,
    date: Optional[str] = Query(None, description="Date (YYYY-MM-DD)"),
    bbox: Optional[str] = Query(None, description="Bounding box for analysis"),
):
    """Get tile URL template for direct use in mapping libraries.

    Returns a URL template like:
    https://earthengine.googleapis.com/v1alpha/projects/.../maps/.../tiles/{z}/{x}/{y}

    Useful for Leaflet/MapLibre integration where you want to use GEE tiles directly.
    Note: URLs expire after ~2 hours.
    """
    await get_gee_client()

    if not date:
        date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

    tile_service = TileProxyService()
    bbox_list = parse_bbox(bbox) if bbox else None

    try:
        url_template = await tile_service.get_tile_url_template(
            layer_type=layer_type,
            date=date,
            bbox=bbox_list,
        )

        return {
            "layer_type": layer_type,
            "date": date,
            "url_template": url_template,
            "expires_in_seconds": settings.gee_tile_cache_ttl,
        }

    except Exception as e:
        logger.exception(f"Error getting tile URL for {layer_type}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get tile URL: {e}")


# =============================================================================
# ENVIRONMENTAL ANALYSIS ENDPOINTS
# =============================================================================

@router.get("/environmental/ndvi", response_model=NDVIResponse)
async def get_ndvi(
    bbox: str = Query(..., description="Bounding box: minLng,minLat,maxLng,maxLat"),
    date: Optional[str] = Query(None, description="Analysis date (YYYY-MM-DD)"),
):
    """Get NDVI (Normalized Difference Vegetation Index) analysis.

    NDVI measures vegetation health: (NIR - Red) / (NIR + Red)
    - Values near 1.0: Dense, healthy vegetation
    - Values near 0: Bare soil, urban areas
    - Negative values: Water, snow

    Also returns anomaly compared to historical baseline for the region.
    """
    await get_gee_client()

    if not date:
        date = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")

    bbox_list = parse_bbox(bbox)
    env_service = EnvironmentalService()

    try:
        result = await env_service.get_ndvi(bbox=bbox_list, date=date)

        return NDVIResponse(
            mean_ndvi=result.mean_ndvi,
            min_ndvi=result.min_ndvi,
            max_ndvi=result.max_ndvi,
            anomaly_pct=result.anomaly_pct,
            tile_url_template=result.tile_url_template,
            analysis_date=date,
            bbox=bbox_list,
        )

    except Exception as e:
        logger.exception(f"Error in NDVI analysis: {e}")
        raise HTTPException(status_code=500, detail=f"NDVI analysis failed: {e}")


@router.get("/environmental/precipitation", response_model=PrecipitationResponse)
async def get_precipitation(
    bbox: str = Query(..., description="Bounding box: minLng,minLat,maxLng,maxLat"),
    start_date: str = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: str = Query(..., description="End date (YYYY-MM-DD)"),
):
    """Get precipitation analysis from CHIRPS dataset.

    Returns total and daily precipitation for the period, with:
    - Historical anomaly percentage
    - Flood risk score based on accumulated rainfall
    - Daily breakdown for time series visualization

    CHIRPS provides ~5km resolution rainfall estimates.
    """
    await get_gee_client()

    bbox_list = parse_bbox(bbox)
    env_service = EnvironmentalService()

    try:
        result = await env_service.get_precipitation(
            bbox=bbox_list,
            start_date=start_date,
            end_date=end_date,
        )

        return PrecipitationResponse(
            total_mm=result.total_mm,
            mean_daily_mm=result.mean_daily_mm,
            max_daily_mm=result.max_daily_mm,
            anomaly_pct=result.anomaly_pct,
            flood_risk_score=result.flood_risk_score,
            daily_values=result.daily_values,
            tile_url_template=result.tile_url_template,
            start_date=start_date,
            end_date=end_date,
            bbox=bbox_list,
        )

    except Exception as e:
        logger.exception(f"Error in precipitation analysis: {e}")
        raise HTTPException(status_code=500, detail=f"Precipitation analysis failed: {e}")


@router.get("/environmental/temperature", response_model=TemperatureResponse)
async def get_temperature(
    bbox: str = Query(..., description="Bounding box: minLng,minLat,maxLng,maxLat"),
    date: Optional[str] = Query(None, description="Analysis date (YYYY-MM-DD)"),
):
    """Get land surface temperature from MODIS.

    Returns temperature statistics and anomaly from historical mean.
    MODIS provides daily daytime/nighttime LST at ~1km resolution.
    """
    await get_gee_client()

    if not date:
        date = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")

    bbox_list = parse_bbox(bbox)
    env_service = EnvironmentalService()

    try:
        result = await env_service.get_temperature(bbox=bbox_list, date=date)

        return TemperatureResponse(
            mean_celsius=result.mean_celsius,
            min_celsius=result.min_celsius,
            max_celsius=result.max_celsius,
            anomaly_celsius=result.anomaly_celsius,
            tile_url_template=result.tile_url_template,
            analysis_date=date,
            bbox=bbox_list,
        )

    except Exception as e:
        logger.exception(f"Error in temperature analysis: {e}")
        raise HTTPException(status_code=500, detail=f"Temperature analysis failed: {e}")


# =============================================================================
# DISASTER IMAGERY ENDPOINTS
# =============================================================================

@router.post("/analysis/flood-extent", response_model=FloodAnalysisResponse)
async def analyze_flood_extent(request: FloodAnalysisRequest):
    """Detect flood extent using Sentinel-1 SAR imagery.

    Compares water extent between before and after dates to identify
    newly flooded areas. SAR works through clouds, making it ideal
    for monsoon flood monitoring.

    Uses VV polarization with -15dB threshold for water detection.
    """
    await get_gee_client()

    bbox_list = parse_bbox(request.bbox)
    imagery_service = ImageryService()

    try:
        result = await imagery_service.detect_flood_extent(
            bbox=bbox_list,
            before_date=request.before_date,
            after_date=request.after_date,
        )

        return FloodAnalysisResponse(
            flooded_area_km2=result.flooded_area_km2,
            water_before_km2=result.water_before_km2,
            water_after_km2=result.water_after_km2,
            change_pct=result.change_pct,
            before_image_url=result.before_image_url,
            after_image_url=result.after_image_url,
            tile_url_template=result.tile_url_template,
            geojson=result.geojson,
            bbox=bbox_list,
            before_date=request.before_date,
            after_date=request.after_date,
        )

    except Exception as e:
        logger.exception(f"Error in flood extent analysis: {e}")
        raise HTTPException(status_code=500, detail=f"Flood analysis failed: {e}")


@router.post("/analysis/landslide", response_model=LandslideAnalysisResponse)
async def detect_landslides(request: LandslideAnalysisRequest):
    """Detect potential landslides using NDVI change + terrain analysis.

    Identifies areas with:
    - Significant vegetation loss (NDVI decrease)
    - Located on steep slopes (from SRTM DEM)

    Higher sensitivity values detect smaller changes but may have more false positives.
    """
    await get_gee_client()

    bbox_list = parse_bbox(request.bbox)
    imagery_service = ImageryService()

    try:
        result = await imagery_service.detect_landslides(
            bbox=bbox_list,
            before_date=request.before_date,
            after_date=request.after_date,
            sensitivity=request.sensitivity,
        )

        return LandslideAnalysisResponse(
            detections=[
                LandslideDetection(
                    center=det.center,
                    area_km2=det.area_km2,
                    confidence=det.confidence,
                    geojson=det.geojson,
                )
                for det in result.detections
            ],
            total_affected_km2=result.total_affected_km2,
            tile_url_template=result.tile_url_template,
            bbox=bbox_list,
            before_date=request.before_date,
            after_date=request.after_date,
        )

    except Exception as e:
        logger.exception(f"Error in landslide detection: {e}")
        raise HTTPException(status_code=500, detail=f"Landslide detection failed: {e}")


@router.get("/analysis/before-after", response_model=BeforeAfterResponse)
async def get_before_after_imagery(
    bbox: str = Query(..., description="Bounding box: minLng,minLat,maxLng,maxLat"),
    before_date: str = Query(..., description="Before date (YYYY-MM-DD)"),
    after_date: str = Query(..., description="After date (YYYY-MM-DD)"),
):
    """Get before/after comparison imagery URLs.

    Returns Sentinel-2 true color image URLs for visual comparison
    of an area before and after an event.
    """
    await get_gee_client()

    bbox_list = parse_bbox(bbox)
    imagery_service = ImageryService()

    try:
        result = await imagery_service.generate_before_after(
            bbox=bbox_list,
            before_date=before_date,
            after_date=after_date,
        )

        return BeforeAfterResponse(
            before_image_url=result.before_image_url,
            after_image_url=result.after_image_url,
            before_date=before_date,
            after_date=after_date,
            bbox=bbox_list,
        )

    except Exception as e:
        logger.exception(f"Error generating before/after imagery: {e}")
        raise HTTPException(status_code=500, detail=f"Before/after generation failed: {e}")


# =============================================================================
# CHANGE DETECTION ENDPOINTS
# =============================================================================

@router.post("/change-detection/subscribe", response_model=ChangeSubscriptionResponse)
async def subscribe_change_detection(
    request: ChangeSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Subscribe a region for automated change monitoring.

    The system will periodically check for:
    - Flood extent changes
    - Potential landslides (vegetation loss on slopes)
    - Vegetation anomalies

    Alerts are stored in database and broadcast via WebSocket.
    """
    # Validate detection types
    valid_types = {"flood", "landslide", "vegetation-loss"}
    invalid_types = set(request.detection_types) - valid_types
    if invalid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid detection types: {invalid_types}. Valid types: {valid_types}"
        )

    # Create subscription (TODO: implement database persistence)
    subscription_id = str(uuid4())

    logger.info(
        f"Created change detection subscription: {subscription_id} "
        f"for {request.region_type}={request.region_value}"
    )

    return ChangeSubscriptionResponse(
        subscription_id=subscription_id,
        region_type=request.region_type,
        region_value=request.region_value,
        detection_types=request.detection_types,
        is_active=True,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/change-detection/alerts", response_model=ChangeAlertsResponse)
async def get_change_alerts(
    hours: int = Query(168, ge=1, le=720, description="Time window in hours (default 7 days)"),
    detection_type: Optional[str] = Query(None, description="Filter by detection type"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    district: Optional[str] = Query(None, description="Filter by district"),
    db: AsyncSession = Depends(get_db),
):
    """Get recent satellite change detection alerts.

    Returns alerts generated by the automated change detection system,
    including flood extent changes, landslide detections, and vegetation anomalies.
    """
    # TODO: Implement database query for alerts
    # For now, return empty list
    alerts: List[ChangeAlertResponse] = []

    return ChangeAlertsResponse(
        alerts=alerts,
        total_count=len(alerts),
        hours_queried=hours,
    )


@router.post("/change-detection/run")
async def trigger_change_detection(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a change detection cycle.

    This is normally run automatically by the scheduler every 6 hours.
    Use this endpoint to trigger an immediate detection run.
    """
    if not settings.gee_change_detection_enabled:
        raise HTTPException(
            status_code=400,
            detail="Change detection is disabled in configuration"
        )

    async def run_detection():
        try:
            service = ChangeDetectorService(db)
            stats = await service.run_detection_cycle()
            logger.info(f"Manual change detection completed: {stats}")
        except Exception as e:
            logger.exception(f"Manual change detection failed: {e}")

    background_tasks.add_task(run_detection)

    return {
        "status": "started",
        "message": "Change detection cycle started in background",
    }


@router.delete("/change-detection/subscribe/{subscription_id}")
async def unsubscribe_change_detection(
    subscription_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Unsubscribe from change detection monitoring.

    Deactivates the subscription - no more alerts will be generated.
    """
    # TODO: Implement database update
    logger.info(f"Deactivated subscription: {subscription_id}")

    return {
        "subscription_id": subscription_id,
        "status": "deactivated",
    }
