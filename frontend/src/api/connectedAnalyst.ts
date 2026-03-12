import { apiClient, API_BASE_URL } from './client';
import type { Case, CaseListResponse } from './collaboration';
import { getCases } from './collaboration';

export interface ProvenanceRef {
  id: string;
  evidence_type: string;
  evidence_id?: string | null;
  source_url?: string | null;
  source_key?: string | null;
  source_name?: string | null;
  source_classification?: string;
  confidence: number;
  excerpt?: string | null;
  metadata?: Record<string, unknown>;
  captured_at?: string | null;
}

export interface GraphObject {
  id: string;
  object_type: string;
  canonical_key: string;
  title: string;
  description?: string | null;
  attributes: Record<string, unknown>;
  confidence: number;
  source_count: number;
  verification_status: string;
  created_at?: string | null;
  updated_at?: string | null;
  provenance_refs?: ProvenanceRef[];
}

export interface GraphLink {
  id: string;
  source_object_id: string;
  target_object_id: string;
  predicate: string;
  confidence: number;
  source_count: number;
  verification_status: string;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  metadata?: Record<string, unknown>;
  provenance_refs?: ProvenanceRef[];
}

export interface GraphNeighbor {
  neighbor: GraphObject;
  link: GraphLink;
}

export interface GraphTimelineEvent {
  event_type: string;
  timestamp?: string | null;
  title: string;
  object_id?: string;
  link_id?: string;
  confidence?: number;
  source_count?: number;
  verification_status?: string;
  provenance_refs?: ProvenanceRef[];
}

export interface TradeAnomaly {
  id: string;
  dimension: string;
  dimension_key: string;
  fiscal_year_bs: string;
  month_ordinal: number;
  anomaly_score: number;
  observed_value: number;
  expected_value?: number | null;
  deviation_pct?: number | null;
  severity: string;
  verification_status: string;
  source_count: number;
  confidence: number;
}

export interface TradeWorkbenchSummary {
  fiscal_year_bs: string;
  upto_month: string;
  month_ordinal: number;
  imports_total_npr_thousands: number;
  exports_total_npr_thousands: number;
  trade_balance_npr_thousands: number;
  anomaly_count: number;
}

export interface TradeWorkbenchTopItem {
  key: string;
  value_npr_thousands: number;
}

export interface TradeWorkbenchDrillRow {
  id: string;
  report_id: string;
  fiscal_year_bs: string;
  upto_month: string;
  month_ordinal: number;
  table_name: string;
  direction: string;
  hs_code?: string | null;
  commodity_description?: string | null;
  partner_country?: string | null;
  customs_office?: string | null;
  value_npr_thousands: number;
  cumulative_value_npr_thousands?: number | null;
  delta_value_npr_thousands?: number | null;
}

export interface TradeWorkbenchSeriesItem {
  fiscal_year_bs: string;
  month_ordinal: number;
  upto_month: string;
  direction: string;
  value_npr_thousands: number;
  delta_value_npr_thousands?: number | null;
}

export interface TradeWorkbenchHsAggregateRow {
  hs_code: string;
  commodity_description?: string | null;
  imports_npr_thousands: number;
  exports_npr_thousands: number;
  total_value_npr_thousands: number;
  fact_count: number;
}

export interface AnalystAOI {
  id: string;
  name: string;
  owner_user_id: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  geometry?: Record<string, unknown> | null;
  tags: string[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PwttRunSummary {
  id: string;
  case_id?: string | null;
  algorithm_name: string;
  algorithm_version: string;
  status: string;
  confidence?: number | null;
  source_count: number;
  artifacts_count: number;
  findings_count: number;
  verification_status: string;
  created_at?: string | null;
}

export interface PwttRunDetail {
  id: string;
  assessment_id?: string | null;
  case_id?: string | null;
  algorithm_name: string;
  algorithm_version: string;
  status: string;
  aoi_geojson?: Record<string, unknown> | null;
  event_date?: string | null;
  run_params: Record<string, unknown>;
  summary: Record<string, unknown>;
  confidence?: number | null;
  source_count: number;
  verification_status: string;
  artifacts: PwttArtifact[];
  findings: Array<{
    id: string;
    finding_type: string;
    title?: string | null;
    severity: string;
    confidence: number;
    district?: string | null;
    customs_office?: string | null;
    route_name?: string | null;
    geometry?: Record<string, unknown> | null;
    metrics?: Record<string, unknown> | null;
    verification_status: string;
  }>;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PwttArtifact {
  id: string;
  artifact_type: string;
  file_path: string;
  checksum_sha256?: string | null;
  mime_type?: string | null;
  source_classification: string;
  metadata?: Record<string, unknown>;
}

export interface PwttFinding {
  id: string;
  finding_type: string;
  title?: string | null;
  severity: string;
  confidence: number;
  district?: string | null;
  customs_office?: string | null;
  route_name?: string | null;
  geometry?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  verification_status: string;
  source_count?: number;
  provenance_refs?: ProvenanceRef[];
}

export interface Hypothesis {
  id: string;
  case_id: string;
  statement: string;
  status: string;
  confidence: number;
  rationale?: string | null;
  source_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AutonomousPaperCitation {
  source_id: string;
  source_name?: string | null;
  source_url?: string | null;
  source_type: string;
  source_classification: string;
  published_at?: string | null;
  confidence?: number | null;
  excerpt?: string | null;
}

export interface AutonomousPwttImage {
  run_id: string;
  artifact_id: string;
  artifact_type: string;
  label: string;
  image_url: string;
  mime_type?: string | null;
  source_classification: string;
}

export interface AutonomousPwttBuildingDamage {
  reported_buildings_affected?: number | null;
  building_metric_total?: number | null;
  building_signal_count: number;
  damaged_area_km2?: number | null;
  avg_damage_percentage?: number | null;
  note?: string | null;
}

export interface AutonomousPwttEvidence {
  run_count: number;
  finding_count: number;
  three_panel_images: AutonomousPwttImage[];
  runs: Array<{
    run_id: string;
    algorithm_name: string;
    algorithm_version: string;
    confidence?: number | null;
    created_at?: string | null;
    status: string;
  }>;
  building_damage: AutonomousPwttBuildingDamage;
}

export interface AutonomousPaper {
  paper_key: string;
  title: string;
  generated_at: string;
  highlights: string[];
  metrics: Record<string, unknown>;
  pwtt_evidence?: AutonomousPwttEvidence;
  markdown: string;
  citations: AutonomousPaperCitation[];
}

export interface AutonomousPapersResponse {
  generated_at: string;
  hours_window: number;
  report_ids?: string[];
  singha_durbar_query: {
    center_lat: number;
    center_lng: number;
    radius_km: number;
  };
  warnings: string[];
  papers: AutonomousPaper[];
}

export interface AutonomousCorePaperListItem {
  id: string;
  report_type: string;
  title: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
  time_window_hours: number;
  generated_with_llm: boolean;
  citations_count: number;
  highlights: string[];
  metrics_preview: Record<string, unknown>;
}

export interface AutonomousCorePaperListResponse {
  items: AutonomousCorePaperListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AutonomousCorePapersSummary {
  total_reports: number;
  by_report_type: Record<string, number>;
  generated_last_24h: number;
  generated_last_7d: number;
  last_generated_at?: string | null;
}

export async function searchGraphObjects(params: {
  q?: string;
  object_type?: string[];
  limit?: number;
  offset?: number;
}): Promise<{ items: GraphObject[]; total: number; limit: number; offset: number }> {
  const { data } = await apiClient.get('/graph/objects/search', { params });
  return data;
}

export async function getGraphObject(objectId: string): Promise<GraphObject> {
  const { data } = await apiClient.get(`/graph/objects/${objectId}`);
  return data;
}

export async function getGraphNeighbors(objectId: string, limit = 100): Promise<{ center: GraphObject; neighbors: GraphNeighbor[] }> {
  const { data } = await apiClient.get(`/graph/objects/${objectId}/neighbors`, { params: { limit } });
  return data;
}

export async function getGraphTimeline(objectId: string, limit = 100): Promise<{ center: { id: string; title: string; object_type: string }; events: GraphTimelineEvent[]; total: number }> {
  const { data } = await apiClient.get(`/graph/objects/${objectId}/timeline`, { params: { limit } });
  return data;
}

export async function runTradeIngest(dataRoot = 'trade_data'): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post('/trade/ingest/run', { data_root: dataRoot });
  return data;
}

export async function uploadTradeFiles(files: File[]): Promise<Record<string, unknown>> {
  const formData = new FormData();
  files.forEach((item) => formData.append('files', item));
  const { data } = await apiClient.post('/trade/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function recomputeTradeMetrics(fiscalYearBs?: string): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post('/trade/recompute', { fiscal_year_bs: fiscalYearBs ?? null });
  return data;
}

export async function getTradeAnomalies(params?: {
  dimension?: string;
  dimension_key?: string;
  fiscal_year_bs?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: TradeAnomaly[]; total: number; limit: number; offset: number }> {
  const { data } = await apiClient.get('/trade/anomalies', { params });
  return data;
}

export async function getTradeWorkbenchSummary(params?: {
  fiscal_year_bs?: string;
  month_ordinal?: number;
}): Promise<{
  summary: TradeWorkbenchSummary | null;
  top_customs: TradeWorkbenchTopItem[];
  top_partners: TradeWorkbenchTopItem[];
  top_hs_codes: TradeWorkbenchTopItem[];
}> {
  const { data } = await apiClient.get('/trade/workbench/summary', { params });
  return data;
}

export async function getTradeWorkbenchDrilldown(params?: {
  fiscal_year_bs?: string;
  direction?: string;
  hs_code?: string;
  partner_country?: string;
  customs_office?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: TradeWorkbenchDrillRow[]; total: number; limit: number; offset: number }> {
  const { data } = await apiClient.get('/trade/workbench/drilldown', { params });
  return data;
}

export async function getTradeWorkbenchSeries(params: {
  dimension: string;
  dimension_key: string;
  direction?: string;
  fiscal_year_bs?: string;
}): Promise<{
  dimension: string;
  dimension_key: string;
  items: TradeWorkbenchSeriesItem[];
  anomalies: TradeAnomaly[];
}> {
  const { data } = await apiClient.get('/trade/workbench/series', { params });
  return data;
}

export async function getTradeWorkbenchHsAggregation(params?: {
  fiscal_year_bs?: string;
  direction?: string;
  partner_country?: string;
  customs_office?: string;
  hs_prefix?: string;
  sort_by?: string;
  sort_direction?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  items: TradeWorkbenchHsAggregateRow[];
  total: number;
  limit: number;
  offset: number;
  coverage: {
    rows_scanned: number;
    hs_codes_total: number;
    has_more: boolean;
  };
}> {
  const { data } = await apiClient.get('/trade/workbench/hs-aggregation', { params });
  return data;
}

export async function getPwttRuns(params?: { limit?: number; offset?: number }): Promise<{ items: PwttRunSummary[]; total: number; limit: number; offset: number }> {
  const { data } = await apiClient.get('/pwtt/runs', { params });
  return data;
}

export async function listPwttAois(limit = 100): Promise<{ items: AnalystAOI[]; total: number }> {
  const { data } = await apiClient.get('/pwtt/aois', { params: { limit } });
  return data;
}

export async function createPwttAoi(payload: {
  name: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  geometry?: Record<string, unknown>;
  tags?: string[];
}): Promise<AnalystAOI> {
  const { data } = await apiClient.post('/pwtt/aois', payload);
  return data;
}

export async function getPwttRun(runId: string): Promise<PwttRunDetail> {
  const { data } = await apiClient.get(`/pwtt/runs/${runId}`);
  return data as PwttRunDetail;
}

export async function getPwttThreePanel(runId: string): Promise<{ run_id: string; items: PwttArtifact[]; total: number }> {
  const { data } = await apiClient.get(`/pwtt/runs/${runId}/three-panel`);
  return data;
}

export function getPwttArtifactStreamUrl(runId: string, artifactId: string): string {
  return `${API_BASE_URL}/pwtt/runs/${runId}/artifacts/${artifactId}/stream`;
}

export function getPwttArtifactDisplayUrl(runId: string, artifact: PwttArtifact): string {
  const rawPath = (artifact.file_path || '').trim();
  const apiRoot = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

  if (!rawPath) {
    return getPwttArtifactStreamUrl(runId, artifact.id);
  }

  if (/^https?:\/\//i.test(rawPath)) {
    return rawPath;
  }

  if (rawPath.startsWith('/api/')) {
    return `${apiRoot}${rawPath}`;
  }

  if (
    rawPath.startsWith('/Users/') ||
    rawPath.startsWith('/tmp/') ||
    rawPath.startsWith('/var/') ||
    rawPath.startsWith('/home/')
  ) {
    return getPwttArtifactStreamUrl(runId, artifact.id);
  }

  if (rawPath.startsWith('/')) {
    return `${apiRoot}${rawPath}`;
  }

  return getPwttArtifactStreamUrl(runId, artifact.id);
}

export async function getPwttFindings(runId: string): Promise<{ run_id: string; items: PwttFinding[]; total: number }> {
  const { data } = await apiClient.get(`/pwtt/runs/${runId}/findings`);
  return data;
}

export async function createPwttRun(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post('/pwtt/runs', payload);
  return data;
}

export async function attachPwttRunToCase(runId: string, payload: { case_id: string; include_findings?: boolean }): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post(`/pwtt/runs/${runId}/attach-to-case`, payload);
  return data;
}

export async function listHypotheses(caseId: string): Promise<{ items: Hypothesis[]; total: number }> {
  const { data } = await apiClient.get(`/cases/${caseId}/hypotheses`);
  return data;
}

export async function createHypothesis(caseId: string, payload: { statement: string; confidence?: number; rationale?: string }): Promise<Hypothesis> {
  const { data } = await apiClient.post(`/cases/${caseId}/hypotheses`, payload);
  return data;
}

export async function updateHypothesis(caseId: string, hypothesisId: string, payload: { statement?: string; status?: string; confidence?: number; rationale?: string }): Promise<Hypothesis> {
  const { data } = await apiClient.patch(`/cases/${caseId}/hypotheses/${hypothesisId}`, payload);
  return data;
}

export async function attachHypothesisEvidence(
  caseId: string,
  hypothesisId: string,
  payload: {
    evidence_ref_id?: string;
    relation_type?: string;
    weight?: number;
    notes?: string;
    evidence_type?: string;
    source_name?: string;
    source_url?: string;
    source_classification?: string;
    confidence?: number;
    excerpt?: string;
  },
): Promise<Record<string, unknown>> {
  const { data } = await apiClient.post(`/cases/${caseId}/hypotheses/${hypothesisId}/evidence`, payload);
  return data;
}

export async function listCases(limit = 50): Promise<Case[]> {
  const response: CaseListResponse = await getCases({ limit });
  return response.items;
}

export async function generateAutonomousCorePapers(payload?: {
  hours?: number;
  singha_center_lat?: number;
  singha_center_lng?: number;
  singha_radius_km?: number;
  use_llm?: boolean;
}): Promise<AutonomousPapersResponse> {
  const { data } = await apiClient.post('/reports/autonomous/core-papers', payload ?? {});
  return data;
}

export async function getAutonomousCorePaper(reportId: string): Promise<Record<string, unknown>> {
  const { data } = await apiClient.get(`/reports/autonomous/core-papers/${reportId}`);
  return data;
}

export async function listAutonomousCorePapers(params?: {
  limit?: number;
  offset?: number;
  report_type?: string;
  generated_by?: string;
  generated_by_me?: boolean;
  created_after?: string;
  created_before?: string;
}): Promise<AutonomousCorePaperListResponse> {
  const { data } = await apiClient.get('/reports/autonomous/core-papers', { params });
  return data;
}

export async function getAutonomousCorePapersSummary(params?: {
  report_type?: string;
  generated_by?: string;
  generated_by_me?: boolean;
  created_after?: string;
  created_before?: string;
}): Promise<AutonomousCorePapersSummary> {
  const { data } = await apiClient.get('/reports/autonomous/core-papers/summary', { params });
  return data;
}
