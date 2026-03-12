"""Corporate Intelligence API endpoints -- cross-table analytics for investigative analysts."""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_analyst
from app.core.database import get_db
from app.models.user import User
from app.services.corporate_intel_service import CorporateIntelService
from app.schemas.corporate import (
    CorporateStatsResponse,
    CorporateSearchResponse,
    CorporateCompanyResponse,
    CompanyDetailResponse,
    PANInvestigationResponse,
    PhoneLinksResponse,
    PhoneClustersResponse,
    AnalystClusterGroupCreate,
    AnalystClusterGroupUpdate,
    AnalystClusterGroupResponse,
    AnalystClusterGroupListResponse,
    SharedDirectorsResponse,
    SharedDirectorLink,
    AddressClustersResponse,
    AddressCluster,
    RiskFlagsResponse,
    CompanyRiskEntry,
    RiskFlag,
    IRDEnrichmentSummary,
    DirectorResponse,
)

router = APIRouter(prefix="/corporate", tags=["Corporate Intelligence"])


# ============================================================
# Dashboard Stats (any authenticated user)
# ============================================================

@router.get("/stats", response_model=CorporateStatsResponse)
async def get_corporate_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Corporate intelligence dashboard stats.

    Returns total companies, PAN coverage percentage, IRD enrichment progress,
    breakdowns by type/province/district, and risk summary counts.
    Available to any authenticated user.
    """
    service = CorporateIntelService(db)
    return await service.get_corporate_stats()


# ============================================================
# Company Search (analyst+)
# ============================================================

@router.get("/companies", response_model=CorporateSearchResponse)
async def search_companies(
    q: Optional[str] = Query(default=None, description="Search by company name, Nepali name, or PAN"),
    district: Optional[str] = Query(default=None, description="Filter by district (partial match)"),
    company_type: Optional[str] = Query(default=None, description="Filter by type category (Private, Public, Foreign, Non-profit)"),
    has_pan: Optional[bool] = Query(default=None, description="Filter by PAN availability"),
    ird_status: Optional[str] = Query(default=None, description="Filter by IRD account status (partial match, e.g. 'Non-filer')"),
    has_cluster: Optional[bool] = Query(default=None, description="Filter by cluster membership (companies sharing phone/mobile numbers)"),
    sort: str = Query(default="name", description="Sort: name, name_desc, registration_number, registration_number_desc, newest, oldest"),
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Paginated company search with filters and IRD enrichment data.

    Joins company_registrations with ird_enrichments to provide a unified
    view of corporate registration and tax compliance status.
    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    result = await service.search_companies(
        query=q,
        district=district,
        company_type=company_type,
        has_pan=has_pan,
        ird_status=ird_status,
        has_cluster=has_cluster,
        sort=sort,
        page=page,
        limit=limit,
    )
    return CorporateSearchResponse(**result)


# ============================================================
# Company Detail (analyst+)
# ============================================================

@router.get("/companies/{company_id}", response_model=CompanyDetailResponse)
async def get_company_detail(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Full company profile with directors, IRD enrichment data, and risk flags.

    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    result = await service.get_company_detail(company_id)
    if not result:
        raise HTTPException(status_code=404, detail="Company not found")
    return CompanyDetailResponse(**result)


# ============================================================
# PAN Investigation (analyst+)
# ============================================================

@router.get("/pan/{pan}", response_model=PANInvestigationResponse)
async def investigate_pan(
    pan: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Full PAN investigation: find all companies registered under this PAN,
    fetch IRD enrichment data, and compute risk flags.

    This is the primary investigative tool for tracing corporate ownership
    through Nepal's tax identifier system.
    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    result = await service.investigate_pan(pan)
    if not result["companies"]:
        raise HTTPException(
            status_code=404,
            detail=f"No companies found for PAN: {pan}",
        )
    return PANInvestigationResponse(**result)


# ============================================================
# Phone-Linked Companies (analyst+)
# ============================================================

@router.get("/companies/{company_id}/phone-links", response_model=PhoneLinksResponse)
async def get_phone_linked_companies(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Find companies sharing phone/mobile numbers with the given company.

    Uses privacy-preserving HMAC-SHA256 hashes -- same hash = same phone
    = likely same controller/owner. No raw phone numbers stored.
    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    result = await service.get_phone_linked_companies(company_id)
    if not result:
        raise HTTPException(status_code=404, detail="Company not found")
    return PhoneLinksResponse(**result)


# ============================================================
# Phone Clusters — Global View (analyst+)
# ============================================================

@router.get("/phone-clusters", response_model=PhoneClustersResponse)
async def get_phone_clusters(
    limit: int = Query(default=200, ge=1, le=1000, description="Maximum clusters to return"),
    min_companies: int = Query(default=2, ge=2, le=100, description="Minimum companies per cluster"),
    max_members_per_cluster: int = Query(default=200, ge=1, le=500, description="Max member companies returned per cluster"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Get all phone/mobile hash clusters across the dataset.

    Returns groups of companies that share the same phone or mobile number
    (detected via privacy-preserving HMAC-SHA256 hash matching). Companies
    sharing a phone number are likely controlled by the same person/entity.
    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    return await service.get_phone_clusters(
        limit=limit,
        min_companies=min_companies,
        max_members_per_cluster=max_members_per_cluster,
    )


# ============================================================
# Analyst Cluster Groups (manual graphing over phone clusters)
# ============================================================

@router.get("/cluster-groups", response_model=AnalystClusterGroupListResponse)
async def list_cluster_groups(
    only_mine: bool = Query(default=False, description="Return only groups created by current analyst"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum groups to return"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    List analyst-defined phone cluster groups.

    These groups let analysts manually combine clusters, assign a main cluster,
    and create named directed/bidirectional links for investigation workflows.
    """
    service = CorporateIntelService(db)
    items = await service.list_cluster_groups(
        created_by_id=user.id if only_mine else None,
        limit=limit,
    )
    return AnalystClusterGroupListResponse(items=items, total=len(items))


@router.post("/cluster-groups", response_model=AnalystClusterGroupResponse, status_code=201)
async def create_cluster_group(
    data: AnalystClusterGroupCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Create an analyst-defined phone cluster group graph."""
    service = CorporateIntelService(db)
    try:
        created = await service.create_cluster_group(
            name=data.name,
            description=data.description,
            main_cluster_id=data.main_cluster_id,
            clusters=[node.model_dump() for node in data.clusters],
            edges=[edge.model_dump() for edge in data.edges],
            created_by_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return AnalystClusterGroupResponse(**created)


@router.get("/cluster-groups/{group_id}", response_model=AnalystClusterGroupResponse)
async def get_cluster_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Get one analyst-defined phone cluster group graph by ID."""
    service = CorporateIntelService(db)
    group = await service.get_cluster_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Cluster group not found")
    return AnalystClusterGroupResponse(**group)


@router.patch("/cluster-groups/{group_id}", response_model=AnalystClusterGroupResponse)
async def update_cluster_group(
    group_id: UUID,
    data: AnalystClusterGroupUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Update an analyst-defined phone cluster group graph."""
    service = CorporateIntelService(db)
    try:
        updated = await service.update_cluster_group(
            group_id=group_id,
            updated_by_id=user.id,
            update_data=data.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not updated:
        raise HTTPException(status_code=404, detail="Cluster group not found")
    return AnalystClusterGroupResponse(**updated)


@router.delete("/cluster-groups/{group_id}")
async def delete_cluster_group(
    group_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Delete an analyst-defined phone cluster group graph."""
    service = CorporateIntelService(db)
    deleted = await service.delete_cluster_group(group_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cluster group not found")
    return {"ok": True}


# ============================================================
# Shared Directors / Director Network (analyst+)
# ============================================================

@router.get("/shared-directors/{company_id}", response_model=SharedDirectorsResponse)
async def get_shared_directors(
    company_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Find companies that share directors with the given company.

    This reveals corporate networks where the same individuals serve
    as directors across multiple companies -- a key indicator for
    beneficial ownership analysis.
    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    result = await service.find_shared_directors(company_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return SharedDirectorsResponse(**result)


# ============================================================
# Address Clusters / Shell Company Detection (analyst+)
# ============================================================

@router.get("/address-clusters", response_model=AddressClustersResponse)
async def get_address_clusters(
    min_companies: int = Query(default=5, ge=2, le=100, description="Minimum companies at address to be considered a cluster"),
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=20, ge=1, le=100, description="Clusters per page"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Find addresses with many registered companies (shell company signal).

    Addresses with 5+ companies registered are flagged. 20+ is considered
    highly suspicious. Each cluster includes a sample of companies at that address.
    Analyst+ access required.
    """
    service = CorporateIntelService(db)
    result = await service.get_address_clusters(
        min_companies=min_companies,
        page=page,
        limit=limit,
    )
    return AddressClustersResponse(**result)


# ============================================================
# Risk Flags Dashboard (analyst+)
# ============================================================

@router.get("/risk-flags", response_model=RiskFlagsResponse)
async def get_risk_flags(
    min_severity: str = Query(default="MEDIUM", description="Minimum severity: LOW, MEDIUM, HIGH"),
    page: int = Query(default=1, ge=1, description="Page number"),
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """
    Get companies with risk flags, filtered by minimum severity.

    Risk categories:
    - **tax_compliance** (HIGH): IRD status is "Non-filer"
    - **pan_sharing** (HIGH): Multiple companies sharing the same PAN
    - **address_clustering** (MEDIUM/HIGH): 5+ companies at the same address
    - **dormant** (LOW): No recent communication with OCR

    Analyst+ access required.
    """
    if min_severity.upper() not in ("LOW", "MEDIUM", "HIGH"):
        raise HTTPException(
            status_code=400,
            detail="min_severity must be LOW, MEDIUM, or HIGH",
        )
    service = CorporateIntelService(db)
    result = await service.get_risk_flags(
        min_severity=min_severity,
        page=page,
        limit=limit,
    )
    return RiskFlagsResponse(**result)


# ============================================================
# Registration Timeline (analyst+)
# ============================================================

@router.get("/timeline")
async def get_registration_timeline(
    group_by: str = Query(default="month", description="Group by: month or year"),
    district: Optional[str] = Query(default=None, description="Filter by district"),
    company_type: Optional[str] = Query(default=None, description="Filter by company type category"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Registration count time series grouped by month or year."""
    service = CorporateIntelService(db)
    return await service.get_registration_timeline(
        group_by=group_by,
        district=district,
        company_type=company_type,
    )


@router.get("/timeline/events")
async def get_registration_events(
    start_date: Optional[str] = Query(default=None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(default=None, description="End date (YYYY-MM-DD)"),
    district: Optional[str] = Query(default=None, description="Filter by district"),
    limit: int = Query(default=500, ge=1, le=2000, description="Max events"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_analyst),
):
    """Individual company registration events for timeline visualization."""
    service = CorporateIntelService(db)
    return await service.get_registration_events(
        start_date=start_date,
        end_date=end_date,
        district=district,
        limit=limit,
    )
