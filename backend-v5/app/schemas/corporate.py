"""Pydantic schemas for Corporate Intelligence API."""
from datetime import date, datetime
from typing import Optional, List, Dict

from pydantic import BaseModel, Field


# ============================================================
# IRD Enrichment (embedded in company responses)
# ============================================================

class IRDEnrichmentSummary(BaseModel):
    """Lightweight IRD enrichment info attached to company records."""
    pan: str
    taxpayer_name_en: Optional[str] = None
    taxpayer_name_np: Optional[str] = None
    account_type: Optional[str] = None
    account_status: Optional[str] = None
    registration_date_bs: Optional[str] = None
    tax_office: Optional[str] = None
    is_personal: Optional[str] = None
    ward_no: Optional[str] = None
    vdc_municipality: Optional[str] = None
    phone_hash: Optional[str] = None
    mobile_hash: Optional[str] = None
    latest_tax_clearance_fy: Optional[str] = None
    tax_clearance_verified: Optional[bool] = None
    fetched_at: Optional[datetime] = None


# ============================================================
# Company with enrichment
# ============================================================

class CorporateCompanyResponse(BaseModel):
    """Company record with IRD enrichment data attached."""
    id: str
    external_id: str
    registration_number: int
    name_nepali: Optional[str] = None
    name_english: str
    registration_date_bs: Optional[str] = None
    registration_date_ad: Optional[date] = None
    company_type: Optional[str] = None
    company_type_category: Optional[str] = None
    company_address: Optional[str] = None
    district: Optional[str] = None
    province: Optional[str] = None
    last_communication_bs: Optional[str] = None
    pan: Optional[str] = None
    camis_company_id: Optional[int] = None
    cro_company_id: Optional[str] = None
    camis_enriched: bool = False
    camis_enriched_at: Optional[datetime] = None
    ird_enriched: bool = False
    ird_enriched_at: Optional[datetime] = None
    fetched_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Attached IRD enrichment (None if not available)
    ird_enrichment: Optional[IRDEnrichmentSummary] = None
    # Convenience fields for list views
    ird_status: Optional[str] = None
    ird_taxpayer_name: Optional[str] = None
    director_count: int = 0
    linked_company_count: int = 0
    govt_contract_count: int = 0
    govt_contract_total_npr: Optional[float] = None


class DirectorResponse(BaseModel):
    """Director record for corporate intelligence views."""
    id: str
    company_id: Optional[str] = None
    name_en: str
    name_np: Optional[str] = None
    role: Optional[str] = None
    company_name_hint: Optional[str] = None
    source: str
    confidence: float = 1.0
    pan: Optional[str] = None
    citizenship_no: Optional[str] = None
    appointed_date: Optional[date] = None
    resigned_date: Optional[date] = None


# ============================================================
# PAN Investigation
# ============================================================

class RiskFlag(BaseModel):
    """A single risk indicator."""
    severity: str = Field(description="HIGH, MEDIUM, or LOW")
    category: str = Field(description="e.g. tax_compliance, address_clustering, pan_sharing")
    description: str
    details: Optional[Dict] = None


class PANInvestigationResponse(BaseModel):
    """Full PAN investigation result."""
    pan: str
    companies: List[CorporateCompanyResponse]
    ird: Optional[IRDEnrichmentSummary] = None
    risk_flags: List[RiskFlag] = Field(default_factory=list)


# ============================================================
# Search / List
# ============================================================

class CorporateSearchResponse(BaseModel):
    """Paginated company search results."""
    items: List[CorporateCompanyResponse]
    total: int
    page: int = 1
    limit: int = 50
    has_more: bool = False


# ============================================================
# Company Detail
# ============================================================

class CompanyDetailResponse(CorporateCompanyResponse):
    """Full company profile with directors and IRD data (flattened)."""
    ird_status: Optional[str] = None
    ird_taxpayer_name: Optional[str] = None
    directors: List[DirectorResponse] = Field(default_factory=list)
    ird: Optional[IRDEnrichmentSummary] = None
    risk_flags: List[RiskFlag] = Field(default_factory=list)
    govt_procurement_summary: Optional["GovtProcurementSummary"] = None


class GovtProcurementEntitySummary(BaseModel):
    """Aggregate procurement totals per government procuring entity."""
    name: str
    contract_count: int
    total_value_npr: float


class GovtProcurementContract(BaseModel):
    """Individual government contract record linked to a company."""
    id: str
    contractor_name: Optional[str] = None
    procuring_entity: Optional[str] = None
    ifb_number: Optional[str] = None
    project_name: Optional[str] = None
    procurement_type: Optional[str] = None
    contract_award_date: Optional[str] = None
    contract_amount_npr: Optional[float] = None
    fiscal_year_bs: Optional[str] = None
    district: Optional[str] = None
    source_url: Optional[str] = None


class GovtProcurementSummary(BaseModel):
    """Expanded procurement context for company detail drawer."""
    linked_contractor_names: List[str] = Field(default_factory=list)
    procuring_entities: List[GovtProcurementEntitySummary] = Field(default_factory=list)
    contracts: List[GovtProcurementContract] = Field(default_factory=list)


# ============================================================
# Dashboard Stats
# ============================================================

class CorporateStatsResponse(BaseModel):
    """Dashboard-level corporate intelligence stats."""
    total_companies: int
    companies_with_pan: int
    pan_coverage_pct: float = Field(description="Percentage of companies with PAN")
    camis_enriched_count: int = 0
    ird_enriched_count: int
    ird_enrichment_pct: float = Field(description="Percentage of PAN-holding companies with IRD data")
    total_directors: int
    companies_by_type: Dict[str, int] = Field(default_factory=dict)
    companies_by_province: Dict[str, int] = Field(default_factory=dict)
    top_districts: Dict[str, int] = Field(default_factory=dict)
    risk_summary: Dict[str, int] = Field(default_factory=dict, description="Count of risk flags by severity")


# ============================================================
# Shared Directors (Network)
# ============================================================

class PhoneLinkedCompany(BaseModel):
    """A company linked via shared phone/mobile number hash."""
    company_id: str
    company_name: str
    pan: Optional[str] = None
    district: Optional[str] = None
    company_address: Optional[str] = None
    ird_status: Optional[str] = None
    match_type: str = Field(description="phone, mobile, or both")


class PhoneLinksResponse(BaseModel):
    """Companies linked by shared phone/mobile number."""
    company_id: str
    company_name: str
    links: List[PhoneLinkedCompany] = Field(default_factory=list)


# ============================================================
# Phone Clusters (global view)
# ============================================================

class PhoneClusterCompany(BaseModel):
    """A company within a phone/mobile hash cluster."""
    company_id: str
    company_name: str
    pan: Optional[str] = None
    registration_number: Optional[int] = None
    district: Optional[str] = None
    company_address: Optional[str] = None
    ird_status: Optional[str] = None


class PhoneCluster(BaseModel):
    """A cluster of companies sharing the same phone or mobile hash."""
    cluster_id: str = Field(description="Stable cluster identifier for analyst graphing")
    hash_type: str = Field(description="phone, mobile, or both")
    company_count: int
    first_registered: PhoneClusterCompany
    companies: List[PhoneClusterCompany] = Field(
        default_factory=list,
        description="Cluster members (may be truncated for performance)",
    )


class PhoneClustersResponse(BaseModel):
    """All phone/mobile hash clusters across the dataset."""
    clusters: List[PhoneCluster]
    total_clusters: int
    total_linked_companies: int


# ============================================================
# Analyst Cluster Groups (manual analyst graphing)
# ============================================================

class AnalystClusterNode(BaseModel):
    """A phone cluster node saved into an analyst-defined group graph."""
    cluster_id: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=300)
    hash_type: Optional[str] = None
    company_count: Optional[int] = None
    first_registered_company_id: Optional[str] = None
    first_registered_company_name: Optional[str] = None


class AnalystClusterEdge(BaseModel):
    """A manual relationship between two saved phone cluster nodes."""
    id: Optional[str] = Field(default=None, max_length=120)
    source_cluster_id: str = Field(min_length=1, max_length=160)
    target_cluster_id: str = Field(min_length=1, max_length=160)
    label: str = Field(min_length=1, max_length=120)
    bidirectional: bool = False


class AnalystClusterGroupCreate(BaseModel):
    """Create payload for analyst-defined cluster group graph."""
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    main_cluster_id: Optional[str] = None
    clusters: List[AnalystClusterNode] = Field(default_factory=list)
    edges: List[AnalystClusterEdge] = Field(default_factory=list)


class AnalystClusterGroupUpdate(BaseModel):
    """Patch payload for analyst-defined cluster group graph."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    main_cluster_id: Optional[str] = None
    clusters: Optional[List[AnalystClusterNode]] = None
    edges: Optional[List[AnalystClusterEdge]] = None


class AnalystClusterGroupResponse(BaseModel):
    """Stored analyst-defined cluster group graph."""
    id: str
    name: str
    description: Optional[str] = None
    main_cluster_id: Optional[str] = None
    clusters: List[AnalystClusterNode] = Field(default_factory=list)
    edges: List[AnalystClusterEdge] = Field(default_factory=list)
    created_by_id: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_id: Optional[str] = None
    updated_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AnalystClusterGroupListResponse(BaseModel):
    """List response for analyst cluster groups."""
    items: List[AnalystClusterGroupResponse]
    total: int


class SharedDirectorLink(BaseModel):
    """A director who appears in multiple companies."""
    director_name: str
    director_role: Optional[str] = None
    source: str
    linked_company_id: str
    linked_company_name: str
    linked_company_pan: Optional[str] = None


class SharedDirectorsResponse(BaseModel):
    """Companies sharing directors with a given company."""
    company_id: str
    company_name: str
    shared_links: List[SharedDirectorLink] = Field(default_factory=list)
    unique_linked_companies: int = 0


# ============================================================
# Address Clusters
# ============================================================

class AddressCluster(BaseModel):
    """An address with many registered companies (shell company signal)."""
    address: str
    company_count: int
    companies: List[CorporateCompanyResponse] = Field(default_factory=list)
    district: Optional[str] = None
    province: Optional[str] = None


class AddressClustersResponse(BaseModel):
    """List of address clusters."""
    clusters: List[AddressCluster]
    total_clusters: int


# ============================================================
# Risk Flags
# ============================================================

class CompanyRiskEntry(BaseModel):
    """A company with its risk flags."""
    company: CorporateCompanyResponse
    risk_flags: List[RiskFlag] = Field(default_factory=list)


class RiskFlagsResponse(BaseModel):
    """Paginated risk flags across companies."""
    items: List[CompanyRiskEntry]
    total: int
    page: int = 1
    limit: int = 50


# ============================================================
# Advanced Analytics: Beneficial Ownership
# ============================================================

class BeneficialOwnerCompany(BaseModel):
    """A company linked to a beneficial owner."""
    id: str
    name_english: str
    pan: Optional[str] = None
    district: Optional[str] = None
    role: Optional[str] = None


class BeneficialOwner(BaseModel):
    """A person who is a director of multiple companies."""
    name: str
    citizenship_no: Optional[str] = None
    total_companies: int
    companies: List[BeneficialOwnerCompany] = Field(default_factory=list)
    match_type: str = Field(description="citizenship_no or name_en")


class BeneficialOwnersResponse(BaseModel):
    """Beneficial ownership discovery results."""
    owners: List[BeneficialOwner]
    total: int


# ============================================================
# Advanced Analytics: Shell Company Scoring
# ============================================================

class ShellCompanyScore(BaseModel):
    """A company with its shell company risk score."""
    id: str
    name_english: str
    pan: Optional[str] = None
    company_address: Optional[str] = None
    district: Optional[str] = None
    registration_date_ad: Optional[str] = None
    score: int
    factors: List[str] = Field(default_factory=list)


class ShellCompanyScoresResponse(BaseModel):
    """Shell company scoring results."""
    companies: List[ShellCompanyScore]
    total_scored: int


# ============================================================
# Advanced Analytics: Tax Compliance
# ============================================================

class DistrictCompliance(BaseModel):
    """Tax compliance stats for a district."""
    district: str
    total: int
    nonfiler_count: int


class TypeCompliance(BaseModel):
    """Tax compliance stats for a company type category."""
    category: str
    total: int
    nonfiler_count: int


class TaxComplianceStatsResponse(BaseModel):
    """Tax compliance dashboard statistics."""
    total_pans: int
    active_filers: int
    non_filers: int
    cancelled: int
    unknown: int
    status_breakdown: Dict[str, int] = Field(default_factory=dict)
    by_district: List[DistrictCompliance] = Field(default_factory=list)
    by_company_type: List[TypeCompliance] = Field(default_factory=list)


# ============================================================
# Advanced Analytics: Network Stats
# ============================================================

class TopDirector(BaseModel):
    """A director who serves on many boards."""
    name: str
    citizenship_no: Optional[str] = None
    company_count: int


class TopAddress(BaseModel):
    """An address with many registered companies."""
    address: str
    district: Optional[str] = None
    company_count: int


class PANSharingGroup(BaseModel):
    """A group of companies sharing the same PAN."""
    pan: str
    company_count: int
    company_names: Optional[str] = None


class NetworkSummary(BaseModel):
    """Summary counts for network statistics."""
    total_unique_directors: int
    multi_board_directors: int
    total_pan_sharing_groups: int


class NetworkStatsResponse(BaseModel):
    """Corporate network statistics."""
    top_directors: List[TopDirector] = Field(default_factory=list)
    top_addresses: List[TopAddress] = Field(default_factory=list)
    pan_sharing_groups: List[PANSharingGroup] = Field(default_factory=list)
    summary: NetworkSummary


# ============================================================
# Advanced Analytics: Registration Patterns
# ============================================================

class YearlyRegistration(BaseModel):
    """Registration count for a year."""
    year: int
    count: int


class MonthlyRegistration(BaseModel):
    """Registration count for a month."""
    year: int
    month: int
    count: int


class PeakDate(BaseModel):
    """A peak registration date."""
    date: Optional[str] = None
    count: int


class SameDayCluster(BaseModel):
    """A cluster of companies registered at the same address on the same day."""
    address: str
    date: Optional[str] = None
    count: int


class RegistrationPatternsResponse(BaseModel):
    """Registration pattern analysis results."""
    yearly: List[YearlyRegistration] = Field(default_factory=list)
    monthly: List[MonthlyRegistration] = Field(default_factory=list)
    peak_dates: List[PeakDate] = Field(default_factory=list)
    same_day_clusters: List[SameDayCluster] = Field(default_factory=list)
    anomaly_threshold: float = 0.0
