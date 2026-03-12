import apiClient from './client'

// Types

export interface RiverStation {
  id: string
  bipad_id: number
  title: string
  basin: string | null
  description: string | null
  coordinates: [number, number] | null
  danger_level: number | null
  warning_level: number | null
  image_url: string | null
  is_active: boolean
  current_level: number | null
  current_status: string | null
  current_trend: string | null
  latest_reading: RiverReading | null
  latest_observed_at?: string | null
  is_stale?: boolean
  is_anomalous?: boolean
}

export interface RiverReading {
  id: string
  station_id: string
  water_level: number
  status: string | null
  trend: string | null
  reading_at: string | null
}

export interface RiverStats {
  total_stations: number
  danger_count: number
  warning_count: number
  normal_count: number
  basins: string[]
  last_updated: string
}

export interface RiverMapPoint {
  id: string
  title: string
  basin: string | null
  coordinates: [number, number] | null
  water_level: number | null
  danger_level: number | null
  warning_level: number | null
  status: string | null
  trend: string | null
}

export interface RiverAlert {
  station: RiverStation
  water_level: number
  status: string
  trend: string
  reading_at: string
}

// API Functions

export const getRiverStations = async (basin?: string): Promise<RiverStation[]> => {
  const params: Record<string, unknown> = {}
  if (basin) params.basin = basin
  const response = await apiClient.get('/river/stations', { params })
  return response.data
}

export const getRiverStation = async (
  stationId: string,
  hours: number = 24,
): Promise<{ station: RiverStation; readings: RiverReading[] }> => {
  const response = await apiClient.get(`/river/stations/${stationId}`, {
    params: { hours },
  })
  return response.data
}

export const getRiverAlerts = async (hours: number = 24): Promise<RiverAlert[]> => {
  const response = await apiClient.get('/river/alerts', { params: { hours } })
  return response.data
}

export const getRiverStats = async (): Promise<RiverStats> => {
  const response = await apiClient.get('/river/stats')
  return response.data
}

export const getRiverMapData = async (): Promise<RiverMapPoint[]> => {
  const response = await apiClient.get('/river/map-data')
  return response.data
}

export const getRiverBasins = async (): Promise<string[]> => {
  const response = await apiClient.get('/river/basins')
  return response.data
}

export const syncRiverData = async (): Promise<{ status: string; message: string; stats: Record<string, number> }> => {
  const response = await apiClient.post('/river/sync')
  return response.data
}

// Utility functions

export const getStatusColor = (status: string | null): string => {
  if (!status) return 'var(--text-muted)'
  const s = status.toUpperCase()
  if (s === 'DANGER') return 'var(--status-critical)'
  if (s === 'WARNING') return 'var(--status-high)'
  return 'var(--status-low)'
}

export const getStatusLabel = (status: string | null): string => {
  if (!status) return 'Unknown'
  const s = status.toUpperCase()
  if (s === 'DANGER') return 'DANGER'
  if (s === 'WARNING') return 'WARNING'
  if (s.includes('BELOW')) return 'NORMAL'
  return status
}

export const getTrendIcon = (trend: string | null): string => {
  if (!trend) return '—'
  const t = trend.toUpperCase()
  if (t === 'RISING') return '↑'
  if (t === 'FALLING') return '↓'
  return '→'
}

export const formatWaterLevel = (level: number | null): string => {
  if (level === null || level === undefined) return '—'
  return `${level.toFixed(2)}m`
}

export const calculateLevelPercentage = (
  level: number | null,
  warningLevel: number | null,
  dangerLevel: number | null,
): number => {
  if (level === null) return 0
  const maxLevel = dangerLevel || warningLevel || 10
  return Math.min((level / maxLevel) * 100, 100)
}
