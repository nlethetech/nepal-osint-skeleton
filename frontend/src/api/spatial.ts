/**
 * Spatial Analysis API Client
 *
 * Provides access to spatial analysis endpoints:
 * - KML/KMZ export for Google Earth
 * - Network Link for live data feeds
 * - Hotspot detection
 * - Proximity queries
 * - Temporal-spatial animation data
 */

import apiClient from './client'

// =============================================================================
// TYPES
// =============================================================================

export interface HotspotCluster {
  cluster_id: number
  centroid: [number, number] // [lng, lat]
  member_count: number
  events: string[]
  bounding_box: [number, number, number, number] // [min_lng, min_lat, max_lng, max_lat]
  dominant_category: string
  severity_breakdown: Record<string, number>
  districts: string[]
  time_range: { earliest: string; latest: string }
  density_score: number
}

export interface HotspotResponse {
  clusters: HotspotCluster[]
  total_events_analyzed: number
  clustered_events: number
  noise_events: number
  parameters: {
    eps_km: number
    min_samples: number
  }
}

export interface ProximityEvent {
  id: string
  title: string
  category: string
  severity: string
  timestamp?: string
  coordinates: [number, number]
  distance_km: number
  bearing_deg: number
  direction: string
  district?: string
}

export interface ProximityResponse {
  center: [number, number]
  radius_km: number
  events: ProximityEvent[]
  total_found: number
  nearest_event?: ProximityEvent
  farthest_event?: ProximityEvent
}

export interface TemporalBucket {
  bucket_start: string
  bucket_end: string
  events: Array<{
    id: string
    title: string
    category: string
    severity: string
    coordinates: [number, number]
    district?: string
  }>
  event_count: number
  centroid?: [number, number]
  new_districts: string[]
}

export interface PropagationMetrics {
  initial_centroid: [number, number]
  final_centroid: [number, number]
  spread_distance_km: number
  spread_direction: string
  bearing_deg: number
  max_extent_km: number
  affected_area_sq_km: number
  total_districts_affected: number
  districts: string[]
}

export interface TemporalSpatialResponse {
  buckets: TemporalBucket[]
  time_range: { start: string; end: string }
  total_events: number
  bucket_hours: number
  propagation?: PropagationMetrics
}

// =============================================================================
// EXPORT URL BUILDERS
// =============================================================================

export interface KMLExportParams {
  hours?: number
  categories?: string
  severities?: string
  districts?: string
  format?: 'kml' | 'kmz'
}

export interface NetworkLinkParams {
  refresh_interval?: number
  hours?: number
  categories?: string
  severities?: string
}

/**
 * Get URL for downloading KML/KMZ export.
 * Use this URL directly for download (e.g., window.open(url)).
 */
export function getKMLExportUrl(params: KMLExportParams = {}): string {
  const searchParams = new URLSearchParams()
  if (params.hours) searchParams.set('hours', String(params.hours))
  if (params.categories) searchParams.set('categories', params.categories)
  if (params.severities) searchParams.set('severities', params.severities)
  if (params.districts) searchParams.set('districts', params.districts)
  if (params.format) searchParams.set('format', params.format)

  const query = searchParams.toString()
  return `/api/v1/spatial/export/kml${query ? `?${query}` : ''}`
}

/**
 * Get URL for Google Earth Network Link.
 * Copy this URL and paste into Google Earth's "Add Network Link" dialog.
 */
export function getNetworkLinkUrl(params: NetworkLinkParams = {}): string {
  const searchParams = new URLSearchParams()
  if (params.refresh_interval) searchParams.set('refresh_interval', String(params.refresh_interval))
  if (params.hours) searchParams.set('hours', String(params.hours))
  if (params.categories) searchParams.set('categories', params.categories)
  if (params.severities) searchParams.set('severities', params.severities)

  const query = searchParams.toString()
  return `/api/v1/spatial/networklink.kml${query ? `?${query}` : ''}`
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

export interface HotspotParams {
  hours?: number
  min_cluster_size?: number
  eps_km?: number
  categories?: string
  severities?: string
}

/**
 * Detect geographic hotspots using DBSCAN clustering.
 */
export async function getHotspots(params: HotspotParams = {}): Promise<HotspotResponse> {
  const { data } = await apiClient.get<HotspotResponse>('/spatial/hotspots', { params })
  return data
}

export interface ProximityParams {
  lat: number
  lng: number
  radius_km?: number
  hours?: number
  categories?: string
  severities?: string
  limit?: number
}

/**
 * Find events within a radius of a center point.
 */
export async function getProximity(params: ProximityParams): Promise<ProximityResponse> {
  const { data } = await apiClient.get<ProximityResponse>('/spatial/proximity', { params })
  return data
}

export interface TemporalSpatialParams {
  hours?: number
  bucket_hours?: number
  categories?: string
  severities?: string
  include_propagation?: boolean
}

/**
 * Get temporal-spatial analysis data for animation.
 */
export async function getTemporalSpatial(params: TemporalSpatialParams = {}): Promise<TemporalSpatialResponse> {
  const { data } = await apiClient.get<TemporalSpatialResponse>('/spatial/temporal', { params })
  return data
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export const spatialApi = {
  getKMLExportUrl,
  getNetworkLinkUrl,
  getHotspots,
  getProximity,
  getTemporalSpatial,
}

export default spatialApi
