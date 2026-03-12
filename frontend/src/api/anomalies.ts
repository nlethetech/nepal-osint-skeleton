/**
 * Anomaly Detection API client
 * Cross-domain anomaly scanning for investigative analysts
 */
import { apiClient } from './client'

// ── Enums ──────────────────────────────────────────────────────

export type AnomalySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AnomalyType = 'same_day_cluster' | 'rapid_director_change' | 'non_filer_cluster' | 'pan_anomaly'

// ── Base ───────────────────────────────────────────────────────

export interface AnomalyBase {
  type: AnomalyType
  severity: AnomalySeverity
  title: string
  description: string
  entities: string[]
}

// ── Same-Day Clusters ──────────────────────────────────────────

export interface SameDayCompany {
  id: string
  name_english: string
  registration_number: number
  pan: string | null
  company_type_category: string | null
}

export interface SameDayCluster extends AnomalyBase {
  type: 'same_day_cluster'
  registration_date: string
  address: string
  company_count: number
  companies: SameDayCompany[]
}

// ── Rapid Director Changes ─────────────────────────────────────

export interface RapidDirectorChange extends AnomalyBase {
  type: 'rapid_director_change'
  company_id: string
  company_name: string
  director_name: string
  director_role: string | null
  appointed_date: string | null
  resigned_date: string | null
  duration_days: number
}

// ── Non-Filer Clusters ─────────────────────────────────────────

export interface NonFilerClusterCompany {
  id: string
  name_english: string
  pan: string | null
  is_non_filer: boolean
}

export interface NonFilerCluster extends AnomalyBase {
  type: 'non_filer_cluster'
  address: string
  total_companies: number
  non_filer_count: number
  non_filer_pct: number
  companies: NonFilerClusterCompany[]
}

// ── PAN Anomalies ──────────────────────────────────────────────

export interface PANAnomalyCompany {
  id: string
  name_english: string
  registration_number: number
  company_address: string | null
}

export interface PANAnomaly extends AnomalyBase {
  type: 'pan_anomaly'
  pan: string
  company_count: number
  companies: PANAnomalyCompany[]
}

// ── Summary & Full Scan ────────────────────────────────────────

export interface AnomalySummary {
  same_day_clusters: number
  rapid_director_changes: number
  non_filer_clusters: number
  pan_anomalies: number
  total: number
}

export interface AnomalyScanResult {
  summary: AnomalySummary
  same_day_clusters: SameDayCluster[]
  rapid_director_changes: RapidDirectorChange[]
  non_filer_clusters: NonFilerCluster[]
  pan_anomalies: PANAnomaly[]
  scanned_at: string | null
}

// ── API Functions ──────────────────────────────────────────────

export async function getAnomalySummary(): Promise<AnomalySummary> {
  const { data } = await apiClient.get('/anomalies/summary')
  return data
}

export async function getSameDayClusters(minCount: number = 3, limit: number = 100): Promise<SameDayCluster[]> {
  const { data } = await apiClient.get('/anomalies/same-day-clusters', {
    params: { min_count: minCount, limit },
  })
  return data
}

export async function getRapidDirectorChanges(maxDays: number = 90, limit: number = 200): Promise<RapidDirectorChange[]> {
  const { data } = await apiClient.get('/anomalies/rapid-director-changes', {
    params: { max_days: maxDays, limit },
  })
  return data
}

export async function getNonFilerClusters(minPct: number = 60, limit: number = 100): Promise<NonFilerCluster[]> {
  const { data } = await apiClient.get('/anomalies/non-filer-clusters', {
    params: { min_pct: minPct, limit },
  })
  return data
}

export async function getPANAnomalies(minCompanies: number = 5, limit: number = 100): Promise<PANAnomaly[]> {
  const { data } = await apiClient.get('/anomalies/pan-anomalies', {
    params: { min_companies: minCompanies, limit },
  })
  return data
}

export async function runFullScan(): Promise<AnomalyScanResult> {
  const { data } = await apiClient.get('/anomalies/full-scan')
  return data
}
