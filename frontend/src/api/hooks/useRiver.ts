import { useQuery } from '@tanstack/react-query'
import {
  getRiverStations,
  getRiverStats,
  getRiverMapData,
  getRiverAlerts,
  type RiverStation,
  type RiverStats,
  type RiverMapPoint,
  type RiverAlert,
} from '../riverMonitoring'

// Query keys
export const riverKeys = {
  all: ['river'] as const,
  stations: (basin?: string) => [...riverKeys.all, 'stations', basin] as const,
  stats: () => [...riverKeys.all, 'stats'] as const,
  mapData: () => [...riverKeys.all, 'map'] as const,
  alerts: (hours: number) => [...riverKeys.all, 'alerts', hours] as const,
}

/**
 * Hook for river monitoring stations
 */
export function useRiverStations(basin?: string) {
  return useQuery<RiverStation[]>({
    queryKey: riverKeys.stations(basin),
    queryFn: () => getRiverStations(basin),
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Hook for river monitoring statistics
 */
export function useRiverStats() {
  return useQuery<RiverStats>({
    queryKey: riverKeys.stats(),
    queryFn: getRiverStats,
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Hook for river map data
 */
export function useRiverMapData() {
  return useQuery<RiverMapPoint[]>({
    queryKey: riverKeys.mapData(),
    queryFn: getRiverMapData,
    staleTime: 60 * 1000, // 1 minute
  })
}

/**
 * Hook for river danger/warning alerts
 */
export function useRiverAlerts(hours: number = 24) {
  return useQuery<RiverAlert[]>({
    queryKey: riverKeys.alerts(hours),
    queryFn: () => getRiverAlerts(hours),
    staleTime: 60 * 1000, // 1 minute
  })
}
