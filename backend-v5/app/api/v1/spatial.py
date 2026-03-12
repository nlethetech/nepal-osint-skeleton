"""Spatial Analysis API - KML Export, Hotspot Detection, Proximity Queries.

Provides spatial analysis capabilities for Google Earth integration:
- KML/KMZ export for map events
- NetworkLink for live data feeds in Google Earth
- Hotspot detection using DBSCAN clustering
- Proximity/radius queries
- Temporal-spatial animation data
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.disaster import DisasterIncident, DisasterAlert
from app.models.river import RiverStation, RiverReading
from app.models.story import Story
from app.models.story_feature import StoryFeature
from app.services.spatial import (
    KMLGenerator,
    HotspotDetector,
    ProximityService,
    TemporalSpatialService,
)

# Import helpers from map.py
from app.api.v1.map import (
    DISTRICT_COORDINATES,
    resolve_district,
    extract_location_from_text,
    jitter_coordinates,
    severity_from_incident,
    HAZARD_TO_CATEGORY,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/spatial", tags=["Spatial Analysis"])


# =============================================================================
# RESPONSE SCHEMAS
# =============================================================================

class HotspotCluster(BaseModel):
    """A detected geographic cluster of events."""
    cluster_id: int
    centroid: List[float] = Field(description="[lng, lat] format")
    member_count: int
    events: List[str]
    bounding_box: List[float] = Field(description="[min_lng, min_lat, max_lng, max_lat]")
    dominant_category: str
    severity_breakdown: Dict[str, int]
    districts: List[str]
    time_range: Dict[str, str]
    density_score: float


class HotspotResponse(BaseModel):
    """Response for hotspot analysis endpoint."""
    clusters: List[HotspotCluster]
    total_events_analyzed: int
    clustered_events: int
    noise_events: int
    parameters: Dict[str, Any]


class ProximityEvent(BaseModel):
    """An event with distance/bearing from center point."""
    id: str
    title: str
    category: str
    severity: str
    timestamp: Optional[str]
    coordinates: List[float]
    distance_km: float
    bearing_deg: float
    direction: str
    district: Optional[str]


class ProximityResponse(BaseModel):
    """Response for proximity query endpoint."""
    center: List[float]
    radius_km: float
    events: List[ProximityEvent]
    total_found: int
    nearest_event: Optional[ProximityEvent]
    farthest_event: Optional[ProximityEvent]


class TemporalBucket(BaseModel):
    """A time bucket with events and spatial info."""
    bucket_start: str
    bucket_end: str
    events: List[Dict[str, Any]]
    event_count: int
    centroid: Optional[List[float]]
    new_districts: List[str]


class PropagationMetrics(BaseModel):
    """Metrics describing how events have spread over time."""
    initial_centroid: List[float]
    final_centroid: List[float]
    spread_distance_km: float
    spread_direction: str
    bearing_deg: float
    max_extent_km: float
    affected_area_sq_km: float
    total_districts_affected: int
    districts: List[str]


class TemporalSpatialResponse(BaseModel):
    """Response for temporal-spatial analysis endpoint."""
    buckets: List[TemporalBucket]
    time_range: Dict[str, str]
    total_events: int
    bucket_hours: int
    propagation: Optional[PropagationMetrics]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

async def fetch_map_events(
    db: AsyncSession,
    hours: int = 24,
    categories: Optional[str] = None,
    severities: Optional[str] = None,
    districts: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """Fetch map events from database (reused from map.py logic).

    Returns list of event dicts with standardized format.
    """
    events = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Parse filters
    category_filter = set(categories.upper().split(",")) if categories else None
    severity_filter = set(severities.upper().split(",")) if severities else None
    district_filter = set(d.lower() for d in districts.split(",")) if districts else None

    # Fetch disaster incidents
    query = select(DisasterIncident).where(
        and_(
            DisasterIncident.latitude.isnot(None),
            DisasterIncident.longitude.isnot(None),
            DisasterIncident.incident_on >= cutoff,
        )
    ).order_by(DisasterIncident.incident_on.desc()).limit(limit)

    result = await db.execute(query)
    incidents = result.scalars().all()

    for inc in incidents:
        category = HAZARD_TO_CATEGORY.get(inc.hazard_type, "DISASTER")
        severity = severity_from_incident(inc)

        # Apply filters
        if category_filter and category not in category_filter:
            continue
        if severity_filter and severity not in severity_filter:
            continue

        district = inc.district.lower() if inc.district else None
        if district_filter and district and district not in district_filter:
            continue

        events.append({
            "id": str(inc.id),
            "title": inc.title or f"{inc.hazard_type} in {inc.district}",
            "category": category,
            "severity": severity,
            "timestamp": inc.incident_on.isoformat() if inc.incident_on else None,
            "coordinates": [inc.longitude, inc.latitude],
            "district": inc.district,
            "deaths": inc.deaths,
            "injured": inc.injured,
            "summary": inc.description,
            "source_url": inc.source_url,
        })

    # Fetch disaster alerts (earthquakes, etc.)
    alert_query = select(DisasterAlert).where(
        and_(
            DisasterAlert.latitude.isnot(None),
            DisasterAlert.longitude.isnot(None),
            DisasterAlert.issued_at >= cutoff,
        )
    ).order_by(DisasterAlert.issued_at.desc()).limit(limit)

    alert_result = await db.execute(alert_query)
    alerts = alert_result.scalars().all()

    for alert in alerts:
        severity = "CRITICAL" if alert.magnitude and alert.magnitude >= 5.0 else "HIGH"

        if category_filter and "DISASTER" not in category_filter:
            continue
        if severity_filter and severity not in severity_filter:
            continue

        district = alert.district.lower() if alert.district else None
        if district_filter and district and district not in district_filter:
            continue

        events.append({
            "id": str(alert.id),
            "title": alert.title or f"Earthquake M{alert.magnitude}",
            "category": "DISASTER",
            "severity": severity,
            "timestamp": alert.issued_at.isoformat() if alert.issued_at else None,
            "coordinates": [alert.longitude, alert.latitude],
            "district": alert.district,
            "magnitude": alert.magnitude,
            "summary": alert.description,
            "source_url": alert.source_url,
        })

    # Fetch news stories with location data
    story_query = (
        select(Story)
        .join(StoryFeature, Story.id == StoryFeature.story_id, isouter=True)
        .where(
            and_(
                Story.published_at >= cutoff,
                or_(
                    StoryFeature.title_district.isnot(None),
                    StoryFeature.districts.isnot(None),
                ),
            )
        )
        .options(selectinload(Story.features))
        .order_by(Story.published_at.desc())
        .limit(limit)
    )

    story_result = await db.execute(story_query)
    stories = story_result.scalars().all()

    for story in stories:
        if not story.features:
            continue

        # Get category and severity
        category = (story.category or "GENERAL").upper()
        severity = (story.severity or "MEDIUM").upper()

        if category_filter and category not in category_filter:
            continue
        if severity_filter and severity not in severity_filter:
            continue

        # Get coordinates from district
        district = story.features.title_district or (
            story.features.districts[0] if story.features.districts else None
        )

        if not district:
            continue

        district_lower = district.lower()
        if district_filter and district_lower not in district_filter:
            continue

        coords = DISTRICT_COORDINATES.get(resolve_district(district))
        if not coords:
            continue

        # Jitter to prevent stacking
        jittered = jitter_coordinates(coords[0], coords[1], str(story.id))

        events.append({
            "id": str(story.id),
            "title": story.title,
            "category": category,
            "severity": severity,
            "timestamp": story.published_at.isoformat() if story.published_at else None,
            "coordinates": [jittered[1], jittered[0]],  # [lng, lat]
            "district": district,
            "summary": story.summary,
            "source_url": story.url,
        })

    return events[:limit]


# =============================================================================
# API ENDPOINTS
# =============================================================================

@router.get("/export/kml")
async def export_kml(
    request: Request,
    hours: int = Query(24, ge=1, le=720, description="Time window in hours"),
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    severities: Optional[str] = Query(None, description="Comma-separated severities"),
    districts: Optional[str] = Query(None, description="Comma-separated districts"),
    format: str = Query("kml", regex="^(kml|kmz)$", description="Output format"),
    db: AsyncSession = Depends(get_db),
):
    """Export map events as KML or KMZ for Google Earth.

    The exported file includes:
    - Placemarks for each event with category/severity styling
    - TimeStamp elements for time-based visualization
    - Folder organization by category
    - Rich description popups with event details
    """
    events = await fetch_map_events(
        db, hours=hours, categories=categories,
        severities=severities, districts=districts, limit=1000
    )

    generator = KMLGenerator(base_url=str(request.base_url))
    title = f"NARADA Nepal OSINT - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC"

    if format == "kmz":
        content = generator.generate_kmz(events, title)
        return Response(
            content=content,
            media_type="application/vnd.google-earth.kmz",
            headers={"Content-Disposition": f'attachment; filename="narada-events-{hours}h.kmz"'},
        )
    else:
        content = generator.generate_kml(events, title)
        return Response(
            content=content,
            media_type="application/vnd.google-earth.kml+xml",
            headers={"Content-Disposition": f'attachment; filename="narada-events-{hours}h.kml"'},
        )


@router.get("/networklink.kml")
async def get_network_link(
    request: Request,
    refresh_interval: int = Query(300, ge=60, le=900, description="Refresh interval in seconds"),
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    severities: Optional[str] = Query(None, description="Comma-separated severities"),
):
    """Get KML NetworkLink document for live data feed in Google Earth.

    Configure this in Google Earth:
    1. Add > Network Link
    2. Paste this URL
    3. Google Earth will auto-refresh at the specified interval

    The NetworkLink will fetch fresh data from /spatial/export/kml.
    """
    # Build the data URL with parameters
    params = {"hours": hours}
    if categories:
        params["categories"] = categories
    if severities:
        params["severities"] = severities

    data_url = f"{request.base_url}api/v1/spatial/export/kml?{urlencode(params)}"

    generator = KMLGenerator()
    content = generator.generate_network_link(
        data_url=data_url,
        refresh_interval=refresh_interval,
        title=f"NARADA Live Feed ({refresh_interval // 60}min refresh)",
    )

    return Response(
        content=content,
        media_type="application/vnd.google-earth.kml+xml",
        headers={"Content-Disposition": 'attachment; filename="narada-live-feed.kml"'},
    )


@router.get("/hotspots", response_model=HotspotResponse)
async def get_hotspots(
    hours: int = Query(168, ge=1, le=720, description="Time window in hours (default 7 days)"),
    min_cluster_size: int = Query(3, ge=2, le=50, description="Minimum events for a cluster"),
    eps_km: float = Query(10.0, ge=1.0, le=50.0, description="DBSCAN epsilon distance in km (default 10km)"),
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    severities: Optional[str] = Query(None, description="Comma-separated severities"),
    limit: int = Query(1000, ge=100, le=5000, description="Maximum events to analyze"),
    db: AsyncSession = Depends(get_db),
):
    """Detect geographic hotspots using DBSCAN clustering.

    Identifies clusters of events that are geographically close together,
    indicating areas of concentrated activity (hotspots).

    Returns cluster centroids, member counts, bounding boxes, and statistics.

    Note: Default eps_km reduced from 25km to 10km to provide neighborhood-level
    granularity. Previous default clustered entire districts together.
    """
    events = await fetch_map_events(
        db, hours=hours, categories=categories,
        severities=severities, limit=limit
    )

    detector = HotspotDetector(eps_km=eps_km, min_samples=min_cluster_size)
    result = detector.detect_hotspots(events)

    return HotspotResponse(**result)


@router.get("/proximity", response_model=ProximityResponse)
async def get_proximity(
    lat: float = Query(..., ge=26.3, le=30.5, description="Center latitude (Nepal bounds)"),
    lng: float = Query(..., ge=80.0, le=88.3, description="Center longitude (Nepal bounds)"),
    radius_km: float = Query(50.0, ge=1.0, le=500.0, description="Search radius in km"),
    hours: int = Query(24, ge=1, le=720, description="Time window in hours"),
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    severities: Optional[str] = Query(None, description="Comma-separated severities"),
    limit: int = Query(100, ge=1, le=500, description="Maximum events"),
    db: AsyncSession = Depends(get_db),
):
    """Find events within a radius of a center point.

    Returns events sorted by distance from the center, with bearing
    (compass direction) from the center point.

    Useful for analyzing activity around a specific location.

    Note: Coordinates must be within Nepal bounds (26.3-30.5N, 80.0-88.3E).
    """
    events = await fetch_map_events(
        db, hours=hours, categories=categories,
        severities=severities, limit=2000
    )

    service = ProximityService()
    result = service.find_within_radius(
        events=events,
        center_lat=lat,
        center_lng=lng,
        radius_km=radius_km,
        limit=limit,
    )

    return ProximityResponse(**result)


@router.get("/temporal", response_model=TemporalSpatialResponse)
async def get_temporal_spatial(
    hours: int = Query(48, ge=1, le=720, description="Time window in hours"),
    bucket_hours: int = Query(1, ge=1, le=24, description="Time bucket size in hours"),
    categories: Optional[str] = Query(None, description="Comma-separated categories"),
    severities: Optional[str] = Query(None, description="Comma-separated severities"),
    include_propagation: bool = Query(False, description="Include spread/propagation metrics"),
    db: AsyncSession = Depends(get_db),
):
    """Get temporal-spatial analysis data for animation.

    Returns events organized into time buckets, with:
    - Geographic centroid per bucket
    - New districts appearing in each bucket
    - Optional propagation metrics (how events spread over time)

    Useful for visualizing how events unfold across geography over time.
    """
    events = await fetch_map_events(
        db, hours=hours, categories=categories,
        severities=severities, limit=1000
    )

    service = TemporalSpatialService()
    result = service.get_temporal_buckets(
        events=events,
        hours=hours,
        bucket_hours=bucket_hours,
        include_propagation=include_propagation,
    )

    return TemporalSpatialResponse(**result)
