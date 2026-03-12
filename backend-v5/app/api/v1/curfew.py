"""Curfew alerts API endpoints."""
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_dev
from app.core.database import get_db
from app.repositories.curfew import CurfewRepository
from app.services.curfew_detection_service import CurfewDetectionService

router = APIRouter(prefix="/curfew", tags=["Curfew Alerts"])


# ============ Response Schemas ============

class CurfewAlertResponse(BaseModel):
    """Curfew alert response."""
    id: str
    district: str
    province: Optional[str]
    title: str
    source: str
    source_name: Optional[str]
    matched_keywords: List[str]
    detected_at: str
    expires_at: str
    is_active: bool
    is_confirmed: bool
    severity: str
    hours_remaining: float


class ActiveCurfewsResponse(BaseModel):
    """Response for active curfews endpoint."""
    alerts: List[CurfewAlertResponse]
    districts: List[str]
    count: int


class CurfewStatsResponse(BaseModel):
    """Curfew statistics response."""
    active: int
    total: int
    by_province: dict
    by_severity: dict


class CurfewMapData(BaseModel):
    """Map data for curfew highlighting."""
    districts: List[str]
    alerts: List[dict]


# ============ Endpoints ============

@router.get("/active", response_model=ActiveCurfewsResponse)
async def get_active_curfews(
    db: AsyncSession = Depends(get_db),
):
    """
    Get all active curfew alerts.

    Returns districts with active curfews for map highlighting
    and detailed alert information.
    """
    service = CurfewDetectionService(db)

    # First expire old alerts
    await service.expire_old_alerts()

    # Get active alerts
    alerts = await service.get_active_alerts()

    return ActiveCurfewsResponse(
        alerts=[
            CurfewAlertResponse(
                id=str(a.id),
                district=a.district,
                province=a.province,
                title=a.title,
                source=a.source,
                source_name=a.source_name,
                matched_keywords=a.matched_keywords or [],
                detected_at=a.detected_at.isoformat() if a.detected_at else "",
                expires_at=a.expires_at.isoformat() if a.expires_at else "",
                is_active=a.is_active,
                is_confirmed=a.is_confirmed,
                severity=a.severity,
                hours_remaining=a.hours_remaining,
            )
            for a in alerts
        ],
        districts=[a.district for a in alerts],
        count=len(alerts),
    )


@router.get("/map-data", response_model=CurfewMapData)
async def get_curfew_map_data(
    db: AsyncSession = Depends(get_db),
):
    """
    Get curfew data optimized for map visualization.

    Returns list of district names with active curfews
    for polygon highlighting.
    """
    service = CurfewDetectionService(db)

    # Expire old alerts
    await service.expire_old_alerts()

    # Get active alerts
    alerts = await service.get_active_alerts()

    return CurfewMapData(
        districts=[a.district for a in alerts],
        alerts=[
            {
                "district": a.district,
                "severity": a.severity,
                "hours_remaining": a.hours_remaining,
                "title": a.title[:100],  # Truncate for map tooltip
            }
            for a in alerts
        ],
    )


@router.get("/stats", response_model=CurfewStatsResponse)
async def get_curfew_stats(
    db: AsyncSession = Depends(get_db),
):
    """
    Get curfew alert statistics.

    Returns counts of active alerts by province and severity.
    """
    repo = CurfewRepository(db)

    # Expire old alerts first
    await repo.expire_alerts()

    stats = await repo.get_stats()

    return CurfewStatsResponse(
        active=stats["active"],
        total=stats["total"],
        by_province=stats["by_province"],
        by_severity=stats["by_severity"],
    )


@router.get("/district/{district}")
async def get_curfew_by_district(
    district: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get active curfew alert for a specific district.

    Returns 404 if no active curfew in that district.
    """
    repo = CurfewRepository(db)

    alert = await repo.get_active_by_district(district)

    if not alert:
        raise HTTPException(
            status_code=404,
            detail=f"No active curfew in {district}"
        )

    return CurfewAlertResponse(
        id=str(alert.id),
        district=alert.district,
        province=alert.province,
        title=alert.title,
        source=alert.source,
        source_name=alert.source_name,
        matched_keywords=alert.matched_keywords or [],
        detected_at=alert.detected_at.isoformat() if alert.detected_at else "",
        expires_at=alert.expires_at.isoformat() if alert.expires_at else "",
        is_active=alert.is_active,
        is_confirmed=alert.is_confirmed,
        severity=alert.severity,
        hours_remaining=alert.hours_remaining,
    )


@router.get("/province/{province}")
async def get_curfews_by_province(
    province: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Get all active curfew alerts for a province.
    """
    repo = CurfewRepository(db)

    alerts = await repo.get_by_province(province)

    return {
        "province": province,
        "count": len(alerts),
        "districts": [a.district for a in alerts],
        "alerts": [
            {
                "id": str(a.id),
                "district": a.district,
                "title": a.title,
                "severity": a.severity,
                "hours_remaining": a.hours_remaining,
            }
            for a in alerts
        ],
    }


@router.get("/history/{district}")
async def get_curfew_history(
    district: str,
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Get curfew history for a specific district.
    """
    repo = CurfewRepository(db)

    alerts = await repo.get_history_for_district(district, limit=limit)

    return {
        "district": district,
        "total": len(alerts),
        "history": [a.to_dict() for a in alerts],
    }


@router.post("/{alert_id}/deactivate", dependencies=[Depends(require_dev)])
async def deactivate_curfew(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Manually deactivate a curfew alert.

    For admin use when curfew is officially lifted.
    """
    repo = CurfewRepository(db)

    try:
        success = await repo.deactivate(UUID(alert_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid alert ID")

    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"status": "ok", "id": alert_id, "message": "Curfew alert deactivated"}


@router.post("/{alert_id}/extend", dependencies=[Depends(require_dev)])
async def extend_curfew(
    alert_id: str,
    hours: int = Query(default=24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """
    Extend a curfew alert's expiration time.

    For admin use when curfew is extended.
    """
    repo = CurfewRepository(db)

    try:
        alert = await repo.extend_alert(UUID(alert_id), hours=hours)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid alert ID")

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {
        "status": "ok",
        "id": alert_id,
        "new_expires_at": alert.expires_at.isoformat(),
        "hours_remaining": alert.hours_remaining,
    }


@router.post("/{alert_id}/confirm", dependencies=[Depends(require_dev)])
async def confirm_curfew(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Mark a curfew alert as manually confirmed.

    Confirmed alerts are shown with higher confidence.
    """
    repo = CurfewRepository(db)

    try:
        alert = await repo.confirm_alert(UUID(alert_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid alert ID")

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"status": "ok", "id": alert_id, "is_confirmed": True}


@router.get("/recent")
async def get_recent_curfews(
    limit: int = Query(default=10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """
    Get most recent curfew alerts (active or expired).

    For monitoring and history view.
    """
    repo = CurfewRepository(db)

    alerts = await repo.get_recent_alerts(limit=limit)

    return {
        "count": len(alerts),
        "alerts": [a.to_dict() for a in alerts],
    }
