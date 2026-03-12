import { useQuery } from '@tanstack/react-query';
import { getSeismicStats, getSeismicEvents, getSeismicMapData } from '../seismic';
import type { SeismicStats, SeismicEventsResponse, SeismicMapData } from '../seismic';

// Query keys - centralized for cache invalidation
export const seismicKeys = {
  all: ['seismic'] as const,
  stats: (hours: number, minMag: number) =>
    [...seismicKeys.all, 'stats', hours, minMag] as const,
  events: (hours: number, minMag: number, limit: number) =>
    [...seismicKeys.all, 'events', hours, minMag, limit] as const,
  map: (hours: number, minMag: number) =>
    [...seismicKeys.all, 'map', hours, minMag] as const,
};

/**
 * Hook for seismic activity statistics (widget display).
 *
 * Returns aggregated stats: event count, max magnitude, avg depth, recent events.
 * Auto-refreshes every 5 minutes to stay current with BIPAD data.
 *
 * @param hours - Hours to look back (default: 24)
 * @param minMagnitude - Minimum magnitude filter (default: 0)
 */
export function useSeismicStats(hours: number = 24, minMagnitude: number = 0) {
  return useQuery<SeismicStats>({
    queryKey: seismicKeys.stats(hours, minMagnitude),
    queryFn: () => getSeismicStats(hours, minMagnitude),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
}

/**
 * Hook for detailed seismic events list.
 *
 * Returns full event details for detailed views and tables.
 *
 * @param hours - Hours to look back (default: 72)
 * @param minMagnitude - Minimum magnitude filter (default: 0)
 * @param limit - Max events to return (default: 50)
 */
export function useSeismicEvents(
  hours: number = 72,
  minMagnitude: number = 0,
  limit: number = 50
) {
  return useQuery<SeismicEventsResponse>({
    queryKey: seismicKeys.events(hours, minMagnitude, limit),
    queryFn: () => getSeismicEvents(hours, minMagnitude, limit),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Hook for seismic map data.
 *
 * Returns events with coordinates for Leaflet map visualization.
 *
 * @param hours - Hours to look back (default: 72)
 * @param minMagnitude - Minimum magnitude for map (default: 3.0)
 */
export function useSeismicMapData(hours: number = 72, minMagnitude: number = 3.0) {
  return useQuery<SeismicMapData>({
    queryKey: seismicKeys.map(hours, minMagnitude),
    queryFn: () => getSeismicMapData(hours, minMagnitude),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
