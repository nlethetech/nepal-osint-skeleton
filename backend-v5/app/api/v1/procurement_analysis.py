"""Procurement analysis API — risk scoring, cross-referencing, and case integration."""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_analyst
from app.models.user import User
from app.services.procurement_analysis_service import ProcurementAnalysisService
from app.services.procurement_company_linkage_service import ProcurementCompanyLinkageService

router = APIRouter(prefix="/procurement-analysis", tags=["Procurement Analysis"])


# ── Request schemas ────────────────────────────────────────

class CreateCaseRequest(BaseModel):
    procuring_entity: str
    contractor_name: str
    flag_data: dict
    hypothesis_text: str | None = None


class VerificationRequestBody(BaseModel):
    procuring_entity: str
    contractor_name: str
    flag_data: dict


class AddToWatchlistRequest(BaseModel):
    watchlist_id: UUID
    item_type: str = Field(description="ORGANIZATION or PERSON")
    value: str


# ── Discovery endpoints ───────────────────────────────────

@router.get("/summary")
async def get_summary(db: AsyncSession = Depends(get_db)):
    """Dashboard KPIs for procurement analysis."""
    svc = ProcurementAnalysisService(db)
    return await svc.get_summary()


@router.get("/risk-flags")
async def get_risk_flags(
    min_contracts: int = Query(default=3, ge=1, description="Minimum contracts for a pair to be flagged"),
    min_budget_pct: float = Query(default=30.0, ge=0, le=100, description="Minimum budget concentration %"),
    sort_by: str = Query(default="risk_score", description="Sort field: risk_score, budget_pct, contract_count, total_value"),
    limit: int = Query(default=50, ge=1, le=200, description="Max results"),
    db: AsyncSession = Depends(get_db),
):
    """Composite risk-scored entity-contractor flags."""
    svc = ProcurementAnalysisService(db)
    return await svc.get_risk_scored_flags(
        min_contracts=min_contracts,
        min_budget_pct=min_budget_pct,
        sort_by=sort_by,
        limit=limit,
    )


@router.get("/same-day-awards")
async def get_same_day_awards(
    min_same_day: int = Query(default=2, ge=2, description="Minimum contracts on same day"),
    db: AsyncSession = Depends(get_db),
):
    """Entities awarding multiple contracts on the same day."""
    svc = ProcurementAnalysisService(db)
    return await svc.get_same_day_awards(min_same_day=min_same_day)


@router.get("/entity-matrix")
async def get_entity_matrix(
    limit_entities: int = Query(default=25, ge=1, le=100),
    limit_contractors: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Top entities x top contractors heatmap matrix."""
    svc = ProcurementAnalysisService(db)
    return await svc.get_entity_contractor_matrix(
        limit_entities=limit_entities,
        limit_contractors=limit_contractors,
    )


# ── Cross-Reference endpoint ──────────────────────────────

@router.get("/ocr-cross-ref")
async def get_ocr_cross_ref(
    limit: int = Query(default=50, ge=1, le=500),
    refresh: bool = Query(default=False, description="Rebuild contractor OCR links before querying"),
    db: AsyncSession = Depends(get_db),
):
    """Match contractors to OCR company registrations."""
    svc = ProcurementAnalysisService(db)
    return await svc.get_ocr_cross_reference(limit=limit, refresh=refresh)


@router.get("/ocr-linkage/stats")
async def get_ocr_linkage_stats(
    db: AsyncSession = Depends(get_db),
):
    """Coverage metrics for contractor-to-OCR linkage table."""
    svc = ProcurementCompanyLinkageService(db)
    return await svc.ensure_links(target_coverage=0.90)


@router.post("/ocr-linkage/refresh")
async def refresh_ocr_linkage(
    target_coverage: float = Query(default=0.90, ge=0.5, le=1.0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Force-refresh contractor-to-OCR link table."""
    _ = current_user
    svc = ProcurementCompanyLinkageService(db)
    return await svc.refresh_links(target_coverage=target_coverage)


# ── Drilldown endpoints ───────────────────────────────────

@router.get("/entity/{entity_name}")
async def get_entity_drilldown(
    entity_name: str,
    db: AsyncSession = Depends(get_db),
):
    """Full procurement profile for one procuring entity."""
    svc = ProcurementAnalysisService(db)
    result = await svc.get_entity_drilldown(entity_name)
    if result["total_contracts"] == 0:
        raise HTTPException(status_code=404, detail="Entity not found in procurement data")
    return result


@router.get("/contractor/{contractor_name}")
async def get_contractor_profile(
    contractor_name: str,
    db: AsyncSession = Depends(get_db),
):
    """Full profile for one contractor across all entities."""
    svc = ProcurementAnalysisService(db)
    result = await svc.get_contractor_profile(contractor_name)
    if result["total_contracts"] == 0:
        raise HTTPException(status_code=404, detail="Contractor not found in procurement data")
    return result


# ── Case integration endpoints (analyst auth) ─────────────

@router.post("/create-case")
async def create_case(
    request: CreateCaseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create an investigation case pre-populated with procurement evidence."""
    svc = ProcurementAnalysisService(db)
    return await svc.create_investigation_case(
        flag_data={
            "procuring_entity": request.procuring_entity,
            "contractor_name": request.contractor_name,
            **request.flag_data,
        },
        analyst_id=current_user.id,
        hypothesis_text=request.hypothesis_text,
    )


@router.post("/request-verification")
async def request_verification(
    request: VerificationRequestBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a verification request for peer review of a procurement flag."""
    svc = ProcurementAnalysisService(db)
    return await svc.create_verification_request(
        flag_data={
            "procuring_entity": request.procuring_entity,
            "contractor_name": request.contractor_name,
            **request.flag_data,
        },
        analyst_id=current_user.id,
    )


@router.post("/add-to-watchlist")
async def add_to_watchlist(
    request: AddToWatchlistRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add an entity or contractor to an existing watchlist."""
    svc = ProcurementAnalysisService(db)
    return await svc.add_to_watchlist(
        watchlist_id=request.watchlist_id,
        item_type=request.item_type,
        value=request.value,
        analyst_id=current_user.id,
    )
