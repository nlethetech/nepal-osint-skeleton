"""Temporal Analysis API for time-based geospatial analysis."""
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db

router = APIRouter(prefix="/temporal", tags=["temporal"])


# ============================================================================
# Schemas
# ============================================================================


class BoundingBox(BaseModel):
    """Geographic bounding box."""
    north: float = Field(..., ge=-90, le=90)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    west: float = Field(..., ge=-180, le=180)


class TemporalFrameRequest(BaseModel):
    """Request to generate temporal animation frames."""
    bbox: BoundingBox
    layer_type: str = Field(..., description="sentinel2, ndvi, flood, events")
    start_date: str  # ISO date
    end_date: str  # ISO date
    interval: str = Field(default="day", description="hour, day, week, month")
    max_frames: int = Field(default=30, ge=1, le=100)


class TemporalFrame(BaseModel):
    """A single frame in temporal animation."""
    frame_index: int
    timestamp: str
    tile_url: str
    thumbnail_url: Optional[str] = None
    stats: Optional[dict] = None


class TemporalSequence(BaseModel):
    """Sequence of temporal frames for animation."""
    sequence_id: str
    layer_type: str
    bbox: BoundingBox
    start_date: str
    end_date: str
    interval: str
    frames: List[TemporalFrame]
    total_frames: int


class ComparisonRequest(BaseModel):
    """Request for before/after comparison."""
    bbox: BoundingBox
    layer_type: str = Field(..., description="sentinel2, ndvi, damage")
    before_date: str  # ISO date
    after_date: str  # ISO date
    comparison_type: str = Field(default="swipe", description="swipe, difference, overlay")


class ComparisonResult(BaseModel):
    """Result of before/after comparison."""
    comparison_id: str
    layer_type: str
    before_date: str
    after_date: str
    comparison_type: str
    before_tile_url: str
    after_tile_url: str
    difference_tile_url: Optional[str] = None
    stats: Optional[dict] = None


class EventBucket(BaseModel):
    """Events grouped by time bucket."""
    bucket_start: str
    bucket_end: str
    event_count: int
    severity_breakdown: dict
    category_breakdown: dict
    sample_events: List[dict]


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/generate-frames", response_model=TemporalSequence)
async def generate_temporal_frames(request: TemporalFrameRequest):
    """
    Generate tile URLs for temporal animation.

    Creates a sequence of frames between start and end dates that can be
    used for time-lapse visualization of satellite imagery or events.
    """
    sequence_id = str(uuid4())[:8]

    # Parse dates
    try:
        start = datetime.fromisoformat(request.start_date.replace('Z', '+00:00'))
        end = datetime.fromisoformat(request.end_date.replace('Z', '+00:00'))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    if start >= end:
        raise HTTPException(status_code=400, detail="Start date must be before end date")

    # Calculate interval delta
    interval_deltas = {
        "hour": timedelta(hours=1),
        "day": timedelta(days=1),
        "week": timedelta(weeks=1),
        "month": timedelta(days=30),  # Approximate
    }

    delta = interval_deltas.get(request.interval, timedelta(days=1))

    # Generate frames
    frames = []
    current = start
    frame_index = 0

    while current <= end and frame_index < request.max_frames:
        # Generate tile URL for this timestamp
        date_str = current.strftime("%Y-%m-%d")

        tile_url = (
            f"/api/v1/earth-engine/tiles/{request.layer_type}"
            f"?date={date_str}"
            f"&bbox={request.bbox.west},{request.bbox.south},{request.bbox.east},{request.bbox.north}"
            f"/{{z}}/{{x}}/{{y}}"
        )

        frames.append(TemporalFrame(
            frame_index=frame_index,
            timestamp=current.isoformat(),
            tile_url=tile_url,
            thumbnail_url=f"/api/v1/earth-engine/thumbnail/{request.layer_type}?date={date_str}",
        ))

        current += delta
        frame_index += 1

    return TemporalSequence(
        sequence_id=sequence_id,
        layer_type=request.layer_type,
        bbox=request.bbox,
        start_date=request.start_date,
        end_date=request.end_date,
        interval=request.interval,
        frames=frames,
        total_frames=len(frames),
    )


@router.get("/events")
async def get_temporal_events(
    start_date: str = Query(..., description="Start date (ISO format)"),
    end_date: str = Query(..., description="End date (ISO format)"),
    interval: str = Query("day", description="Bucket interval: hour, day, week"),
    category: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Get events bucketed by time for temporal visualization.

    Returns event counts and samples grouped by time intervals.
    """
    try:
        start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    # Calculate bucket size
    interval_deltas = {
        "hour": timedelta(hours=1),
        "day": timedelta(days=1),
        "week": timedelta(weeks=1),
    }
    delta = interval_deltas.get(interval, timedelta(days=1))

    # Generate mock bucketed data
    # In production, this would query the stories table grouped by time
    buckets = []
    current = start

    while current < end:
        bucket_end = current + delta

        # Mock data - would come from actual DB query
        import random
        event_count = random.randint(5, 50)

        buckets.append(EventBucket(
            bucket_start=current.isoformat(),
            bucket_end=bucket_end.isoformat(),
            event_count=event_count,
            severity_breakdown={
                "critical": random.randint(0, 5),
                "high": random.randint(2, 10),
                "medium": random.randint(5, 20),
                "low": random.randint(5, 15),
            },
            category_breakdown={
                "political": random.randint(5, 15),
                "social": random.randint(3, 12),
                "economic": random.randint(2, 8),
                "disaster": random.randint(1, 5),
            },
            sample_events=[],  # Would include actual event summaries
        ))

        current = bucket_end

    return {
        "start_date": start_date,
        "end_date": end_date,
        "interval": interval,
        "total_events": sum(b.event_count for b in buckets),
        "buckets": buckets,
    }


@router.post("/comparison/generate", response_model=ComparisonResult)
async def generate_comparison(request: ComparisonRequest):
    """
    Generate before/after comparison tiles.

    Creates tile URLs for comparing two dates, optionally with a
    difference layer showing changes.
    """
    comparison_id = str(uuid4())[:8]

    # Parse and validate dates
    try:
        before = datetime.fromisoformat(request.before_date.replace('Z', '+00:00'))
        after = datetime.fromisoformat(request.after_date.replace('Z', '+00:00'))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    if before >= after:
        raise HTTPException(status_code=400, detail="Before date must be before after date")

    bbox_str = f"{request.bbox.west},{request.bbox.south},{request.bbox.east},{request.bbox.north}"

    before_tile_url = (
        f"/api/v1/earth-engine/tiles/{request.layer_type}"
        f"?date={request.before_date}&bbox={bbox_str}/{{z}}/{{x}}/{{y}}"
    )

    after_tile_url = (
        f"/api/v1/earth-engine/tiles/{request.layer_type}"
        f"?date={request.after_date}&bbox={bbox_str}/{{z}}/{{x}}/{{y}}"
    )

    difference_tile_url = None
    if request.comparison_type in ["difference", "overlay"]:
        difference_tile_url = (
            f"/api/v1/earth-engine/tiles/{request.layer_type}-diff"
            f"?before={request.before_date}&after={request.after_date}"
            f"&bbox={bbox_str}/{{z}}/{{x}}/{{y}}"
        )

    # Mock statistics - would come from actual GEE analysis
    stats = {
        "before_mean": 0.45,
        "after_mean": 0.32,
        "change_percent": -28.9,
        "affected_area_km2": 15.3,
        "days_between": (after - before).days,
    }

    return ComparisonResult(
        comparison_id=comparison_id,
        layer_type=request.layer_type,
        before_date=request.before_date,
        after_date=request.after_date,
        comparison_type=request.comparison_type,
        before_tile_url=before_tile_url,
        after_tile_url=after_tile_url,
        difference_tile_url=difference_tile_url,
        stats=stats,
    )


@router.get("/available-dates")
async def get_available_dates(
    layer_type: str = Query(..., description="Layer type: sentinel2, landsat, ndvi"),
    bbox: Optional[str] = Query(None, description="Bounding box: west,south,east,north"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """
    Get available imagery dates for a given layer and region.

    Useful for showing which dates have cloud-free imagery.
    """
    # This would query the Earth Engine catalog
    # For now, return mock dates for the last 30 days

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30)

    if start_date:
        try:
            start = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except ValueError:
            pass

    if end_date:
        try:
            end = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except ValueError:
            pass

    # Generate mock available dates (every 5 days with some gaps)
    import random
    dates = []
    current = start

    while current <= end:
        # Simulate cloud cover causing some dates to be unavailable
        if random.random() > 0.3:
            dates.append({
                "date": current.strftime("%Y-%m-%d"),
                "cloud_cover": round(random.uniform(0, 30), 1),
                "quality": "good" if random.random() > 0.2 else "moderate",
            })
        current += timedelta(days=5)

    return {
        "layer_type": layer_type,
        "available_dates": dates,
        "total": len(dates),
    }
