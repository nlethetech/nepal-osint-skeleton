"""Corporate Analytics API endpoints -- advanced analytics for NARADA v6."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_analyst
from app.core.database import get_db
from app.models.user import User
from app.services.corporate_analytics_service import CorporateAnalyticsService
from app.schemas.corporate import (
    BeneficialOwnersResponse,
    ShellCompanyScoresResponse,
    TaxComplianceStatsResponse,
    NetworkStatsResponse,
    RegistrationPatternsResponse,
)

router = APIRouter(prefix="/corporate/analytics", tags=["Corporate Analytics"])


# ============================================================
# Beneficial Ownership Discovery (analyst+)
# ============================================================

@router.get("/beneficial-owners", response_model=BeneficialOwnersResponse)
async def get_beneficial_owners(
    min_companies: int = Query(
        default=3, ge=2, le=50,
        description="Minimum number of companies a person must direct to be flagged",
    ),
    limit: int = Query(default=50, ge=1, le=200, description="Maximum results to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Discover potential beneficial owners: persons who are directors of N+ companies.

    Groups by citizenship number when available for accuracy, falls back to name matching.
    Analyst+ access required.
    """
    service = CorporateAnalyticsService(db)
    result = await service.find_beneficial_owners(
        min_companies=min_companies,
        limit=limit,
    )
    return BeneficialOwnersResponse(**result)


# ============================================================
# Shell Company Scoring (analyst+)
# ============================================================

@router.get("/shell-scores", response_model=ShellCompanyScoresResponse)
async def get_shell_scores(
    limit: int = Query(default=100, ge=1, le=500, description="Maximum companies to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Score companies based on shell company risk signals.

    Scoring:
    - +30: Multiple companies at same address (>= 5)
    - +25: Non-filer IRD status
    - +20: Same-day registration at same address (3+ companies)
    - +15: Director changes in last 90 days
    - +10: No directors on record

    Returns top N companies sorted by risk score descending.
    Analyst+ access required.
    """
    service = CorporateAnalyticsService(db)
    result = await service.score_shell_companies(limit=limit)
    return ShellCompanyScoresResponse(**result)


# ============================================================
# Tax Compliance Dashboard (analyst+)
# ============================================================

@router.get("/tax-compliance", response_model=TaxComplianceStatsResponse)
async def get_tax_compliance(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Aggregate tax compliance statistics.

    Provides total PANs, active filers, non-filers, cancelled, unknown,
    plus breakdowns by district and company type category.
    Analyst+ access required.
    """
    service = CorporateAnalyticsService(db)
    result = await service.get_tax_compliance_stats()
    return TaxComplianceStatsResponse(**result)


# ============================================================
# Corporate Network Stats (analyst+)
# ============================================================

@router.get("/network-stats", response_model=NetworkStatsResponse)
async def get_network_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Corporate network statistics.

    - Most connected directors (serve on most boards)
    - Most connected addresses (most companies registered)
    - PAN sharing groups (multiple companies using same PAN)
    Analyst+ access required.
    """
    service = CorporateAnalyticsService(db)
    result = await service.get_network_stats()
    return NetworkStatsResponse(**result)


# ============================================================
# Registration Pattern Analysis (analyst+)
# ============================================================

@router.get("/registration-patterns", response_model=RegistrationPatternsResponse)
async def get_registration_patterns(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Registration pattern analysis.

    - Companies registered per month/year (time series)
    - Peak registration dates
    - Same-day registration clusters (anomaly detection)
    Analyst+ access required.
    """
    service = CorporateAnalyticsService(db)
    result = await service.get_registration_patterns()
    return RegistrationPatternsResponse(**result)
