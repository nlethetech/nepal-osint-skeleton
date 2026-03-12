"""Anomaly Detection API endpoints -- cross-domain anomaly scanning for investigative analysts."""
from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_analyst
from app.core.database import get_db
from app.models.user import User
from app.services.anomaly_detection_service import AnomalyDetectionService
from app.schemas.anomaly import (
    AnomalySummary,
    SameDayCluster,
    RapidDirectorChange,
    NonFilerCluster,
    PANAnomaly,
    AnomalyScanResult,
)

router = APIRouter(prefix="/anomalies", tags=["Anomaly Detection"])


# ============================================================
# Summary (fast counts for dashboard badges)
# ============================================================

@router.get("/summary", response_model=AnomalySummary)
async def get_anomaly_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Aggregate counts of all anomaly types for dashboard summary badges.

    Returns counts for: same-day registration clusters, rapid director changes,
    non-filer address clusters, and PAN anomalies.
    Analyst+ access required.
    """
    service = AnomalyDetectionService(db)
    return await service.get_anomaly_summary()


# ============================================================
# Same-Day Registration Clusters
# ============================================================

@router.get("/same-day-clusters", response_model=List[SameDayCluster])
async def get_same_day_clusters(
    min_count: int = Query(default=3, ge=2, le=50, description="Minimum companies at same address on same day"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum clusters to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Find dates where min_count+ companies registered at the same address on
    the same day. A strong signal for coordinated shell company creation.

    Analyst+ access required.
    """
    service = AnomalyDetectionService(db)
    return await service.detect_same_day_registration_clusters(
        min_count=min_count,
        limit=limit,
    )


# ============================================================
# Rapid Director Changes
# ============================================================

@router.get("/rapid-director-changes", response_model=List[RapidDirectorChange])
async def get_rapid_director_changes(
    max_days: int = Query(default=90, ge=1, le=365, description="Maximum days between appointment and resignation"),
    limit: int = Query(default=200, ge=1, le=1000, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Companies where directors were appointed AND resigned within max_days days.
    Rapid turnover indicates nominee directors or fraudulent arrangements.

    Analyst+ access required.
    """
    service = AnomalyDetectionService(db)
    return await service.detect_rapid_director_changes(
        max_days=max_days,
        limit=limit,
    )


# ============================================================
# Non-Filer Clusters
# ============================================================

@router.get("/non-filer-clusters", response_model=List[NonFilerCluster])
async def get_non_filer_clusters(
    min_pct: float = Query(default=60.0, ge=10.0, le=100.0, description="Minimum non-filer percentage at address"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum clusters to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Addresses where the majority (>min_pct%) of companies are IRD non-filers.
    High non-filer concentration suggests potential tax avoidance clusters.

    Analyst+ access required.
    """
    service = AnomalyDetectionService(db)
    return await service.detect_non_filer_clusters(
        min_pct=min_pct,
        limit=limit,
    )


# ============================================================
# PAN Anomalies
# ============================================================

@router.get("/pan-anomalies", response_model=List[PANAnomaly])
async def get_pan_anomalies(
    min_companies: int = Query(default=5, ge=2, le=100, description="Minimum companies per PAN to flag"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum anomalies to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    PANs linked to min_companies+ companies. A single PAN controlling many
    companies is unusual and warrants investigation.

    Analyst+ access required.
    """
    service = AnomalyDetectionService(db)
    return await service.detect_pan_anomalies(
        min_companies=min_companies,
        limit=limit,
    )


# ============================================================
# Full Scan (all detectors)
# ============================================================

@router.get("/full-scan", response_model=AnomalyScanResult)
async def run_full_scan(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Run all anomaly detectors and return combined results.
    This is a heavier query -- use the individual endpoints for targeted analysis.

    Analyst+ access required.
    """
    service = AnomalyDetectionService(db)
    return await service.run_full_scan()
