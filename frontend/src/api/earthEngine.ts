/**
 * Earth Engine API Client
 *
 * Provides access to Google Earth Engine satellite analysis:
 * - Satellite tile proxy (Sentinel-2, NDVI, flood extent, temperature)
 * - Environmental analysis (NDVI, precipitation, temperature)
 * - Disaster detection (flood extent, landslide)
 * - Change detection alerts
 */

import apiClient from './client'

// =============================================================================
// TYPES
// =============================================================================

export interface GEEStatus {
  initialized: boolean
  project_id?: string
  error?: string
}

export interface NDVIResult {
  mean_ndvi: number
  min_ndvi: number
  max_ndvi: number
  anomaly_pct: number
  tile_url_template?: string
  analysis_date: string
  bbox: [number, number, number, number]
}

export interface PrecipitationResult {
  total_mm: number
  mean_daily_mm: number
  max_daily_mm: number
  anomaly_pct: number
  flood_risk_score: number
  daily_values: Array<{ date: string; mm: number }>
  tile_url_template?: string
  start_date: string
  end_date: string
  bbox: [number, number, number, number]
}

export interface TemperatureResult {
  mean_celsius: number
  min_celsius: number
  max_celsius: number
  anomaly_celsius: number
  tile_url_template?: string
  analysis_date: string
  bbox: [number, number, number, number]
}

export interface FloodAnalysisResult {
  flooded_area_km2: number
  water_before_km2: number
  water_after_km2: number
  change_pct: number
  before_image_url?: string
  after_image_url?: string
  tile_url_template?: string
  geojson?: GeoJSON.FeatureCollection | GeoJSON.Feature
  bbox: [number, number, number, number]
  before_date: string
  after_date: string
}

export interface LandslideDetection {
  center: [number, number]
  area_km2: number
  confidence: number
  geojson?: GeoJSON.Feature
}

export interface LandslideAnalysisResult {
  detections: LandslideDetection[]
  total_affected_km2: number
  tile_url_template?: string
  bbox: [number, number, number, number]
  before_date: string
  after_date: string
}

export interface BeforeAfterResult {
  before_image_url: string
  after_image_url: string
  before_date: string
  after_date: string
  bbox: [number, number, number, number]
}

export interface ChangeAlert {
  id: string
  detection_type: 'flood' | 'landslide' | 'vegetation-loss' | 'urban-expansion'
  severity: 'critical' | 'high' | 'medium' | 'low'
  confidence: number
  district?: string
  center: [number, number]
  area_km2: number
  before_image_url?: string
  after_image_url?: string
  difference_tile_url?: string
  detected_at: string
  description: string
  geojson?: GeoJSON.Feature
}

export interface ChangeAlertsResponse {
  alerts: ChangeAlert[]
  total_count: number
  hours_queried: number
}

export interface ChangeSubscription {
  subscription_id: string
  region_type: string
  region_value: string
  detection_types: string[]
  is_active: boolean
  created_at: string
}

export interface TileUrlResponse {
  layer_type: string
  date: string
  url_template: string
  expires_in_seconds: number
}

// =============================================================================
// LAYER TYPES
// =============================================================================

export type SatelliteLayerType =
  | 'sentinel2-rgb'
  | 'sentinel2-false-color'
  | 'ndvi'
  | 'flood-extent'
  | 'temperature'
  | 'precipitation'

export const LAYER_INFO: Record<SatelliteLayerType, { name: string; description: string; legend?: string }> = {
  'sentinel2-rgb': {
    name: 'True Color',
    description: 'Sentinel-2 natural color imagery',
  },
  'sentinel2-false-color': {
    name: 'False Color (NIR)',
    description: 'Near-infrared composite for vegetation analysis',
  },
  'ndvi': {
    name: 'Vegetation (NDVI)',
    description: 'Normalized Difference Vegetation Index',
    legend: '-1 (water) to 1 (dense vegetation)',
  },
  'flood-extent': {
    name: 'Flood Detection',
    description: 'Water/flood detection from SAR',
  },
  'temperature': {
    name: 'Land Temperature',
    description: 'MODIS land surface temperature',
    legend: '°C',
  },
  'precipitation': {
    name: 'Rainfall',
    description: 'CHIRPS precipitation data',
    legend: 'mm',
  },
}

// =============================================================================
// TILE URL BUILDERS
// =============================================================================

/**
 * Get tile URL template for displaying satellite layers on a map.
 * Use this directly with Leaflet TileLayer.
 *
 * @param layerType - Type of satellite layer
 * @param date - Optional date (YYYY-MM-DD)
 * @param bbox - Optional bounding box for analysis layers
 */
export function getTileUrl(
  layerType: SatelliteLayerType,
  date?: string,
  bbox?: string
): string {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (bbox) params.set('bbox', bbox)

  const query = params.toString()
  return `/api/v1/earth-engine/tiles/${layerType}/{z}/{x}/{y}.png${query ? `?${query}` : ''}`
}

// =============================================================================
// STATUS API
// =============================================================================

/**
 * Check GEE service status.
 */
export async function getStatus(): Promise<GEEStatus> {
  const { data } = await apiClient.get<GEEStatus>('/earth-engine/status')
  return data
}

// =============================================================================
// TILE API
// =============================================================================

/**
 * Get tile URL template from backend (for direct GEE tile access).
 * Note: URLs expire after ~1 hour.
 */
export async function getTileUrlTemplate(
  layerType: SatelliteLayerType,
  date?: string,
  bbox?: string
): Promise<TileUrlResponse> {
  const params: Record<string, string> = {}
  if (date) params.date = date
  if (bbox) params.bbox = bbox

  const { data } = await apiClient.get<TileUrlResponse>(
    `/earth-engine/tiles/${layerType}/url`,
    { params }
  )
  return data
}

// =============================================================================
// ENVIRONMENTAL ANALYSIS API
// =============================================================================

export interface NDVIParams {
  bbox: string // "minLng,minLat,maxLng,maxLat"
  date?: string
}

/**
 * Get NDVI (vegetation) analysis for a region.
 */
export async function getNDVI(params: NDVIParams): Promise<NDVIResult> {
  const { data } = await apiClient.get<NDVIResult>('/earth-engine/environmental/ndvi', { params })
  return data
}

export interface PrecipitationParams {
  bbox: string
  start_date: string
  end_date: string
}

/**
 * Get precipitation analysis for a region and date range.
 */
export async function getPrecipitation(params: PrecipitationParams): Promise<PrecipitationResult> {
  const { data } = await apiClient.get<PrecipitationResult>(
    '/earth-engine/environmental/precipitation',
    { params }
  )
  return data
}

export interface TemperatureParams {
  bbox: string
  date?: string
}

/**
 * Get land surface temperature analysis for a region.
 */
export async function getTemperature(params: TemperatureParams): Promise<TemperatureResult> {
  const { data } = await apiClient.get<TemperatureResult>(
    '/earth-engine/environmental/temperature',
    { params }
  )
  return data
}

// =============================================================================
// DISASTER ANALYSIS API
// =============================================================================

export interface FloodAnalysisParams {
  bbox: string
  before_date: string
  after_date: string
}

/**
 * Analyze flood extent between two dates.
 */
export async function analyzeFloodExtent(params: FloodAnalysisParams): Promise<FloodAnalysisResult> {
  const { data } = await apiClient.post<FloodAnalysisResult>(
    '/earth-engine/analysis/flood-extent',
    params
  )
  return data
}

export interface LandslideAnalysisParams {
  bbox: string
  before_date: string
  after_date: string
  sensitivity?: number
}

/**
 * Detect potential landslides between two dates.
 */
export async function detectLandslides(params: LandslideAnalysisParams): Promise<LandslideAnalysisResult> {
  const { data } = await apiClient.post<LandslideAnalysisResult>(
    '/earth-engine/analysis/landslide',
    params
  )
  return data
}

export interface BeforeAfterParams {
  bbox: string
  before_date: string
  after_date: string
}

/**
 * Get before/after comparison imagery URLs.
 */
export async function getBeforeAfter(params: BeforeAfterParams): Promise<BeforeAfterResult> {
  const { data } = await apiClient.get<BeforeAfterResult>(
    '/earth-engine/analysis/before-after',
    { params }
  )
  return data
}

// =============================================================================
// CHANGE DETECTION API
// =============================================================================

export interface ChangeAlertsParams {
  hours?: number
  detection_type?: string
  severity?: string
  district?: string
}

/**
 * Get recent change detection alerts.
 */
export async function getChangeAlerts(params: ChangeAlertsParams = {}): Promise<ChangeAlertsResponse> {
  const { data } = await apiClient.get<ChangeAlertsResponse>(
    '/earth-engine/change-detection/alerts',
    { params }
  )
  return data
}

export interface SubscribeParams {
  region_type: 'bbox' | 'district' | 'polygon'
  region_value: string
  detection_types: ('flood' | 'landslide' | 'vegetation-loss')[]
  sensitivity?: number
  min_area_km2?: number
}

/**
 * Subscribe a region for automated change monitoring.
 */
export async function subscribeChangeDetection(params: SubscribeParams): Promise<ChangeSubscription> {
  const { data } = await apiClient.post<ChangeSubscription>(
    '/earth-engine/change-detection/subscribe',
    params
  )
  return data
}

/**
 * Unsubscribe from change detection.
 */
export async function unsubscribeChangeDetection(subscriptionId: string): Promise<void> {
  await apiClient.delete(`/earth-engine/change-detection/subscribe/${subscriptionId}`)
}

/**
 * Manually trigger a change detection cycle.
 */
export async function triggerChangeDetection(): Promise<{ status: string; message: string }> {
  const { data } = await apiClient.post<{ status: string; message: string }>(
    '/earth-engine/change-detection/run'
  )
  return data
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export const earthEngineApi = {
  // Status
  getStatus,

  // Tiles
  getTileUrl,
  getTileUrlTemplate,

  // Environmental
  getNDVI,
  getPrecipitation,
  getTemperature,

  // Disaster
  analyzeFloodExtent,
  detectLandslides,
  getBeforeAfter,

  // Change Detection
  getChangeAlerts,
  subscribeChangeDetection,
  unsubscribeChangeDetection,
  triggerChangeDetection,

  // Layer info
  LAYER_INFO,
}

export default earthEngineApi
