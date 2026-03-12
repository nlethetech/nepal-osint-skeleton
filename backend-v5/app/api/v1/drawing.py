"""Drawing and Analysis Tools API for geospatial analysis."""
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db

router = APIRouter(prefix="/drawing", tags=["drawing"])


# ============================================================================
# Schemas
# ============================================================================


class Coordinate(BaseModel):
    """Geographic coordinate."""
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PolygonGeometry(BaseModel):
    """Polygon geometry for analysis."""
    type: str = "Polygon"
    coordinates: List[List[Coordinate]]  # Outer ring + optional holes


class AnalyzeRegionRequest(BaseModel):
    """Request to analyze a drawn region."""
    geometry: PolygonGeometry
    analysis_types: List[str] = Field(
        default=["pwtt", "ndvi"],
        description="Types of analysis to perform: pwtt, ndvi, flood, landslide"
    )
    before_date: Optional[str] = None  # ISO date for pre-event
    after_date: Optional[str] = None  # ISO date for post-event


class SaveRegionRequest(BaseModel):
    """Request to save a drawn region."""
    name: str
    description: Optional[str] = None
    geometry: PolygonGeometry
    tags: List[str] = []
    is_public: bool = False


class MeasurementRequest(BaseModel):
    """Request for measurements."""
    measurement_type: str = Field(..., description="distance, area, or elevation")
    coordinates: List[Coordinate]


class RegionAnalysisResult(BaseModel):
    """Result of region analysis."""
    region_id: str
    analysis_type: str
    status: str  # pending, processing, completed, failed
    stats: Optional[dict] = None
    tile_url: Optional[str] = None
    generated_at: Optional[str] = None
    error: Optional[str] = None


class SavedRegion(BaseModel):
    """Saved region for reuse."""
    id: str
    name: str
    description: Optional[str]
    geometry: PolygonGeometry
    tags: List[str]
    area_km2: float
    centroid: Coordinate
    created_at: str
    created_by: Optional[str]
    is_public: bool


class MeasurementResult(BaseModel):
    """Result of measurement calculation."""
    measurement_type: str
    value: float
    unit: str
    points: List[Coordinate]
    metadata: Optional[dict] = None


# ============================================================================
# In-memory storage for saved regions (replace with DB in production)
# ============================================================================

SAVED_REGIONS: dict[str, SavedRegion] = {}
ANALYSIS_RESULTS: dict[str, RegionAnalysisResult] = {}


# ============================================================================
# Helper Functions
# ============================================================================


def calculate_polygon_area(coordinates: List[List[Coordinate]]) -> float:
    """Calculate area in km² using Shoelace formula (approximate)."""
    if not coordinates or not coordinates[0]:
        return 0.0

    ring = coordinates[0]
    n = len(ring)
    if n < 3:
        return 0.0

    # Approximate conversion to km (at Nepal's latitude ~27°)
    lat_to_km = 111.0  # 1 degree latitude ≈ 111 km
    lng_to_km = 98.0   # 1 degree longitude ≈ 98 km at 27°N

    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        x1 = ring[i].lng * lng_to_km
        y1 = ring[i].lat * lat_to_km
        x2 = ring[j].lng * lng_to_km
        y2 = ring[j].lat * lat_to_km
        area += x1 * y2 - x2 * y1

    return abs(area) / 2.0


def calculate_centroid(coordinates: List[List[Coordinate]]) -> Coordinate:
    """Calculate centroid of polygon."""
    if not coordinates or not coordinates[0]:
        return Coordinate(lat=27.7, lng=85.3)  # Default to Kathmandu

    ring = coordinates[0]
    n = len(ring)

    lat_sum = sum(c.lat for c in ring)
    lng_sum = sum(c.lng for c in ring)

    return Coordinate(lat=lat_sum / n, lng=lng_sum / n)


def calculate_distance(coords: List[Coordinate]) -> float:
    """Calculate total distance in km along a path."""
    from math import radians, sin, cos, sqrt, atan2

    total = 0.0
    R = 6371  # Earth radius in km

    for i in range(len(coords) - 1):
        lat1, lon1 = radians(coords[i].lat), radians(coords[i].lng)
        lat2, lon2 = radians(coords[i + 1].lat), radians(coords[i + 1].lng)

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))

        total += R * c

    return total


async def run_pwtt_analysis(region_id: str, geometry: PolygonGeometry, before_date: Optional[str], after_date: Optional[str]):
    """Background task to run PWTT damage analysis."""
    # This would integrate with the actual GEE PWTT service
    # For now, return mock results
    import asyncio
    await asyncio.sleep(2)  # Simulate processing time

    ANALYSIS_RESULTS[f"{region_id}_pwtt"] = RegionAnalysisResult(
        region_id=region_id,
        analysis_type="pwtt",
        status="completed",
        stats={
            "mean_change": 0.32,
            "max_change": 0.78,
            "affected_area_km2": 12.5,
            "damage_classification": {
                "no_damage": 0.45,
                "minor": 0.35,
                "moderate": 0.15,
                "severe": 0.05,
            },
        },
        tile_url=f"/api/v1/earth-engine/tiles/pwtt-result/{region_id}/{{z}}/{{x}}/{{y}}",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


async def run_ndvi_analysis(region_id: str, geometry: PolygonGeometry):
    """Background task to run NDVI vegetation analysis."""
    import asyncio
    await asyncio.sleep(1.5)

    ANALYSIS_RESULTS[f"{region_id}_ndvi"] = RegionAnalysisResult(
        region_id=region_id,
        analysis_type="ndvi",
        status="completed",
        stats={
            "mean_ndvi": 0.45,
            "min_ndvi": -0.1,
            "max_ndvi": 0.85,
            "vegetation_cover": 0.62,
            "classification": {
                "water_bare": 0.08,
                "sparse_vegetation": 0.22,
                "moderate_vegetation": 0.35,
                "dense_vegetation": 0.35,
            },
        },
        tile_url=f"/api/v1/earth-engine/tiles/ndvi-result/{region_id}/{{z}}/{{x}}/{{y}}",
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/analyze-region")
async def analyze_region(
    request: AnalyzeRegionRequest,
    background_tasks: BackgroundTasks,
):
    """
    Analyze a drawn region with satellite imagery.

    Supports:
    - PWTT damage assessment (before/after comparison)
    - NDVI vegetation analysis
    - Flood extent detection
    - Landslide susceptibility
    """
    region_id = str(uuid4())[:8]

    results = []

    for analysis_type in request.analysis_types:
        result_key = f"{region_id}_{analysis_type}"

        # Initialize pending result
        ANALYSIS_RESULTS[result_key] = RegionAnalysisResult(
            region_id=region_id,
            analysis_type=analysis_type,
            status="processing",
        )

        results.append({
            "analysis_type": analysis_type,
            "status": "processing",
            "result_id": result_key,
        })

        # Queue background analysis
        if analysis_type == "pwtt":
            background_tasks.add_task(
                run_pwtt_analysis,
                region_id,
                request.geometry,
                request.before_date,
                request.after_date,
            )
        elif analysis_type == "ndvi":
            background_tasks.add_task(
                run_ndvi_analysis,
                region_id,
                request.geometry,
            )

    return {
        "region_id": region_id,
        "area_km2": calculate_polygon_area(request.geometry.coordinates),
        "centroid": calculate_centroid(request.geometry.coordinates),
        "analyses": results,
    }


@router.get("/analyze-region/{result_id}")
async def get_analysis_result(result_id: str):
    """Get the result of a region analysis."""
    if result_id not in ANALYSIS_RESULTS:
        raise HTTPException(status_code=404, detail="Analysis result not found")

    return ANALYSIS_RESULTS[result_id]


@router.post("/save-region")
async def save_region(request: SaveRegionRequest):
    """Save a drawn region for future use."""
    region_id = str(uuid4())

    region = SavedRegion(
        id=region_id,
        name=request.name,
        description=request.description,
        geometry=request.geometry,
        tags=request.tags,
        area_km2=calculate_polygon_area(request.geometry.coordinates),
        centroid=calculate_centroid(request.geometry.coordinates),
        created_at=datetime.now(timezone.utc).isoformat(),
        created_by=None,  # Would come from auth
        is_public=request.is_public,
    )

    SAVED_REGIONS[region_id] = region

    return region


@router.get("/saved-regions")
async def list_saved_regions(
    tags: Optional[str] = Query(None, description="Comma-separated tags to filter by"),
    limit: int = Query(50, ge=1, le=200),
):
    """List saved regions."""
    regions = list(SAVED_REGIONS.values())

    if tags:
        tag_list = [t.strip().lower() for t in tags.split(",")]
        regions = [
            r for r in regions
            if any(t.lower() in [rt.lower() for rt in r.tags] for t in tag_list)
        ]

    # Sort by created_at descending
    regions.sort(key=lambda r: r.created_at, reverse=True)

    return regions[:limit]


@router.get("/saved-regions/{region_id}")
async def get_saved_region(region_id: str):
    """Get a saved region by ID."""
    if region_id not in SAVED_REGIONS:
        raise HTTPException(status_code=404, detail="Region not found")

    return SAVED_REGIONS[region_id]


@router.delete("/saved-regions/{region_id}")
async def delete_saved_region(region_id: str):
    """Delete a saved region."""
    if region_id not in SAVED_REGIONS:
        raise HTTPException(status_code=404, detail="Region not found")

    del SAVED_REGIONS[region_id]

    return {"status": "deleted", "region_id": region_id}


@router.post("/measurements/calculate")
async def calculate_measurement(request: MeasurementRequest):
    """
    Calculate measurements on the map.

    Supports:
    - distance: Total path length
    - area: Polygon area
    - elevation: Elevation profile along path (requires DEM integration)
    """
    if request.measurement_type == "distance":
        if len(request.coordinates) < 2:
            raise HTTPException(status_code=400, detail="Distance requires at least 2 points")

        distance = calculate_distance(request.coordinates)

        return MeasurementResult(
            measurement_type="distance",
            value=round(distance, 3),
            unit="km",
            points=request.coordinates,
            metadata={
                "segments": len(request.coordinates) - 1,
            },
        )

    elif request.measurement_type == "area":
        if len(request.coordinates) < 3:
            raise HTTPException(status_code=400, detail="Area requires at least 3 points")

        # Close the polygon if not already closed
        coords = request.coordinates
        if coords[0].lat != coords[-1].lat or coords[0].lng != coords[-1].lng:
            coords = coords + [coords[0]]

        area = calculate_polygon_area([[c for c in coords]])

        return MeasurementResult(
            measurement_type="area",
            value=round(area, 3),
            unit="km²",
            points=request.coordinates,
            metadata={
                "perimeter_km": round(calculate_distance(coords), 3),
                "vertices": len(request.coordinates),
            },
        )

    elif request.measurement_type == "elevation":
        # Would integrate with DEM service
        # For now, return mock elevation profile
        if len(request.coordinates) < 2:
            raise HTTPException(status_code=400, detail="Elevation profile requires at least 2 points")

        # Mock elevation values (would come from SRTM/ASTER DEM)
        import random
        elevations = [random.randint(500, 3000) for _ in request.coordinates]

        return MeasurementResult(
            measurement_type="elevation",
            value=max(elevations) - min(elevations),  # Elevation gain
            unit="m",
            points=request.coordinates,
            metadata={
                "min_elevation": min(elevations),
                "max_elevation": max(elevations),
                "elevation_profile": elevations,
                "total_distance_km": round(calculate_distance(request.coordinates), 3),
            },
        )

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown measurement type: {request.measurement_type}. Use: distance, area, elevation"
        )
