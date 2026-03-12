import apiClient from './client'

// Types

export interface DisasterAlert {
  id: string
  external_id: string | null
  title: string
  title_ne: string | null
  description: string | null
  hazard_type: string | null
  severity: 'normal' | 'watch' | 'warning' | 'danger'
  latitude: number | null
  longitude: number | null
  district: string | null
  is_active: boolean
  verified: boolean
  started_at: string | null
  expires_at: string | null
  created_at: string | null
}

export interface DisasterIncident {
  id: string
  external_id: string | null
  title: string
  title_ne: string | null
  description: string | null
  hazard_type: string | null
  latitude: number | null
  longitude: number | null
  province: string | null
  district: string | null
  municipality: string | null
  location_text: string | null
  deaths: number | null
  injured: number | null
  missing: number | null
  affected_families: number | null
  houses_destroyed: number | null
  houses_damaged: number | null
  estimated_loss_npr: number | null
  verified: boolean
  incident_date: string | null
  created_at: string | null
}

export interface AlertStats {
  active_alerts: number
  danger_alerts: number
  warning_alerts: number
  by_severity: Record<string, number>
  by_hazard: Record<string, number>
  recent_incidents_24h: number
  recent_incidents_7d: number
  incidents_in_window?: number
  hours?: number
  last_synced_at: string | null
}

export interface MapDataPoint {
  id: string
  title: string
  hazard_type: string | null
  severity?: string
  lat: number
  lng: number
  district: string | null
  deaths?: number | null
  injured?: number | null
  incident_date?: string | null
}

export interface MapData {
  alerts: MapDataPoint[]
  incidents: MapDataPoint[]
}

export interface HazardType {
  code: string
  name: string
  name_ne: string
  icon: string
}

export interface SyncResult {
  status: string
  message: string
  stats: Record<string, number>
}

// API Functions

export const getActiveAlerts = async (
  severity?: string,
  hazardType?: string,
  district?: string,
  limit: number = 50,
  hours: number = 72,
): Promise<DisasterAlert[]> => {
  const params: Record<string, unknown> = { limit, hours }
  if (severity) params.severity = severity
  if (hazardType) params.hazard_type = hazardType
  if (district) params.district = district

  const response = await apiClient.get('/disaster-alerts/active', { params })
  return response.data
}

export const getRecentIncidents = async (
  days: number = 7,
  hazardType?: string,
  district?: string,
  limit: number = 50,
): Promise<DisasterIncident[]> => {
  const params: Record<string, unknown> = { days, limit }
  if (hazardType) params.hazard_type = hazardType
  if (district) params.district = district

  const response = await apiClient.get('/disaster-alerts/incidents', { params })
  return response.data
}

export const getAlertStats = async (hours: number = 72): Promise<AlertStats> => {
  const response = await apiClient.get('/disaster-alerts/stats', { params: { hours } })
  return response.data
}

export const getMapData = async (
  includeAlerts: boolean = true,
  includeIncidents: boolean = true,
  days: number = 7,
): Promise<MapData> => {
  const params: Record<string, unknown> = {
    include_alerts: includeAlerts,
    include_incidents: includeIncidents,
    days,
  }
  const response = await apiClient.get('/disaster-alerts/map-data', { params })
  return response.data
}

export const getHazardTypes = async (): Promise<HazardType[]> => {
  const response = await apiClient.get('/disaster-alerts/hazard-types')
  return response.data
}

export const syncBipadData = async (
  fetchAlerts: boolean = true,
  fetchIncidents: boolean = true,
  incidentLimit: number = 100,
): Promise<SyncResult> => {
  const params: Record<string, unknown> = {
    fetch_alerts: fetchAlerts,
    fetch_incidents: fetchIncidents,
    incident_limit: incidentLimit,
  }
  const response = await apiClient.post('/disaster-alerts/sync', null, { params })
  return response.data
}

// Utility functions

export const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case 'danger':
      return 'bg-red-600 text-white'
    case 'warning':
      return 'bg-orange-500 text-white'
    case 'watch':
      return 'bg-yellow-500 text-black'
    default:
      return 'bg-blue-500 text-white'
  }
}

export const getSeverityBorderColor = (severity: string): string => {
  switch (severity) {
    case 'danger':
      return 'border-red-600'
    case 'warning':
      return 'border-orange-500'
    case 'watch':
      return 'border-yellow-500'
    default:
      return 'border-blue-500'
  }
}

export const getHazardIcon = (hazardType: string | null): string => {
  const icons: Record<string, string> = {
    flood: '🌊',
    landslide: '⛰️',
    earthquake: '🔔',
    fire: '🔥',
    forest_fire: '🌲🔥',
    lightning: '⚡',
    drought: '☀️',
    cold_wave: '❄️',
    epidemic: '🦠',
    avalanche: '🏔️',
    glof: '🏔️💧',
    wind_storm: '💨',
    heavy_rainfall: '🌧️',
    animal_attack: '🐻',
    drowning: '🏊',
    snake_bite: '🐍',
  }
  return icons[hazardType || ''] || '⚠️'
}

export const formatHazardType = (hazardType: string | null): string => {
  if (!hazardType) return 'Unknown'
  return hazardType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
