import { useQuery } from '@tanstack/react-query';
import {
  getActiveAlerts,
  getRecentIncidents,
  getAlertStats,
  getMapData,
  type DisasterAlert,
  type DisasterIncident,
  type AlertStats,
  type MapData,
} from '../disasterAlerts';

// Query keys
export const disasterKeys = {
  all: ['disasters'] as const,
  alerts: (limit: number, hours: number) => [...disasterKeys.all, 'alerts', limit, hours] as const,
  incidents: (days: number, limit: number) => [...disasterKeys.all, 'incidents', days, limit] as const,
  stats: (hours: number) => [...disasterKeys.all, 'stats', hours] as const,
  mapData: (days: number) => [...disasterKeys.all, 'map', days] as const,
};

/**
 * Hook for active disaster alerts
 */
export function useDisasterAlerts(limit: number = 10, hours: number = 72) {
  return useQuery<DisasterAlert[]>({
    queryKey: disasterKeys.alerts(limit, hours),
    queryFn: () => getActiveAlerts(undefined, undefined, undefined, limit, hours),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for recent disaster incidents
 */
export function useDisasterIncidents(days: number = 7, limit: number = 20) {
  return useQuery<DisasterIncident[]>({
    queryKey: disasterKeys.incidents(days, limit),
    queryFn: () => getRecentIncidents(days, undefined, undefined, limit),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for disaster statistics
 */
export function useDisasterStats(hours: number = 72) {
  return useQuery<AlertStats>({
    queryKey: disasterKeys.stats(hours),
    queryFn: () => getAlertStats(hours),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for disaster map data (alerts + incidents with coordinates)
 */
export function useDisasterMapData(days: number = 7) {
  return useQuery<MapData>({
    queryKey: disasterKeys.mapData(days),
    queryFn: () => getMapData(true, true, days),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
