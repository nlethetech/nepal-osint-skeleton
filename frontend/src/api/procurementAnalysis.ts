import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────

export interface ProcurementSummary {
  total_contracts: number
  total_value_npr: number
  unique_entities: number
  unique_contractors: number
  ocr_match_count: number
  ocr_match_rate: number
  date_range: { earliest: string | null; latest: string | null }
  flagged_pairs_count: number
}

export interface ContractSummary {
  id: string
  project_name: string
  amount: number | null
  date: string | null
  procurement_type: string
}

export interface RiskFlag {
  procuring_entity: string
  contractor_name: string
  risk_score: number
  risk_level: 'critical' | 'high' | 'medium' | 'low'
  contract_count: number
  total_value: number
  budget_pct: number
  flags: string[]
  contracts: ContractSummary[]
}

export interface SameDayAward {
  procuring_entity: string
  award_date: string | null
  contract_count: number
  total_value: number
  contractors: { name: string; amount: number | null; project: string }[]
}

export interface EntityMatrix {
  entities: string[]
  contractors: string[]
  cells: { entity_idx: number; contractor_idx: number; value: number; count: number }[]
}

export interface CompanyInfo {
  name_english: string
  registration_number: number
  registration_date_bs: string | null
  district: string | null
  company_type_category: string | null
  address: string | null
}

export interface OcrMatch {
  contractor_name: string
  match_type: 'exact' | 'fuzzy' | 'none'
  company: CompanyInfo | null
  contract_count: number
  total_value: number
  registration_age_years: number | null
}

export interface ContractorBreakdown {
  name: string
  count: number
  value: number
  pct: number
  ocr_match: CompanyInfo | null
}

export interface FiscalYearBreakdown {
  fiscal_year: string | null
  count: number
  value: number
}

export interface TimelineEvent {
  date: string | null
  contractor?: string
  entity?: string
  amount: number | null
  project: string
}

export interface Flag {
  type: string
  detail: string
  severity: string
}

export interface CaseRef {
  id: string
  title: string
  status: string
}

export interface EntityDrilldown {
  entity: string
  total_contracts: number
  total_value: number
  contractors: ContractorBreakdown[]
  by_year: FiscalYearBreakdown[]
  timeline: TimelineEvent[]
  flags: Flag[]
  existing_cases: CaseRef[]
}

export interface ContractorProfile {
  contractor: string
  total_contracts: number
  total_value: number
  entities: { name: string; count: number; value: number; pct: number }[]
  ocr_match: CompanyInfo | null
  by_year: FiscalYearBreakdown[]
  timeline: TimelineEvent[]
}

export interface CreateCaseResult {
  case_id: string
  title: string
  evidence_count: number
  hypothesis_id: string | null
}

export interface VerificationResult {
  request_id: string
  claim: string
  status: string
}

export interface WatchlistAddResult {
  item_id: string
  watchlist_id: string
}

// ── API Functions ─────────────────────────────────────────

export async function getProcurementSummary(): Promise<ProcurementSummary> {
  const { data } = await apiClient.get('/procurement-analysis/summary')
  return data
}

export async function getRiskFlags(params?: {
  min_contracts?: number
  min_budget_pct?: number
  sort_by?: string
  limit?: number
}): Promise<RiskFlag[]> {
  const { data } = await apiClient.get('/procurement-analysis/risk-flags', { params })
  return data
}

export async function getSameDayAwards(params?: {
  min_same_day?: number
}): Promise<SameDayAward[]> {
  const { data } = await apiClient.get('/procurement-analysis/same-day-awards', { params })
  return data
}

export async function getEntityMatrix(params?: {
  limit_entities?: number
  limit_contractors?: number
}): Promise<EntityMatrix> {
  const { data } = await apiClient.get('/procurement-analysis/entity-matrix', { params })
  return data
}

export async function getOcrCrossRef(params?: {
  limit?: number
}): Promise<OcrMatch[]> {
  const { data } = await apiClient.get('/procurement-analysis/ocr-cross-ref', { params })
  return data
}

export async function getEntityDrilldown(entityName: string): Promise<EntityDrilldown> {
  const { data } = await apiClient.get(`/procurement-analysis/entity/${encodeURIComponent(entityName)}`)
  return data
}

export async function getContractorProfile(contractorName: string): Promise<ContractorProfile> {
  const { data } = await apiClient.get(`/procurement-analysis/contractor/${encodeURIComponent(contractorName)}`)
  return data
}

export async function createInvestigationCase(payload: {
  procuring_entity: string
  contractor_name: string
  flag_data: Record<string, unknown>
  hypothesis_text?: string
}): Promise<CreateCaseResult> {
  const { data } = await apiClient.post('/procurement-analysis/create-case', payload)
  return data
}

export async function requestVerification(payload: {
  procuring_entity: string
  contractor_name: string
  flag_data: Record<string, unknown>
}): Promise<VerificationResult> {
  const { data } = await apiClient.post('/procurement-analysis/request-verification', payload)
  return data
}

export async function addToWatchlist(payload: {
  watchlist_id: string
  item_type: string
  value: string
}): Promise<WatchlistAddResult> {
  const { data } = await apiClient.post('/procurement-analysis/add-to-watchlist', payload)
  return data
}
