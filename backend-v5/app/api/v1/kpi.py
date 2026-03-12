"""KPI API endpoints for Palantir-grade dashboard metrics."""
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_dev
from app.core.redis import get_redis
from app.services.kpi_service import KPIService
from app.services.kpi_cache import KPICacheService, KPICacheManager
from app.schemas.kpi import (
    KPISnapshot,
    AlertDetail,
    HourlyTrend,
)


def _parse_districts_param(districts_param: Optional[str]) -> List[str]:
    """
    Parse comma-separated districts parameter into a list.

    Returns empty list if None or empty string.
    """
    if not districts_param:
        return []
    return [d.strip().title() for d in districts_param.split(",") if d.strip()]

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/kpi", tags=["KPI"])


@router.get("/snapshot", response_model=KPISnapshot)
async def get_kpi_snapshot(
    hours: int = Query(
        24,
        ge=1,
        le=168,
        description="Time window in hours (1-168)",
    ),
    districts: Optional[str] = Query(
        None,
        description="Comma-separated district names to filter by",
    ),
    force_refresh: bool = Query(
        False,
        description="Bypass cache and compute fresh",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get complete KPI snapshot.

    Returns all primary and secondary KPIs with:
    - Traceability metadata (timestamp, freshness)
    - Confidence scores based on data volume
    - Trend indicators (INCREASING, STABLE, DECREASING)
    - Anomaly detection flags

    **Primary KPIs:**
    - `active_alerts`: CRITICAL/HIGH events in last 6 hours
    - `events_today`: Deduplicated event count
    - `threat_level`: Composite risk assessment (0-100)
    - `districts_affected`: Geographic spread
    - `source_coverage`: Data pipeline health
    - `trend_velocity`: Hour-over-hour change rate

    **Secondary KPIs:**
    - `critical_events`: CRITICAL severity count only
    - `casualties_24h`: Deaths, injuries from disasters
    - `economic_impact_npr`: Sum of disaster losses
    - `top_entities`: Mentioned entities (future)

    **Filtering:**
    - Use `districts` parameter to filter KPIs by geographic region
    - Pass comma-separated district names (e.g., "Kathmandu,Lalitpur,Bhaktapur")

    **Caching:**
    - Results cached for 30 seconds
    - Use `force_refresh=true` to bypass cache
    """
    # Parse districts parameter
    district_list = _parse_districts_param(districts)

    try:
        redis_client = await get_redis()
        cache_service = KPICacheService(redis_client)
        kpi_service = KPIService(db)
        cache_manager = KPICacheManager(cache_service, kpi_service)

        if force_refresh:
            return await cache_manager.force_refresh(hours, district_list)

        return await cache_manager.get_or_compute(hours, district_list)
    except Exception as e:
        # Fallback to direct computation if Redis fails
        logger.warning(f"Cache error, computing directly: {e}")
        kpi_service = KPIService(db)
        return await kpi_service.compute_all_kpis(hours, district_list)


@router.get("/alerts/detail", response_model=list[AlertDetail])
async def get_alert_details(
    severity: str = Query(
        "critical,high",
        description="Comma-separated severity filter",
    ),
    hours: int = Query(
        6,
        ge=1,
        le=24,
        description="Time window in hours",
    ),
    districts: Optional[str] = Query(
        None,
        description="Comma-separated district names to filter by",
    ),
    limit: int = Query(
        20,
        ge=1,
        le=100,
        description="Max alerts to return",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed alert list for drill-down view.

    Returns alerts matching severity filter with full details:
    - Story alerts: title, category, severity, source, URL, summary
    - Disaster alerts: title, district, deaths, injured, economic loss

    **Use Cases:**
    - Click on "Active Alerts" KPI to see full list
    - Filter by severity for prioritization
    - Get context for situational awareness

    **Filtering:**
    - Use `districts` parameter to filter alerts by geographic region

    **Example:**
    ```
    GET /api/v1/kpi/alerts/detail?severity=critical&limit=10&districts=Kathmandu,Lalitpur
    ```
    """
    district_list = _parse_districts_param(districts)
    kpi_service = KPIService(db)
    return await kpi_service.get_alert_details(severity, limit, hours, district_list)


@router.get("/trends/hourly", response_model=list[HourlyTrend])
async def get_hourly_trends(
    hours: int = Query(
        24,
        ge=1,
        le=168,
        description="Time window in hours",
    ),
    districts: Optional[str] = Query(
        None,
        description="Comma-separated district names to filter by",
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Get hour-by-hour event breakdown for sparkline visualization.

    Returns list of hourly counts with category breakdown:
    - `hour`: ISO timestamp for the hour
    - `count`: Total events in that hour
    - `category_breakdown`: Events by category (disaster, security, etc.)

    **Use Cases:**
    - Render sparkline in KPI cards
    - Identify hourly patterns
    - Detect unusual activity spikes

    **Filtering:**
    - Use `districts` parameter to filter trends by geographic region

    **Example Response:**
    ```json
    [
      {
        "hour": "2026-01-28T10:00:00Z",
        "count": 15,
        "category_breakdown": {"disaster": 5, "security": 8, "political": 2}
      }
    ]
    ```
    """
    district_list = _parse_districts_param(districts)
    kpi_service = KPIService(db)
    return await kpi_service.get_hourly_trends(hours, district_list)


@router.get("/cache/status")
async def get_cache_status(
    _=Depends(require_dev),
):
    """
    Get KPI cache status (for debugging).

    Returns information about cached KPI snapshots:
    - Keys currently cached
    - TTL remaining for each

    **Note:** This endpoint is for debugging/monitoring only.
    """
    try:
        redis_client = await get_redis()
        cache_service = KPICacheService(redis_client)
        return {
            "status": "healthy",
            "caches": await cache_service.get_cache_status(),
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "caches": {},
        }


@router.post("/cache/invalidate")
async def invalidate_cache(
    hours: Optional[int] = Query(
        None,
        description="Specific time window to invalidate, or all if None",
    ),
    _=Depends(require_dev),
):
    """
    Invalidate KPI cache.

    Use this when you know data has changed and want fresh computation.
    If `hours` is not specified, invalidates all KPI caches.

    **Note:** This endpoint is for debugging/administrative use only.
    In production, cache invalidation happens automatically when new data arrives.
    """
    try:
        redis_client = await get_redis()
        cache_service = KPICacheService(redis_client)
        deleted = await cache_service.invalidate(hours)
        return {
            "status": "success",
            "keys_deleted": deleted,
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
        }
