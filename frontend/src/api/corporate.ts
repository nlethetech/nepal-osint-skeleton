/**
 * Corporate Intelligence API client
 * V6: Company Explorer, PAN Investigation, Director Networks
 */
import { apiClient } from './client'

// ── Types ──────────────────────────────────────────────────────

export interface CompanyRecord {
  id: string
  registration_number: number
  name_english: string
  name_nepali: string | null
  registration_date_bs: string | null
  registration_date_ad: string | null
  company_type: string | null
  company_type_category: string | null
  company_address: string | null
  district: string | null
  province: string | null
  pan: string | null
  camis_enriched: boolean
  ird_enriched: boolean
  ird_status: string | null
  ird_taxpayer_name: string | null
  director_count?: number
  linked_company_count?: number
  govt_contract_count?: number
  govt_contract_total_npr?: number | null
}

export interface CompanyDetail extends CompanyRecord {
  camis_company_id: number | null
  cro_company_id: string | null
  camis_enriched_at: string | null
  ird_enriched_at: string | null
  last_communication_bs: string | null
  directors: DirectorRecord[]
  ird: IRDRecord | null
  govt_procurement_summary?: GovtProcurementSummary | null
}

export interface GovtProcurementEntitySummary {
  name: string
  contract_count: number
  total_value_npr: number
}

export interface GovtProcurementContract {
  id: string
  contractor_name: string | null
  procuring_entity: string | null
  ifb_number: string | null
  project_name: string | null
  procurement_type: string | null
  contract_award_date: string | null
  contract_amount_npr: number | null
  fiscal_year_bs: string | null
  district: string | null
  source_url: string | null
}

export interface GovtProcurementSummary {
  linked_contractor_names: string[]
  procuring_entities: GovtProcurementEntitySummary[]
  contracts: GovtProcurementContract[]
}

export interface DirectorRecord {
  id: string
  name_en: string
  name_np: string | null
  role: string | null
  source: string
  confidence: number
  pan: string | null
  citizenship_no: string | null
  appointed_date: string | null
  resigned_date: string | null
  company_id: string | null
  company_name: string | null
}

export interface IRDRecord {
  pan: string
  taxpayer_name_en: string | null
  taxpayer_name_np: string | null
  account_type: string | null
  account_status: string | null
  registration_date_bs: string | null
  tax_office: string | null
  filing_period: string | null
  is_personal: string | null
  ward_no: string | null
  vdc_municipality: string | null
  latest_tax_clearance_fy: string | null
  tax_clearance_verified: boolean | null
}

export interface RiskFlag {
  company_id: string
  company_name: string
  pan: string | null
  flag_type: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
}

export interface PhoneLinkedCompany {
  company_id: string
  company_name: string
  pan: string | null
  district: string | null
  company_address: string | null
  ird_status: string | null
  match_type: string
}

export interface PhoneLinksResponse {
  company_id: string
  company_name: string
  links: PhoneLinkedCompany[]
}

// ── Phone Clusters (global view) ──────────────────────────────

export interface PhoneClusterCompany {
  company_id: string
  company_name: string
  pan: string | null
  registration_number: number | null
  district: string | null
  company_address: string | null
  ird_status: string | null
}

export interface PhoneCluster {
  cluster_id: string
  hash_type: 'phone' | 'mobile' | 'both'
  company_count: number
  first_registered: PhoneClusterCompany
  companies?: PhoneClusterCompany[]
}

export interface PhoneClustersResponse {
  clusters: PhoneCluster[]
  total_clusters: number
  total_linked_companies: number
}

export interface AnalystClusterNode {
  cluster_id: string
  label: string
  hash_type?: string | null
  company_count?: number | null
  first_registered_company_id?: string | null
  first_registered_company_name?: string | null
}

export interface AnalystClusterEdge {
  id?: string | null
  source_cluster_id: string
  target_cluster_id: string
  label: string
  bidirectional: boolean
}

export interface AnalystClusterGroup {
  id: string
  name: string
  description: string | null
  main_cluster_id: string | null
  clusters: AnalystClusterNode[]
  edges: AnalystClusterEdge[]
  created_by_id: string | null
  created_by_name: string | null
  updated_by_id: string | null
  updated_by_name: string | null
  created_at: string | null
  updated_at: string | null
}

export interface AnalystClusterGroupListResponse {
  items: AnalystClusterGroup[]
  total: number
}

export interface AnalystClusterGroupCreatePayload {
  name: string
  description?: string | null
  main_cluster_id?: string | null
  clusters?: AnalystClusterNode[]
  edges?: AnalystClusterEdge[]
}

export interface AnalystClusterGroupUpdatePayload {
  name?: string
  description?: string | null
  main_cluster_id?: string | null
  clusters?: AnalystClusterNode[]
  edges?: AnalystClusterEdge[]
}

export interface PANInvestigation {
  pan: string
  companies: CompanyRecord[]
  ird: IRDRecord | null
  directors: DirectorRecord[]
  risk_flags: RiskFlag[]
}

export interface CorporateStats {
  total_companies: number
  companies_with_pan: number
  pan_coverage_pct: number
  camis_enriched_count: number
  ird_enriched_count: number
  ird_enrichment_pct: number
  total_directors: number
  companies_by_type: Record<string, number>
  companies_by_province: Record<string, number>
  top_districts: Record<string, number>
  risk_summary: Record<string, number>
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
  has_more?: boolean
}

export interface CompanySearchParams {
  q?: string
  district?: string
  company_type_category?: string
  has_pan?: boolean
  ird_status?: string
  has_cluster?: boolean
  sort?: string
  sort_dir?: 'asc' | 'desc'
  page?: number
  limit?: number
}

// ── API Functions ──────────────────────────────────────────────

export async function getCorporateStats(): Promise<CorporateStats> {
  const { data } = await apiClient.get('/corporate/stats')
  return data
}

export async function searchCompanies(params: CompanySearchParams): Promise<PaginatedResponse<CompanyRecord>> {
  const { data } = await apiClient.get('/corporate/companies', { params })
  const total = Number(data?.total ?? 0)
  const limit = Number(data?.limit ?? params.limit ?? 50)
  return {
    ...data,
    total,
    limit,
    pages: Math.max(1, Math.ceil(total / Math.max(1, limit))),
  } as PaginatedResponse<CompanyRecord>
}

export async function getCompanyDetail(id: string): Promise<CompanyDetail> {
  const { data } = await apiClient.get(`/corporate/companies/${id}`)
  // Backend returns flat company fields + ird + directors + risk_flags
  return data as CompanyDetail
}

export async function investigatePAN(pan: string): Promise<PANInvestigation> {
  const { data } = await apiClient.get(`/corporate/pan/${pan}`)
  return data
}

export async function getPhoneLinks(companyId: string): Promise<PhoneLinksResponse> {
  const { data } = await apiClient.get(`/corporate/companies/${companyId}/phone-links`)
  return data
}

export async function getSharedDirectors(companyId: string): Promise<DirectorRecord[]> {
  const { data } = await apiClient.get(`/corporate/shared-directors/${companyId}`)
  if (Array.isArray(data)) return data as DirectorRecord[]
  const sharedLinks = Array.isArray(data?.shared_links) ? data.shared_links : []
  return sharedLinks.map((link: any, index: number) => ({
    id: `${companyId}-${link.linked_company_id}-${index}`,
    name_en: link.director_name ?? 'Unknown',
    name_np: null,
    role: link.director_role ?? null,
    source: link.source ?? 'corporate_shared_director',
    confidence: 1,
    pan: link.linked_company_pan ?? null,
    citizenship_no: null,
    appointed_date: null,
    resigned_date: null,
    company_id: link.linked_company_id ?? null,
    company_name: link.linked_company_name ?? null,
  }))
}

export async function getAddressClusters(minCompanies: number = 5): Promise<Array<{ address: string; count: number; companies: CompanyRecord[] }>> {
  const { data } = await apiClient.get('/corporate/address-clusters', { params: { min_companies: minCompanies } })
  const clusters = (data?.clusters ?? data ?? []) as Array<{
    address: string
    count?: number
    company_count?: number
    companies: CompanyRecord[]
  }>
  return clusters.map((cluster) => ({
    address: cluster.address,
    count: cluster.count ?? cluster.company_count ?? 0,
    companies: cluster.companies ?? [],
  }))
}

export async function getPhoneClusters(params: {
  limit?: number
  min_companies?: number
  max_members_per_cluster?: number
} = {}): Promise<PhoneClustersResponse> {
  const firstAttemptParams = {
    limit: params.limit ?? 60,
    min_companies: params.min_companies ?? 2,
    max_members_per_cluster: params.max_members_per_cluster ?? 200,
  }

  try {
    const { data } = await apiClient.get('/corporate/phone-clusters', {
      params: firstAttemptParams,
      timeout: 90_000,
    })
    return data
  } catch (error: any) {
    // Timeout fallback: retry with a smaller payload.
    const fallbackParams = {
      limit: Math.min(firstAttemptParams.limit, 40),
      min_companies: firstAttemptParams.min_companies,
      max_members_per_cluster: Math.min(firstAttemptParams.max_members_per_cluster, 60),
    }
    const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message ?? ''))
    if (!isTimeout) throw error

    const { data } = await apiClient.get('/corporate/phone-clusters', {
      params: fallbackParams,
      timeout: 90_000,
    })
    return data
  }
}

export async function listAnalystClusterGroups(params: {
  only_mine?: boolean
  limit?: number
} = {}): Promise<AnalystClusterGroupListResponse> {
  const { data } = await apiClient.get('/corporate/cluster-groups', {
    params: {
      only_mine: params.only_mine ?? false,
      limit: params.limit ?? 200,
    },
  })
  return {
    items: data?.items ?? [],
    total: Number(data?.total ?? 0),
  }
}

export async function getAnalystClusterGroup(groupId: string): Promise<AnalystClusterGroup> {
  const { data } = await apiClient.get(`/corporate/cluster-groups/${groupId}`)
  return data as AnalystClusterGroup
}

export async function createAnalystClusterGroup(
  payload: AnalystClusterGroupCreatePayload
): Promise<AnalystClusterGroup> {
  const { data } = await apiClient.post('/corporate/cluster-groups', payload)
  return data as AnalystClusterGroup
}

export async function updateAnalystClusterGroup(
  groupId: string,
  payload: AnalystClusterGroupUpdatePayload
): Promise<AnalystClusterGroup> {
  const { data } = await apiClient.patch(`/corporate/cluster-groups/${groupId}`, payload)
  return data as AnalystClusterGroup
}

export async function deleteAnalystClusterGroup(groupId: string): Promise<void> {
  await apiClient.delete(`/corporate/cluster-groups/${groupId}`)
}

export async function getRiskFlags(minSeverity: string = 'MEDIUM'): Promise<RiskFlag[]> {
  const { data } = await apiClient.get('/corporate/risk-flags', { params: { min_severity: minSeverity } })
  const items = Array.isArray(data) ? data : (data?.items ?? [])
  return items.flatMap((entry: any) => {
    const company = entry?.company ?? {}
    const companyFlags = Array.isArray(entry?.risk_flags) ? entry.risk_flags : []
    return companyFlags.map((flag: any) => ({
      company_id: String(company.id ?? ''),
      company_name: company.name_english ?? 'Unknown company',
      pan: company.pan ?? null,
      flag_type: flag.category ?? 'unknown',
      severity: (flag.severity ?? 'LOW') as RiskFlag['severity'],
      description: flag.description ?? '',
    }))
  })
}


// ── Advanced Analytics Types ──────────────────────────────────

export interface BeneficialOwnerCompany {
  id: string
  name_english: string
  pan: string | null
  district: string | null
  role: string | null
}

export interface BeneficialOwner {
  name: string
  citizenship_no: string | null
  total_companies: number
  companies: BeneficialOwnerCompany[]
  match_type: string
}

export interface BeneficialOwnersResponse {
  owners: BeneficialOwner[]
  total: number
}

export interface ShellCompanyScore {
  id: string
  name_english: string
  pan: string | null
  company_address: string | null
  district: string | null
  registration_date_ad: string | null
  score: number
  factors: string[]
}

export interface ShellCompanyScoresResponse {
  companies: ShellCompanyScore[]
  total_scored: number
}

export interface DistrictCompliance {
  district: string
  total: number
  nonfiler_count: number
}

export interface TypeCompliance {
  category: string
  total: number
  nonfiler_count: number
}

export interface TaxComplianceStats {
  total_pans: number
  active_filers: number
  non_filers: number
  cancelled: number
  unknown: number
  status_breakdown: Record<string, number>
  by_district: DistrictCompliance[]
  by_company_type: TypeCompliance[]
}

export interface TopDirector {
  name: string
  citizenship_no: string | null
  company_count: number
}

export interface TopAddress {
  address: string
  district: string | null
  company_count: number
}

export interface PANSharingGroup {
  pan: string
  company_count: number
  company_names: string | null
}

export interface NetworkSummary {
  total_unique_directors: number
  multi_board_directors: number
  total_pan_sharing_groups: number
}

export interface NetworkStats {
  top_directors: TopDirector[]
  top_addresses: TopAddress[]
  pan_sharing_groups: PANSharingGroup[]
  summary: NetworkSummary
}

export interface YearlyRegistration {
  year: number
  count: number
}

export interface MonthlyRegistration {
  year: number
  month: number
  count: number
}

export interface PeakDate {
  date: string | null
  count: number
}

export interface SameDayCluster {
  address: string
  date: string | null
  count: number
}

export interface RegistrationPatterns {
  yearly: YearlyRegistration[]
  monthly: MonthlyRegistration[]
  peak_dates: PeakDate[]
  same_day_clusters: SameDayCluster[]
  anomaly_threshold: number
}


// ── Advanced Analytics API Functions ──────────────────────────

export async function getBeneficialOwners(
  minCompanies: number = 3,
  limit: number = 50,
): Promise<BeneficialOwnersResponse> {
  const { data } = await apiClient.get('/corporate/analytics/beneficial-owners', {
    params: { min_companies: minCompanies, limit },
  })
  return data
}

export async function getShellScores(limit: number = 100): Promise<ShellCompanyScoresResponse> {
  const { data } = await apiClient.get('/corporate/analytics/shell-scores', {
    params: { limit },
  })
  return data
}

export async function getTaxCompliance(): Promise<TaxComplianceStats> {
  const { data } = await apiClient.get('/corporate/analytics/tax-compliance')
  return data
}

export async function getNetworkStats(): Promise<NetworkStats> {
  const { data } = await apiClient.get('/corporate/analytics/network-stats')
  return data
}

export async function getRegistrationPatterns(): Promise<RegistrationPatterns> {
  const { data } = await apiClient.get('/corporate/analytics/registration-patterns')
  return data
}


// ── Timeline ────────────────────────────────────────────────

export interface TimelineBucket {
  period: string
  count: number
}

export interface TimelineResponse {
  items: TimelineBucket[]
  group_by: string
}

export interface TimelineEvent {
  id: string
  content: string
  start: string
  group: string
  type: string
  pan: string | null
}

export async function getRegistrationTimeline(params: {
  group_by?: 'month' | 'year'
  district?: string
  company_type?: string
} = {}): Promise<TimelineResponse> {
  const { data } = await apiClient.get('/corporate/timeline', { params })
  return data
}

export async function getRegistrationEvents(params: {
  start_date?: string
  end_date?: string
  district?: string
  limit?: number
} = {}): Promise<TimelineEvent[]> {
  const { data } = await apiClient.get('/corporate/timeline/events', { params })
  return data
}
