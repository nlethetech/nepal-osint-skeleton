/**
 * Damage Assessment API Client
 *
 * Provides functions for interacting with the damage assessment backend:
 * - Assessment CRUD
 * - PWTT damage detection
 * - Zones, evidence, and notes management
 */

import axios from 'axios';
import { useAuthStore } from '../store/slices/authSlice';

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const EXPLICIT_API_BASE = (import.meta.env.VITE_API_URL || '').trim();

function normalizeBase(rawBase: string): string {
  const trimmed = rawBase.trim();

  if (!trimmed) {
    if (typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname)) {
      return 'http://localhost:8000';
    }
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (withoutTrailingSlash.endsWith('/api/v1')) {
    return withoutTrailingSlash.slice(0, -7);
  }
  if (withoutTrailingSlash.endsWith('/api')) {
    return withoutTrailingSlash.slice(0, -4);
  }
  return withoutTrailingSlash;
}

const API_BASE = normalizeBase(EXPLICIT_API_BASE);

const api = axios.create({
  baseURL: `${API_BASE}/api/v1/damage-assessment`,
});

// Add auth token to requests (using same pattern as main client.ts)
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DamageType =
  | 'structural'
  | 'infrastructure'
  | 'environmental'
  | 'civil_unrest'
  | 'natural_disaster'
  | 'fire'
  | 'industrial';

export type SeverityLevel = 'critical' | 'severe' | 'moderate' | 'minor' | 'safe';

export type AssessmentStatus = 'draft' | 'in_progress' | 'completed' | 'verified' | 'archived';

export type EvidenceSourceType =
  | 'satellite'
  | 'story'
  | 'social_media'
  | 'government'
  | 'ground_report'
  | 'photo'
  | 'video';

export interface Assessment {
  id: string;
  event_name: string;
  event_type: DamageType;
  event_date: string;
  event_description?: string;
  status: AssessmentStatus;
  bbox: [number, number, number, number];
  center_lat: number;
  center_lng: number;
  districts?: string[];
  total_area_km2?: number;
  damaged_area_km2?: number;
  damage_percentage?: number;
  critical_area_km2?: number;
  severe_area_km2?: number;
  moderate_area_km2?: number;
  minor_area_km2?: number;
  confidence_score?: number;
  affected_population?: number;
  displaced_estimate?: number;
  buildings_affected?: number;
  roads_damaged_km?: number;
  bridges_affected?: number;
  key_findings?: string[];
  tags?: string[];
  damage_tile_url?: string;
  t_stat_tile_url?: string;  // Raw t-statistic heatmap (PWTT)
  before_tile_url?: string;
  after_tile_url?: string;
  before_sar_tile_url?: string;
  after_sar_tile_url?: string;
  baseline_images_count?: number;
  post_images_count?: number;
  // Date range fields for PWTT analysis
  baseline_start?: string;
  baseline_end?: string;
  post_event_start?: string;
  post_event_end?: string;
  created_at: string;
  updated_at: string;
}

export interface DamageZone {
  id: string;
  zone_name?: string;
  zone_type: string;
  geometry?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  centroid_lat: number;
  centroid_lng: number;
  area_km2: number;
  severity: SeverityLevel;
  damage_percentage: number;
  confidence: number;
  land_use?: string;
  building_type?: string;
  satellite_detected: boolean;
  ground_verified: boolean;
  created_at: string;
}

export interface Evidence {
  id: string;
  source_type: EvidenceSourceType;
  evidence_type: string;
  source_id?: string;
  zone_id?: string;
  source_name?: string;
  title?: string;
  excerpt?: string;
  source_url?: string;
  timestamp?: string;
  confidence: number;
  verification_status: string;
  auto_linked: boolean;
  added_at?: string;
  created_at: string;
}

export interface AssessmentNote {
  id: string;
  note_type: string;
  content: string;
  status: string;
  author_id: string;
  zone_id?: string;
  created_at: string;
}

export interface PWTTResult {
  analysis_id: string;
  total_area_km2: number;
  damaged_area_km2: number;
  damage_percentage: number;
  critical_area_km2: number;
  severe_area_km2: number;
  moderate_area_km2: number;
  minor_area_km2: number;
  confidence_score: number;
  baseline_images_count: number;
  post_images_count: number;
  damage_tile_url?: string;
  t_stat_tile_url?: string;
  before_rgb_tile_url?: string;
  after_rgb_tile_url?: string;
  before_sar_tile_url?: string;
  after_sar_tile_url?: string;
  error?: string;
}

export interface AssessmentStats {
  total_zones: number;
  zones_by_severity: {
    critical: number;
    severe: number;
    moderate: number;
    minor: number;
  };
  total_evidence: number;
  verified_evidence: number;
  total_notes: number;
  open_notes: number;
  ground_verified_zones: number;
}

export interface CreateAssessmentParams {
  event_name: string;
  event_type: DamageType;
  event_date: string;
  bbox: [number, number, number, number];
  center_lat?: number;
  center_lng?: number;
  event_description?: string;
  districts?: string[];
  tags?: string[];
  baseline_start?: string;
  baseline_end?: string;
  post_event_start?: string;
  post_event_end?: string;
}

export interface ListAssessmentsParams {
  event_type?: DamageType;
  status?: AssessmentStatus;
  district?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSESSMENT API
// ═══════════════════════════════════════════════════════════════════════════════

export async function listAssessments(
  params: ListAssessmentsParams = {}
): Promise<{ items: Assessment[]; total: number }> {
  const { data } = await api.get('/assessments', { params });
  return data;
}

export async function getAssessment(
  id: string,
  includeZones = false
): Promise<Assessment & { zones?: DamageZone[] }> {
  const { data } = await api.get(`/assessments/${id}`, {
    params: { include_zones: includeZones },
  });
  return data;
}

export async function createAssessment(params: CreateAssessmentParams): Promise<Assessment> {
  const { data } = await api.post('/assessments', params);
  return data;
}

export async function updateAssessment(
  id: string,
  params: Partial<Assessment>
): Promise<Assessment> {
  const { data } = await api.put(`/assessments/${id}`, params);
  return data;
}

export async function deleteAssessment(id: string): Promise<void> {
  await api.delete(`/assessments/${id}`);
}

export async function verifyAssessment(id: string): Promise<Assessment> {
  const { data } = await api.post(`/assessments/${id}/verify`);
  return data;
}

export async function getAssessmentStats(id: string): Promise<AssessmentStats> {
  const { data } = await api.get(`/assessments/${id}/stats`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PWTT ANALYSIS API
// Uses oballinger/PWTT algorithm: https://github.com/oballinger/PWTT
// Recommended: 12-month baseline (365 days), 2-month post-event (60 days)
// ═══════════════════════════════════════════════════════════════════════════════

export async function runPWTTAnalysis(
  assessmentId: string,
  baselineDays = 365,  // 12 months baseline (PWTT default)
  postEventDays = 60   // 2 months post-event (PWTT default)
): Promise<PWTTResult> {
  const { data } = await api.post(`/assessments/${assessmentId}/run-pwtt`, {
    baseline_days: baselineDays,
    post_event_days: postEventDays,
  });
  return data;
}

export interface BuildingDetectionResult {
  message: string;
  buildings_detected: number;
  severity_breakdown: {
    critical: number;
    severe: number;
    moderate: number;
    minor: number;
  };
  zones: DamageZone[];
}

export async function detectBuildings(
  assessmentId: string,
  maxBuildings = 50,
  minAreaM2 = 150
): Promise<BuildingDetectionResult> {
  const { data } = await api.post(
    `/assessments/${assessmentId}/detect-buildings?max_buildings=${maxBuildings}&min_area_m2=${minAreaM2}`
  );
  return data;
}

export interface AnalyzePolygonParams {
  geometry: GeoJSON.Polygon;
  baseline_days?: number;
  post_event_days?: number;
}

export async function analyzePolygon(
  assessmentId: string,
  params: AnalyzePolygonParams
): Promise<PWTTResult> {
  const { data } = await api.post(`/assessments/${assessmentId}/analyze-polygon`, {
    geometry: params.geometry,
    baseline_days: params.baseline_days || 365,   // 12 months baseline (PWTT default)
    post_event_days: params.post_event_days || 60, // 2 months post-event (PWTT default)
  });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZONES API
// ═══════════════════════════════════════════════════════════════════════════════

export async function listZones(
  assessmentId: string,
  params?: { severity?: SeverityLevel; zone_type?: string }
): Promise<DamageZone[]> {
  const { data } = await api.get(`/assessments/${assessmentId}/zones`, { params });
  return data;
}

export interface CreateZoneParams {
  geometry: GeoJSON.Polygon;
  centroid_lat: number;
  centroid_lng: number;
  area_km2: number;
  severity: SeverityLevel;
  damage_percentage: number;
  confidence?: number;
  zone_name?: string;
  zone_type?: string;
  land_use?: string;
  building_type?: string;
}

export async function createZone(
  assessmentId: string,
  params: CreateZoneParams
): Promise<DamageZone> {
  const { data } = await api.post(`/assessments/${assessmentId}/zones`, params);
  return data;
}

export async function verifyZone(
  assessmentId: string,
  zoneId: string,
  notes?: string
): Promise<DamageZone> {
  const { data } = await api.put(`/assessments/${assessmentId}/zones/${zoneId}/verify`, null, {
    params: { verification_notes: notes },
  });
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVIDENCE API
// ═══════════════════════════════════════════════════════════════════════════════

export async function listEvidence(
  assessmentId: string,
  params?: {
    source_type?: EvidenceSourceType;
    zone_id?: string;
    verification_status?: string;
  }
): Promise<Evidence[]> {
  const { data } = await api.get(`/assessments/${assessmentId}/evidence`, { params });
  return data;
}

export interface AddEvidenceParams {
  source_type: EvidenceSourceType;
  evidence_type: string;
  zone_id?: string;
  source_id?: string;
  source_url?: string;
  source_name?: string;
  title?: string;
  excerpt?: string;
  timestamp?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export async function addEvidence(
  assessmentId: string,
  params: AddEvidenceParams
): Promise<Evidence> {
  const { data } = await api.post(`/assessments/${assessmentId}/evidence`, params);
  return data;
}

export async function verifyEvidence(
  assessmentId: string,
  evidenceId: string,
  status: 'verified' | 'disputed' | 'retracted',
  notes?: string
): Promise<Evidence> {
  const { data } = await api.put(
    `/assessments/${assessmentId}/evidence/${evidenceId}/verify`,
    null,
    { params: { status, notes } }
  );
  return data;
}

// Alias for listEvidence - used by EvidenceTab
export const getAssessmentEvidence = listEvidence;

// Auto-link OSINT stories to damage zones
export async function linkStories(assessmentId: string): Promise<{ linked_count: number }> {
  const { data } = await api.post(`/assessments/${assessmentId}/evidence/link-stories`);
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES API
// ═══════════════════════════════════════════════════════════════════════════════

export async function listNotes(
  assessmentId: string,
  params?: { note_type?: string; status?: string }
): Promise<AssessmentNote[]> {
  const { data } = await api.get(`/assessments/${assessmentId}/notes`, { params });
  return data;
}

export async function addNote(
  assessmentId: string,
  content: string,
  noteType = 'observation',
  zoneId?: string
): Promise<AssessmentNote> {
  const { data } = await api.post(`/assessments/${assessmentId}/notes`, {
    content,
    note_type: noteType,
    zone_id: zoneId,
  });
  return data;
}

export async function resolveNote(
  assessmentId: string,
  noteId: string,
  resolutionNotes?: string
): Promise<AssessmentNote> {
  const { data } = await api.put(
    `/assessments/${assessmentId}/notes/${noteId}/resolve`,
    null,
    { params: { resolution_notes: resolutionNotes } }
  );
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK HOTSPOT CHECKER API - Draw circle on map and analyze
// ═══════════════════════════════════════════════════════════════════════════════

export interface QuickAnalyzeParams {
  center_lat: number;
  center_lng: number;
  radius_km: number;
  event_date: string;
  baseline_days?: number;
  post_event_days?: number;
}

export interface QuickAnalyzeResult {
  center_lat: number;
  center_lng: number;
  radius_km: number;
  event_date: string;
  total_area_km2: number;
  damaged_area_km2: number;
  damage_percentage: number;
  critical_area_km2: number;
  severe_area_km2: number;
  moderate_area_km2: number;
  minor_area_km2: number;
  confidence_score: number;
  baseline_images_count: number;
  post_images_count: number;
  damage_tile_url?: string;
  t_stat_tile_url?: string;
  before_tile_url?: string;
  after_tile_url?: string;
  before_sar_tile_url?: string;
  after_sar_tile_url?: string;
  building_damage_geojson?: BuildingDamageFeature[];
  error?: string;
  bbox: [number, number, number, number];
}

export interface BuildingDamageFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    mean_t_stat: number;
    max_t_stat: number;
    severity: 'undamaged' | 'moderate' | 'severe' | 'critical';
    centroid_lat: number;
    centroid_lng: number;
    area_m2: number;
  };
}

/**
 * Quick Hotspot Checker - Analyze damage at any point on the map.
 *
 * Usage:
 * 1. Click anywhere on the map to set center point
 * 2. Adjust radius (0.1 - 5.0 km)
 * 3. Set event date
 * 4. Get instant PWTT damage analysis
 */
export async function quickAnalyze(params: QuickAnalyzeParams): Promise<QuickAnalyzeResult> {
  const { data } = await api.post('/quick-analyze', {
    ...params,
    baseline_days: params.baseline_days || 365,
    post_event_days: params.post_event_days || 60,
  });
  return data;
}

export interface ThreePanelImageParams {
  center_lat: number;
  center_lng: number;
  radius_km: number;
  event_date: string;
  baseline_days?: number;
  post_event_days?: number;
}

/**
 * Get the URL for the 3-panel PWTT image endpoint.
 *
 * Note: This returns a URL without auth. For authenticated access,
 * use fetchThreePanelImage() instead which sends the auth token.
 */
export function getThreePanelImageUrl(params: ThreePanelImageParams): string {
  const queryParams = new URLSearchParams({
    center_lat: params.center_lat.toString(),
    center_lng: params.center_lng.toString(),
    radius_km: params.radius_km.toString(),
    event_date: params.event_date,
    baseline_days: (params.baseline_days || 365).toString(),
    post_event_days: (params.post_event_days || 60).toString(),
  });

  const baseUrl = `${API_BASE}/api/v1/damage-assessment/quick-analyze/three-panel`;
  return `${baseUrl}?${queryParams.toString()}`;
}

/**
 * Fetch the 3-panel image as a Blob for download or display.
 */
export async function fetchThreePanelImage(params: ThreePanelImageParams): Promise<Blob> {
  const response = await api.get('/quick-analyze/three-panel', {
    params: {
      center_lat: params.center_lat,
      center_lng: params.center_lng,
      radius_km: params.radius_km,
      event_date: params.event_date,
      baseline_days: params.baseline_days || 365,
      post_event_days: params.post_event_days || 60,
    },
    responseType: 'blob',
  });

  const contentType = (response.headers?.['content-type'] as string | undefined) || '';
  if (!contentType.includes('image/')) {
    let snippet = '';
    try {
      const maybeText = typeof response.data?.text === 'function' ? await response.data.text() : '';
      if (maybeText) snippet = `: ${maybeText.slice(0, 400)}`;
    } catch {
      // Ignore parse failures; still throw a useful error below.
    }
    throw new Error(`Three-panel endpoint did not return an image (content-type=${contentType || 'unknown'})${snippet}`);
  }

  return response.data;
}


// ═══════════════════════════════════════════════════════════════════════════════
// METADATA API
// ═══════════════════════════════════════════════════════════════════════════════

export interface MetaOption {
  value: string;
  label: string;
  color?: string;
  description?: string;
}

export async function getDamageTypes(): Promise<MetaOption[]> {
  const { data } = await api.get('/meta/damage-types');
  return data;
}

export async function getSeverityLevels(): Promise<MetaOption[]> {
  const { data } = await api.get('/meta/severity-levels');
  return data;
}

export async function getAssessmentStatuses(): Promise<MetaOption[]> {
  const { data } = await api.get('/meta/assessment-statuses');
  return data;
}

export async function getEvidenceSources(): Promise<MetaOption[]> {
  const { data } = await api.get('/meta/evidence-sources');
  return data;
}
