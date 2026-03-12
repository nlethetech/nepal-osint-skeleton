"""Alerts API endpoints for dynamic alert generation."""
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.curfew_alert import get_province_for_district
from app.repositories.story import StoryRepository


router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertItem(BaseModel):
    """Individual alert item derived from high-severity stories."""
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    summary: Optional[str] = None
    url: str
    source_id: str
    source_name: Optional[str] = None
    category: Optional[str] = None
    severity: str
    districts: List[str] = []
    provinces: List[str] = []
    published_at: Optional[datetime] = None
    created_at: datetime


class DynamicAlertsResponse(BaseModel):
    """Response format for dynamic alerts endpoint."""
    items: List[AlertItem]
    total: int


def _parse_districts_param(districts_param: Optional[str]) -> List[str]:
    """
    Parse comma-separated districts parameter into a list.
    Returns empty list if None or empty.
    Normalizes to proper case for matching.
    """
    if not districts_param:
        return []
    return [d.strip().title() for d in districts_param.split(",") if d.strip()]


def _normalize_geo_token(value: str) -> str:
    """Normalize district/province tokens for resilient matching."""
    return value.strip().lower().replace("_", " ")


def _selected_provinces_from_districts(districts: List[str]) -> set[str]:
    """Derive selected provinces from selected districts."""
    provinces: set[str] = set()
    for district in districts:
        province = get_province_for_district(district)
        if province:
            provinces.add(_normalize_geo_token(province))
    return provinces


def _filter_stories_by_districts(
    stories: List,
    districts: List[str],
) -> List:
    """
    Filter stories by district names.
    Checks both the story.districts field and falls back to title matching.
    """
    if not districts:
        return stories

    districts_lower = {_normalize_geo_token(d) for d in districts}
    selected_provinces_lower = _selected_provinces_from_districts(districts)

    filtered = []
    for story in stories:
        # Check the districts field on the story
        if story.districts:
            story_districts_lower = {_normalize_geo_token(d) for d in story.districts}
            if story_districts_lower & districts_lower:
                filtered.append(story)
                continue

        # Province fallback: include stories tagged only at province level.
        if selected_provinces_lower and story.provinces:
            story_provinces_lower = {
                _normalize_geo_token(p)
                for p in story.provinces
                if isinstance(p, str) and p.strip()
            }
            if story_provinces_lower & selected_provinces_lower:
                filtered.append(story)
                continue

        # Fallback: check if district name appears in title
        title_lower = story.title.lower()
        if any(d in title_lower for d in districts_lower):
            filtered.append(story)
            continue

        # Final fallback: province mention in title.
        if selected_provinces_lower and any(p in title_lower for p in selected_provinces_lower):
            filtered.append(story)

    return filtered


def _story_to_alert(story) -> AlertItem:
    """Convert a Story model to an AlertItem."""
    return AlertItem(
        id=story.id,
        title=story.title,
        summary=story.summary,
        url=story.url,
        source_id=story.source_id,
        source_name=story.source_name,
        category=story.category,
        severity=story.severity or "medium",
        districts=story.districts or [],
        provinces=story.provinces or [],
        published_at=story.published_at,
        created_at=story.created_at,
    )


@router.get("/dynamic", response_model=DynamicAlertsResponse)
async def get_dynamic_alerts(
    hours: int = Query(24, ge=1, le=168, description="Time window in hours"),
    limit: int = Query(50, ge=1, le=200, description="Maximum alerts to return"),
    districts: Optional[str] = Query(None, description="Comma-separated district names to filter by"),
    severity: Optional[str] = Query(None, description="Minimum severity level (critical, high, medium, low)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Get dynamic alerts based on high-severity consolidated stories.

    Returns stories classified as alerts, filtered by severity and geographic area.
    Default behavior returns high and critical severity stories.

    Args:
        hours: Time window to look back for alerts
        limit: Maximum number of alerts to return
        districts: Comma-separated list of district names to filter by
        severity: Filter by specific severity level (critical, high, medium, low)

    Returns:
        DynamicAlertsResponse with items array and total count
    """
    repo = StoryRepository(db)

    # Parse districts parameter
    district_list = _parse_districts_param(districts)

    # Determine severity filter - default to high-severity alerts
    # If no severity specified, get critical and high
    severity_filter = severity
    if not severity_filter:
        # We'll fetch all and filter for critical/high
        severity_filter = None

    # Fetch more stories if filtering by district
    fetch_limit = limit * 3 if district_list or not severity else limit

    stories = await repo.get_recent(
        hours=hours,
        limit=fetch_limit,
        nepal_only=True,
        severity=severity_filter,
    )

    # If no specific severity was requested, filter for high-severity alerts
    if not severity:
        stories = [
            s for s in stories
            if s.severity in ("critical", "high")
        ]

    # Filter by districts if specified
    if district_list:
        stories = _filter_stories_by_districts(stories, district_list)

    # Apply limit
    stories = stories[:limit]

    # Convert to alert format
    alert_items = [_story_to_alert(story) for story in stories]

    return DynamicAlertsResponse(
        items=alert_items,
        total=len(alert_items),
    )


@router.get("", response_model=DynamicAlertsResponse)
async def get_alerts(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    severity: Optional[str] = Query(None),
    hours: int = Query(24, ge=1, le=168),
    districts: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Get alerts with pagination shape.
    Wraps the /dynamic endpoint for frontend compatibility.
    """
    # Reuse dynamic alerts logic
    result = await get_dynamic_alerts(
        hours=hours,
        limit=page_size,
        districts=districts,
        severity=severity,
        db=db,
    )
    return result


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    """Acknowledge a single alert (stub)."""
    return {"message": "ok", "id": alert_id}


@router.post("/acknowledge-all")
async def acknowledge_all_alerts():
    """Acknowledge all alerts (stub)."""
    return {"message": "ok", "count": 0}
