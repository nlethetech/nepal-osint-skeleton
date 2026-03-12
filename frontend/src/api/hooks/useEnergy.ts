import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEnergySummary,
  refreshEnergyData,
  type EnergySummary,
  type EnergyIngestResponse,
} from '../energy';

// Query keys - centralized for cache invalidation
export const energyKeys = {
  all: ['energy'] as const,
  summary: () => [...energyKeys.all, 'summary'] as const,
};

/**
 * Hook for energy summary (optimized for dashboard Power Grid widget).
 *
 * Returns current values for NEA power grid data including:
 * - NEA Subsidiary Companies (MWh)
 * - IPP (Independent Power Producers) (MWh)
 * - Import from India (MWh)
 * - Interruption/Outages (MWh)
 * - Total Energy Demand (MWh)
 * - Total Supply (calculated)
 * - Grid Status (STABLE, SURPLUS, STRAINED, CRITICAL)
 *
 * Auto-refreshes every 5 minutes to keep data current.
 */
export function useEnergySummary() {
  return useQuery<EnergySummary>({
    queryKey: energyKeys.summary(),
    queryFn: getEnergySummary,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
}

/**
 * Mutation hook for manually refreshing energy data.
 *
 * Useful for admin/debugging purposes when you need fresh data immediately.
 */
export function useRefreshEnergyData() {
  const queryClient = useQueryClient();

  return useMutation<EnergyIngestResponse>({
    mutationFn: refreshEnergyData,
    onSuccess: () => {
      // Invalidate energy queries to fetch fresh data
      queryClient.invalidateQueries({ queryKey: energyKeys.all });
    },
  });
}
