"""Damage Assessment API - Palantir-Grade Geospatial Analysis.

Provides endpoints for:
- Assessment CRUD (create, read, update, delete)
- PWTT damage detection (Sentinel-1 SAR analysis)
- Damage zones management
- Evidence provenance tracking
- Analyst notes/collaboration
- Export and reporting
"""

from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID
import math

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
import io

from app.api.deps import get_db, require_analyst, get_current_user
from app.models.user import User
from app.models.damage_assessment import (
    DamageType,
    SeverityLevel,
    AssessmentStatus,
    EvidenceSourceType,
)
from app.services.damage_assessment.assessment_service import AssessmentService
from app.services.damage_assessment.pwtt_service import PWTTService

router = APIRouter(prefix="/damage-assessment", tags=["Damage Assessment"])


# ═══════════════════════════════════════════════════════════════════════════════
# SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════

class CreateAssessmentRequest(BaseModel):
    """Request to create a new damage assessment."""
    event_name: str = Field(..., description="Human-readable event name")
    event_type: str = Field(..., description="Type: structural, infrastructure, environmental, civil_unrest, natural_disaster, fire, industrial")
    event_date: str = Field(..., description="Date of the damage event (ISO format string)")
    bbox: list[float] = Field(..., description="Bounding box [min_lng, min_lat, max_lng, max_lat]")
    event_description: Optional[str] = None
    districts: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    # Optional fields from frontend
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    baseline_start: Optional[str] = None
    baseline_end: Optional[str] = None
    post_event_start: Optional[str] = None
    post_event_end: Optional[str] = None


class UpdateAssessmentRequest(BaseModel):
    """Request to update an assessment."""
    event_name: Optional[str] = None
    event_description: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[list[str]] = None
    key_findings: Optional[list[str]] = None
    affected_population: Optional[int] = None
    displaced_estimate: Optional[int] = None
    buildings_affected: Optional[int] = None
    roads_damaged_km: Optional[float] = None
    bridges_affected: Optional[int] = None
    infrastructure_details: Optional[dict] = None


class RunPWTTRequest(BaseModel):
    """Request to run PWTT damage detection."""
    baseline_days: int = Field(30, ge=7, le=90, description="Days before event for baseline")
    post_event_days: int = Field(15, ge=1, le=60, description="Days after event to search")


class CreateZoneRequest(BaseModel):
    """Request to create a damage zone."""
    geometry: dict = Field(..., description="GeoJSON polygon geometry")
    centroid_lat: float
    centroid_lng: float
    area_km2: float
    severity: str = Field(..., description="critical, severe, moderate, minor, safe")
    damage_percentage: float = Field(..., ge=0, le=100)
    confidence: float = Field(0.5, ge=0, le=1)
    zone_name: Optional[str] = None
    zone_type: str = "area"
    land_use: Optional[str] = None
    building_type: Optional[str] = None


class AnalyzePolygonRequest(BaseModel):
    """Request to analyze a custom polygon."""
    geometry: dict = Field(..., description="GeoJSON polygon geometry")
    baseline_days: int = Field(30, ge=7, le=90)
    post_event_days: int = Field(15, ge=1, le=60)


class AddEvidenceRequest(BaseModel):
    """Request to add evidence."""
    source_type: str = Field(..., description="satellite, story, social_media, government, ground_report, photo, video")
    evidence_type: str = Field(..., description="image, video, text, report, analysis")
    zone_id: Optional[UUID] = None
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_name: Optional[str] = None
    title: Optional[str] = None
    excerpt: Optional[str] = None
    timestamp: Optional[datetime] = None
    confidence: float = Field(0.5, ge=0, le=1)
    metadata: Optional[dict] = None


class AddNoteRequest(BaseModel):
    """Request to add a note."""
    content: str
    note_type: str = Field("observation", description="observation, question, flag, insight, methodology")
    zone_id: Optional[UUID] = None


class AssessmentResponse(BaseModel):
    """Response for an assessment."""
    id: UUID
    event_name: str
    event_type: str
    event_date: datetime
    status: str
    bbox: list[float]
    center_lat: float
    center_lng: float
    districts: Optional[list[str]]
    total_area_km2: Optional[float]
    damaged_area_km2: Optional[float]
    damage_percentage: Optional[float]
    critical_area_km2: Optional[float]
    severe_area_km2: Optional[float]
    moderate_area_km2: Optional[float]
    minor_area_km2: Optional[float]
    confidence_score: Optional[float]
    affected_population: Optional[int]
    displaced_estimate: Optional[int]
    buildings_affected: Optional[int]
    roads_damaged_km: Optional[float]
    key_findings: Optional[list[str]]
    tags: Optional[list[str]]
    damage_tile_url: Optional[str]
    t_stat_tile_url: Optional[str]  # Raw t-statistic heatmap from PWTT
    before_tile_url: Optional[str]
    after_tile_url: Optional[str]
    before_sar_tile_url: Optional[str]
    after_sar_tile_url: Optional[str]
    baseline_images_count: Optional[int]
    post_images_count: Optional[int]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ZoneResponse(BaseModel):
    """Response for a damage zone."""
    id: UUID
    zone_name: Optional[str]
    zone_type: str
    geometry: Optional[dict] = None  # GeoJSON polygon geometry
    centroid_lat: float
    centroid_lng: float
    area_km2: float
    severity: str
    damage_percentage: float
    confidence: float
    land_use: Optional[str]
    building_type: Optional[str] = None
    satellite_detected: bool
    ground_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class EvidenceResponse(BaseModel):
    """Response for evidence."""
    id: UUID
    source_type: str
    evidence_type: str
    source_name: Optional[str]
    title: Optional[str]
    excerpt: Optional[str]
    source_url: Optional[str]
    timestamp: Optional[datetime]
    confidence: float
    verification_status: str
    auto_linked: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NoteResponse(BaseModel):
    """Response for a note."""
    id: UUID
    note_type: str
    content: str
    status: str
    author_id: UUID
    zone_id: Optional[UUID]
    created_at: datetime

    model_config = {"from_attributes": True}


class PWTTResultResponse(BaseModel):
    """Response for PWTT analysis."""
    analysis_id: str
    total_area_km2: float
    damaged_area_km2: float
    damage_percentage: float
    critical_area_km2: float
    severe_area_km2: float
    moderate_area_km2: float
    minor_area_km2: float
    confidence_score: float
    baseline_images_count: int
    post_images_count: int
    damage_tile_url: Optional[str]
    t_stat_tile_url: Optional[str]
    before_rgb_tile_url: Optional[str]
    after_rgb_tile_url: Optional[str]
    before_sar_tile_url: Optional[str]
    after_sar_tile_url: Optional[str]
    building_damage_geojson: Optional[list[dict]] = None
    error: Optional[str]


# ═══════════════════════════════════════════════════════════════════════════════
# ASSESSMENT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/assessments")
async def list_assessments(
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    status: Optional[str] = Query(None, description="Filter by status"),
    district: Optional[str] = Query(None, description="Filter by district"),
    start_date: Optional[str] = Query(None, description="Filter by start date (ISO format)"),
    end_date: Optional[str] = Query(None, description="Filter by end date (ISO format)"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """List all damage assessments with filtering."""
    service = AssessmentService(db)

    start_dt = datetime.fromisoformat(start_date) if start_date else None
    end_dt = datetime.fromisoformat(end_date) if end_date else None

    assessments, total = await service.list_assessments(
        event_type=event_type,
        status=status,
        district=district,
        start_date=start_dt,
        end_date=end_dt,
        limit=limit,
        offset=offset,
    )

    return {
        "items": [AssessmentResponse.model_validate(a) for a in assessments],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/assessments", status_code=201)
async def create_assessment(
    request: CreateAssessmentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Create a new damage assessment."""
    service = AssessmentService(db)

    # Parse event_date string to datetime
    try:
        event_date = datetime.fromisoformat(request.event_date.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        # Try parsing as date only
        event_date = datetime.strptime(request.event_date[:10], '%Y-%m-%d')

    # Use provided center or calculate from bbox
    center_lat = request.center_lat if request.center_lat else (request.bbox[1] + request.bbox[3]) / 2
    center_lng = request.center_lng if request.center_lng else (request.bbox[0] + request.bbox[2]) / 2

    # Parse optional date strings
    baseline_start = None
    baseline_end = None
    post_event_start = None
    post_event_end = None

    if request.baseline_start:
        try:
            baseline_start = datetime.fromisoformat(request.baseline_start.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            baseline_start = datetime.strptime(request.baseline_start[:10], '%Y-%m-%d')

    if request.baseline_end:
        try:
            baseline_end = datetime.fromisoformat(request.baseline_end.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            baseline_end = datetime.strptime(request.baseline_end[:10], '%Y-%m-%d')

    if request.post_event_start:
        try:
            post_event_start = datetime.fromisoformat(request.post_event_start.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            post_event_start = datetime.strptime(request.post_event_start[:10], '%Y-%m-%d')

    if request.post_event_end:
        try:
            post_event_end = datetime.fromisoformat(request.post_event_end.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            post_event_end = datetime.strptime(request.post_event_end[:10], '%Y-%m-%d')

    assessment = await service.create_assessment(
        event_name=request.event_name,
        event_type=request.event_type,
        event_date=event_date,
        bbox=request.bbox,
        center_lat=center_lat,
        center_lng=center_lng,
        created_by_id=user.id,
        event_description=request.event_description,
        districts=request.districts,
        tags=request.tags,
        baseline_start=baseline_start,
        baseline_end=baseline_end,
        post_event_start=post_event_start,
        post_event_end=post_event_end,
    )

    return AssessmentResponse.model_validate(assessment)


@router.get("/assessments/{assessment_id}")
async def get_assessment(
    assessment_id: UUID,
    include_zones: bool = Query(False, description="Include damage zones"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Get a single assessment by ID."""
    service = AssessmentService(db)
    assessment = await service.get_assessment(assessment_id, include_zones=include_zones)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    response = AssessmentResponse.model_validate(assessment)

    if include_zones:
        zones = await service.get_zones(assessment_id)
        return {
            **response.model_dump(),
            "zones": [ZoneResponse.model_validate(z) for z in zones],
        }

    return response


@router.put("/assessments/{assessment_id}")
async def update_assessment(
    assessment_id: UUID,
    request: UpdateAssessmentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Update an assessment."""
    service = AssessmentService(db)

    update_data = request.model_dump(exclude_none=True)
    assessment = await service.update_assessment(assessment_id, **update_data)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    return AssessmentResponse.model_validate(assessment)


@router.delete("/assessments/{assessment_id}", status_code=204)
async def delete_assessment(
    assessment_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Delete an assessment."""
    service = AssessmentService(db)
    success = await service.delete_assessment(assessment_id)

    if not success:
        raise HTTPException(status_code=404, detail="Assessment not found")


@router.post("/assessments/{assessment_id}/verify")
async def verify_assessment(
    assessment_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Mark an assessment as verified."""
    service = AssessmentService(db)
    assessment = await service.verify_assessment(assessment_id, user.id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    return AssessmentResponse.model_validate(assessment)


@router.get("/assessments/{assessment_id}/stats")
async def get_assessment_stats(
    assessment_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Get aggregated statistics for an assessment."""
    service = AssessmentService(db)
    stats = await service.get_assessment_stats(assessment_id)

    if not stats:
        raise HTTPException(status_code=404, detail="Assessment not found")

    return stats


# ═══════════════════════════════════════════════════════════════════════════════
# PWTT ANALYSIS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/assessments/{assessment_id}/run-pwtt")
async def run_pwtt_analysis(
    assessment_id: UUID,
    request: RunPWTTRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
) -> PWTTResultResponse:
    """
    Run PWTT (Pixel-Wise T-Test) damage detection.

    This uses Sentinel-1 SAR imagery to detect structural damage:
    - Collects pre-event backscatter as baseline
    - Compares with post-event backscatter
    - Significant decrease indicates damage

    The analysis may take 30-60 seconds depending on area size.
    """
    # Get assessment
    service = AssessmentService(db)
    assessment = await service.get_assessment(assessment_id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Run PWTT analysis
    pwtt_service = PWTTService()
    result = await pwtt_service.detect_damage(
        bbox=assessment.bbox,
        event_date=assessment.event_date.isoformat(),
        baseline_days=request.baseline_days,
        post_event_days=request.post_event_days,
    )

    # Update assessment with results if successful
    if not result.error:
        await service.update_assessment_results(
            assessment_id=assessment_id,
            total_area_km2=result.total_area_km2,
            damaged_area_km2=result.damaged_area_km2,
            damage_percentage=result.damage_percentage,
            critical_area_km2=result.critical_area_km2,
            severe_area_km2=result.severe_area_km2,
            moderate_area_km2=result.moderate_area_km2,
            minor_area_km2=result.minor_area_km2,
            confidence_score=result.confidence_score,
            baseline_images_count=result.baseline_images_count,
            post_images_count=result.post_images_count,
            damage_tile_url=result.damage_tile_url,
            before_tile_url=result.before_rgb_tile_url,
            after_tile_url=result.after_rgb_tile_url,
            before_sar_tile_url=result.before_sar_tile_url,
            after_sar_tile_url=result.after_sar_tile_url,
            t_stat_tile_url=result.t_stat_tile_url,
            baseline_start=assessment.event_date - timedelta(days=request.baseline_days),
            baseline_end=assessment.event_date - timedelta(days=1),
            post_event_start=assessment.event_date,
            post_event_end=assessment.event_date + timedelta(days=request.post_event_days),
        )

    return PWTTResultResponse(
        analysis_id=result.analysis_id,
        total_area_km2=result.total_area_km2,
        damaged_area_km2=result.damaged_area_km2,
        damage_percentage=result.damage_percentage,
        critical_area_km2=result.critical_area_km2,
        severe_area_km2=result.severe_area_km2,
        moderate_area_km2=result.moderate_area_km2,
        minor_area_km2=result.minor_area_km2,
        confidence_score=result.confidence_score,
        baseline_images_count=result.baseline_images_count,
        post_images_count=result.post_images_count,
        damage_tile_url=result.damage_tile_url,
        t_stat_tile_url=result.t_stat_tile_url,
        before_rgb_tile_url=result.before_rgb_tile_url,
        after_rgb_tile_url=result.after_rgb_tile_url,
        before_sar_tile_url=result.before_sar_tile_url,
        after_sar_tile_url=result.after_sar_tile_url,
        building_damage_geojson=result.building_damage_geojson or None,
        error=result.error,
    )


@router.post("/assessments/{assessment_id}/analyze-polygon")
async def analyze_polygon(
    assessment_id: UUID,
    request: AnalyzePolygonRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
) -> PWTTResultResponse:
    """
    Analyze damage within a user-drawn polygon.

    Returns damage statistics for the specific area without
    updating the overall assessment.
    """
    service = AssessmentService(db)
    assessment = await service.get_assessment(assessment_id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    pwtt_service = PWTTService()
    result = await pwtt_service.analyze_polygon(
        geometry_geojson=request.geometry,
        event_date=assessment.event_date.isoformat(),
        baseline_days=request.baseline_days,
        post_event_days=request.post_event_days,
    )

    return PWTTResultResponse(
        analysis_id=result.analysis_id,
        total_area_km2=result.total_area_km2,
        damaged_area_km2=result.damaged_area_km2,
        damage_percentage=result.damage_percentage,
        critical_area_km2=result.critical_area_km2,
        severe_area_km2=result.severe_area_km2,
        moderate_area_km2=result.moderate_area_km2,
        minor_area_km2=result.minor_area_km2,
        confidence_score=result.confidence_score,
        baseline_images_count=result.baseline_images_count,
        post_images_count=result.post_images_count,
        damage_tile_url=None,
        t_stat_tile_url=None,
        before_rgb_tile_url=None,
        after_rgb_tile_url=None,
        before_sar_tile_url=None,
        after_sar_tile_url=None,
        error=result.error,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# QUICK HOTSPOT CHECKER - Draw circle on map and analyze
# ═══════════════════════════════════════════════════════════════════════════════

class QuickAnalyzeRequest(BaseModel):
    """Request for quick hotspot analysis (draw circle on map)."""
    center_lat: float = Field(..., description="Center latitude of circle")
    center_lng: float = Field(..., description="Center longitude of circle")
    radius_km: float = Field(0.5, ge=0.1, le=5.0, description="Radius in kilometers")
    event_date: str = Field(..., description="Event date (ISO format)")
    baseline_days: int = Field(365, ge=30, le=365, description="Days before event for baseline")
    post_event_days: int = Field(60, ge=7, le=120, description="Days after event to search")


class QuickAnalyzeResponse(BaseModel):
    """Response for quick hotspot analysis."""
    center_lat: float
    center_lng: float
    radius_km: float
    event_date: str
    total_area_km2: float
    damaged_area_km2: float
    damage_percentage: float
    critical_area_km2: float
    severe_area_km2: float
    moderate_area_km2: float
    minor_area_km2: float
    confidence_score: float
    baseline_images_count: int
    post_images_count: int
    damage_tile_url: Optional[str] = None
    t_stat_tile_url: Optional[str] = None
    before_tile_url: Optional[str] = None
    after_tile_url: Optional[str] = None
    before_sar_tile_url: Optional[str] = None
    after_sar_tile_url: Optional[str] = None
    building_damage_geojson: Optional[list[dict]] = None
    error: Optional[str] = None
    # Computed bbox for frontend
    bbox: list[float]


@router.post("/quick-analyze", response_model=QuickAnalyzeResponse)
async def quick_analyze_hotspot(
    request: QuickAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Quick Hotspot Checker - Analyze damage at any point on the map.

    Draw a circle on the map, set a date, and get instant damage analysis.
    This does NOT create a persistent assessment - it's for quick exploration.

    Usage:
    1. Click anywhere on the map to set center point
    2. Adjust radius (0.1 - 5.0 km)
    3. Set event date
    4. Get instant PWTT damage analysis

    Returns damage statistics and optional tile URLs for visualization.
    """
    import math

    # Convert circle to bounding box
    # Approximate: 1 degree latitude ≈ 111 km
    # 1 degree longitude ≈ 111 km × cos(latitude)
    lat_offset = request.radius_km / 111.0
    lng_offset = request.radius_km / (111.0 * math.cos(math.radians(request.center_lat)))

    bbox = [
        request.center_lng - lng_offset,  # min_lng
        request.center_lat - lat_offset,   # min_lat
        request.center_lng + lng_offset,   # max_lng
        request.center_lat + lat_offset,   # max_lat
    ]

    # Run PWTT analysis
    pwtt_service = PWTTService()
    result = await pwtt_service.detect_damage(
        bbox=bbox,
        event_date=request.event_date,
        baseline_days=request.baseline_days,
        post_event_days=request.post_event_days,
    )

    return QuickAnalyzeResponse(
        center_lat=request.center_lat,
        center_lng=request.center_lng,
        radius_km=request.radius_km,
        event_date=request.event_date,
        total_area_km2=result.total_area_km2,
        damaged_area_km2=result.damaged_area_km2,
        damage_percentage=result.damage_percentage,
        critical_area_km2=result.critical_area_km2,
        severe_area_km2=result.severe_area_km2,
        moderate_area_km2=result.moderate_area_km2,
        minor_area_km2=result.minor_area_km2,
        confidence_score=result.confidence_score,
        baseline_images_count=result.baseline_images_count,
        post_images_count=result.post_images_count,
        damage_tile_url=result.damage_tile_url,
        t_stat_tile_url=result.t_stat_tile_url,
        before_tile_url=result.before_rgb_tile_url,
        after_tile_url=result.after_rgb_tile_url,
        before_sar_tile_url=result.before_sar_tile_url,
        after_sar_tile_url=result.after_sar_tile_url,
        building_damage_geojson=result.building_damage_geojson or None,
        error=result.error,
        bbox=bbox,
    )


@router.get("/quick-analyze/three-panel-test")
async def get_three_panel_image_test() -> StreamingResponse:
    """
    TEST endpoint - generates three-panel for Singha Durbar with no auth required.
    Uses exact same parameters as the working script.
    """
    bbox = [85.3175, 27.6925, 85.3275, 27.7025]  # Singha Durbar
    event_date = "2025-09-08"
    baseline_days = 365
    post_event_days = 60

    pwtt_service = PWTTService()
    try:
        image_bytes = await pwtt_service.generate_three_panel_image(
            bbox=bbox,
            event_date=event_date,
            baseline_days=baseline_days,
            post_event_days=post_event_days,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")

    return StreamingResponse(
        io.BytesIO(image_bytes),
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="test-three-panel.png"'}
    )


@router.get("/quick-analyze/three-panel")
async def get_three_panel_image(
    center_lat: float = Query(..., description="Center latitude"),
    center_lng: float = Query(..., description="Center longitude"),
    radius_km: float = Query(0.5, ge=0.1, le=5.0, description="Radius in kilometers"),
    event_date: str = Query(..., description="Event date (ISO format)"),
    baseline_days: int = Query(365, ge=30, le=365, description="Days before event for baseline"),
    post_event_days: int = Query(60, ge=7, le=120, description="Days after event to search"),
    user: User = Depends(require_analyst),
) -> StreamingResponse:
    """
    Generate 3-panel PNG: Pre Destruction | Post Destruction | PWTT

    Returns a static PNG image for display/download showing:
    - Left panel: Pre-destruction satellite imagery (Sentinel-2 RGB)
    - Center panel: Post-destruction satellite imagery (Sentinel-2 RGB)
    - Right panel: PWTT damage heatmap (t-statistic visualization)

    The image is generated server-side using matplotlib and can be
    embedded in reports or downloaded directly.

    Max area: ~78 km² (radius 5 km). Larger areas may timeout.
    """
    # Validate area - max ~78 km² (circle with 5km radius)
    area_km2 = math.pi * (radius_km ** 2)
    if area_km2 > 80:
        raise HTTPException(
            status_code=400,
            detail=f"Area too large ({area_km2:.1f} km²). Max radius: 5 km (~78 km²)"
        )

    # Convert circle to bounding box
    lat_offset = radius_km / 111.0
    lng_offset = radius_km / (111.0 * math.cos(math.radians(center_lat)))

    bbox = [
        center_lng - lng_offset,  # min_lng
        center_lat - lat_offset,   # min_lat
        center_lng + lng_offset,   # max_lng
        center_lat + lat_offset,   # max_lat
    ]

    # Generate the 3-panel image
    pwtt_service = PWTTService()

    try:
        image_bytes = await pwtt_service.generate_three_panel_image(
            bbox=bbox,
            event_date=event_date,
            baseline_days=baseline_days,
            post_event_days=post_event_days,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate three-panel image: {str(e)}"
        )

    # Return as PNG stream
    return StreamingResponse(
        io.BytesIO(image_bytes),
        media_type="image/png",
        headers={
            "Content-Disposition": f'inline; filename="pwtt-three-panel-{event_date}.png"',
            "Cache-Control": "max-age=3600",  # Cache for 1 hour
        }
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ZONE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/assessments/{assessment_id}/zones")
async def list_zones(
    assessment_id: UUID,
    severity: Optional[str] = Query(None, description="Filter by severity"),
    zone_type: Optional[str] = Query(None, description="Filter by zone type"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """List damage zones for an assessment."""
    service = AssessmentService(db)
    zones = await service.get_zones(
        assessment_id=assessment_id,
        severity=severity,
        zone_type=zone_type,
    )
    return [ZoneResponse.model_validate(z) for z in zones]


@router.post("/assessments/{assessment_id}/zones", status_code=201)
async def create_zone(
    assessment_id: UUID,
    request: CreateZoneRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Create a manual damage zone."""
    service = AssessmentService(db)

    # Verify assessment exists
    assessment = await service.get_assessment(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    zone = await service.create_zone(
        assessment_id=assessment_id,
        geometry=request.geometry,
        centroid_lat=request.centroid_lat,
        centroid_lng=request.centroid_lng,
        area_km2=request.area_km2,
        severity=request.severity,
        damage_percentage=request.damage_percentage,
        confidence=request.confidence,
        zone_name=request.zone_name,
        zone_type=request.zone_type,
        land_use=request.land_use,
        building_type=request.building_type,
        satellite_detected=False,  # Manual zone
    )

    return ZoneResponse.model_validate(zone)


@router.put("/assessments/{assessment_id}/zones/{zone_id}/verify")
async def verify_zone(
    assessment_id: UUID,
    zone_id: UUID,
    verification_notes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Mark a zone as ground-verified."""
    service = AssessmentService(db)
    zone = await service.update_zone(
        zone_id=zone_id,
        ground_verified=True,
        verification_notes=verification_notes,
    )

    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    return ZoneResponse.model_validate(zone)


@router.post("/assessments/{assessment_id}/detect-buildings")
async def detect_buildings(
    assessment_id: UUID,
    max_buildings: int = Query(50, ge=10, le=200, description="Max buildings to detect"),
    min_area_m2: float = Query(100, ge=50, le=1000, description="Min building area in m²"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Automatically detect buildings and classify damage using GEE zonal statistics.

    Production-grade building detection:
    1. Fetches buildings from Google Open Buildings (ML-derived, excellent Nepal coverage)
    2. Falls back to OpenStreetMap if needed
    3. Computes per-building t-statistics using GEE zonal analysis
    4. Classifies damage based on actual SAR pixel values within each building

    Algorithm:
    - For each building polygon, computes mean t-statistic from PWTT raster
    - t < -3.0: Critical (>99% confidence)
    - t < -2.0: Severe (95-99% confidence)
    - t < -1.5: Moderate (87-95% confidence)
    - t < -1.0: Minor (68-87% confidence)

    Note: Requires PWTT analysis to be run first.
    """
    from app.services.damage_assessment.building_detection import BuildingDetectionService

    service = AssessmentService(db)
    assessment = await service.get_assessment(assessment_id)

    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Require PWTT analysis to be run first
    if not assessment.damage_percentage:
        raise HTTPException(
            status_code=400,
            detail="Run PWTT analysis first before detecting buildings"
        )

    # Get existing zones to avoid duplicates
    existing_zones = await service.get_zones(assessment_id)
    if existing_zones:
        # Clear existing zones if re-detecting
        from sqlalchemy import delete
        from app.models.damage_assessment import DamageZone
        await db.execute(delete(DamageZone).where(DamageZone.assessment_id == assessment_id))
        await db.commit()

    # Prepare damage stats from assessment
    damage_stats = {
        "damage_percentage": assessment.damage_percentage,
        "confidence_score": assessment.confidence_score,
        "critical_area_km2": assessment.critical_area_km2,
        "severe_area_km2": assessment.severe_area_km2,
        "moderate_area_km2": assessment.moderate_area_km2,
        "minor_area_km2": assessment.minor_area_km2,
    }

    # Detect buildings with GEE zonal statistics
    building_service = BuildingDetectionService(db)
    zones = await building_service.detect_and_create_zones(
        assessment_id=assessment_id,
        bbox=assessment.bbox,
        event_date=assessment.event_date.isoformat(),
        damage_stats=damage_stats,
        max_buildings=max_buildings,
        min_area_m2=min_area_m2,
        use_gee_zonal_stats=True,  # Use actual GEE per-building analysis
    )

    # Update assessment buildings_affected count
    assessment.buildings_affected = len(zones)
    await db.commit()

    return {
        "message": f"Detected {len(zones)} buildings with damage",
        "buildings_detected": len(zones),
        "severity_breakdown": {
            "critical": len([z for z in zones if z.severity == "critical"]),
            "severe": len([z for z in zones if z.severity == "severe"]),
            "moderate": len([z for z in zones if z.severity == "moderate"]),
            "minor": len([z for z in zones if z.severity == "minor"]),
        },
        "zones": [ZoneResponse.model_validate(z) for z in zones],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# EVIDENCE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/assessments/{assessment_id}/evidence")
async def list_evidence(
    assessment_id: UUID,
    source_type: Optional[str] = Query(None, description="Filter by source type"),
    zone_id: Optional[UUID] = Query(None, description="Filter by zone"),
    verification_status: Optional[str] = Query(None, description="Filter by verification status"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """List evidence for an assessment."""
    service = AssessmentService(db)
    evidence = await service.get_evidence(
        assessment_id=assessment_id,
        source_type=source_type,
        zone_id=zone_id,
        verification_status=verification_status,
    )
    return [EvidenceResponse.model_validate(e) for e in evidence]


@router.post("/assessments/{assessment_id}/evidence", status_code=201)
async def add_evidence(
    assessment_id: UUID,
    request: AddEvidenceRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Add evidence to an assessment."""
    service = AssessmentService(db)

    # Verify assessment exists
    assessment = await service.get_assessment(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    evidence = await service.add_evidence(
        assessment_id=assessment_id,
        source_type=request.source_type,
        evidence_type=request.evidence_type,
        zone_id=request.zone_id,
        source_id=request.source_id,
        source_url=request.source_url,
        source_name=request.source_name,
        title=request.title,
        excerpt=request.excerpt,
        timestamp=request.timestamp,
        confidence=request.confidence,
        added_by_id=user.id,
        metadata=request.metadata,
    )

    return EvidenceResponse.model_validate(evidence)


@router.put("/assessments/{assessment_id}/evidence/{evidence_id}/verify")
async def verify_evidence(
    assessment_id: UUID,
    evidence_id: UUID,
    status: str = Query(..., description="verified, disputed, retracted"),
    notes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Update evidence verification status."""
    service = AssessmentService(db)
    evidence = await service.update_evidence_verification(
        evidence_id=evidence_id,
        verification_status=status,
        verification_notes=notes,
    )

    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    return EvidenceResponse.model_validate(evidence)


# ═══════════════════════════════════════════════════════════════════════════════
# NOTES ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/assessments/{assessment_id}/notes")
async def list_notes(
    assessment_id: UUID,
    note_type: Optional[str] = Query(None, description="Filter by note type"),
    status: Optional[str] = Query(None, description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """List notes for an assessment."""
    service = AssessmentService(db)
    notes = await service.get_notes(
        assessment_id=assessment_id,
        note_type=note_type,
        status=status,
    )
    return [NoteResponse.model_validate(n) for n in notes]


@router.post("/assessments/{assessment_id}/notes", status_code=201)
async def add_note(
    assessment_id: UUID,
    request: AddNoteRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Add a note to an assessment."""
    service = AssessmentService(db)

    # Verify assessment exists
    assessment = await service.get_assessment(assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    note = await service.add_note(
        assessment_id=assessment_id,
        content=request.content,
        author_id=user.id,
        note_type=request.note_type,
        zone_id=request.zone_id,
    )

    return NoteResponse.model_validate(note)


@router.put("/assessments/{assessment_id}/notes/{note_id}/resolve")
async def resolve_note(
    assessment_id: UUID,
    note_id: UUID,
    resolution_notes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Mark a note as resolved."""
    service = AssessmentService(db)
    note = await service.resolve_note(
        note_id=note_id,
        resolved_by_id=user.id,
        resolution_notes=resolution_notes,
    )

    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    return NoteResponse.model_validate(note)


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS / METADATA ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/meta/damage-types")
async def get_damage_types():
    """Get available damage types."""
    return [{"value": t.value, "label": t.value.replace("_", " ").title()} for t in DamageType]


@router.get("/meta/severity-levels")
async def get_severity_levels():
    """Get available severity levels."""
    return [
        {"value": SeverityLevel.CRITICAL.value, "label": "Critical", "color": "#d73027", "description": ">70% damage"},
        {"value": SeverityLevel.SEVERE.value, "label": "Severe", "color": "#fc8d59", "description": "40-70% damage"},
        {"value": SeverityLevel.MODERATE.value, "label": "Moderate", "color": "#fee08b", "description": "20-40% damage"},
        {"value": SeverityLevel.MINOR.value, "label": "Minor", "color": "#91cf60", "description": "<20% damage"},
        {"value": SeverityLevel.SAFE.value, "label": "Safe", "color": "#1a9850", "description": "No damage"},
    ]


@router.get("/meta/assessment-statuses")
async def get_assessment_statuses():
    """Get available assessment statuses."""
    return [{"value": s.value, "label": s.value.replace("_", " ").title()} for s in AssessmentStatus]


@router.get("/meta/evidence-sources")
async def get_evidence_sources():
    """Get available evidence source types."""
    return [{"value": s.value, "label": s.value.replace("_", " ").title()} for s in EvidenceSourceType]
