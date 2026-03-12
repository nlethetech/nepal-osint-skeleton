import { useQuery } from '@tanstack/react-query';
import { getInfrastructureStatus, getBorderCrossingStatus } from '../infrastructure';
import type { InfrastructureStatus, BorderCrossingStatusResponse } from '../infrastructure';

// Query keys - centralized for cache invalidation
export const infrastructureKeys = {
  all: ['infrastructure'] as const,
  status: (days: number) => [...infrastructureKeys.all, 'status', days] as const,
  borders: () => [...infrastructureKeys.all, 'borders'] as const,
};

/**
 * Hook for infrastructure status.
 *
 * Returns infrastructure status derived from active disaster incidents:
 * - Roads: Affected by floods, landslides, avalanches, earthquakes
 * - Bridges: Affected by floods
 * - Airports: Incidents in airport districts
 * - Hospitals: High-severity incidents impacting capacity
 *
 * @param days - Number of days to look back for incidents (default: 7)
 */
export function useInfrastructureStatus(days: number = 7) {
  return useQuery<InfrastructureStatus>({
    queryKey: infrastructureKeys.status(days),
    queryFn: () => getInfrastructureStatus(days),
    staleTime: 5 * 60 * 1000, // 5 minutes (matches BIPAD polling interval)
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
}

/**
 * Hook for border crossing status from monthly customs trade data.
 */
export function useBorderCrossingStatus() {
  return useQuery<BorderCrossingStatusResponse>({
    queryKey: infrastructureKeys.borders(),
    queryFn: getBorderCrossingStatus,
    staleTime: 30 * 60 * 1000, // monthly trade data changes slowly
    refetchInterval: 30 * 60 * 1000,
  });
}
