/**
 * React Query hooks for curfew alerts
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getActiveCurfews,
  getCurfewMapData,
  getCurfewStats,
  getCurfewByDistrict,
  getCurfewsByProvince,
  getCurfewHistory,
  getRecentCurfews,
  deactivateCurfew,
  extendCurfew,
  confirmCurfew,
  ActiveCurfewsResponse,
  CurfewMapData,
  CurfewStats,
  CurfewAlert,
} from '../curfew';

// Query key factory
export const curfewKeys = {
  all: ['curfew'] as const,
  active: () => [...curfewKeys.all, 'active'] as const,
  mapData: () => [...curfewKeys.all, 'map-data'] as const,
  stats: () => [...curfewKeys.all, 'stats'] as const,
  district: (district: string) => [...curfewKeys.all, 'district', district] as const,
  province: (province: string) => [...curfewKeys.all, 'province', province] as const,
  history: (district: string) => [...curfewKeys.all, 'history', district] as const,
  recent: () => [...curfewKeys.all, 'recent'] as const,
};

/**
 * Hook to get active curfew alerts.
 *
 * Automatically refreshes every 5 minutes.
 */
export function useActiveCurfews() {
  return useQuery<ActiveCurfewsResponse>({
    queryKey: curfewKeys.active(),
    queryFn: getActiveCurfews,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
    refetchOnWindowFocus: true,
  });
}

/**
 * Hook to get curfew data for map visualization.
 *
 * Returns district names for polygon highlighting.
 */
export function useCurfewMapData() {
  return useQuery<CurfewMapData>({
    queryKey: curfewKeys.mapData(),
    queryFn: getCurfewMapData,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Hook to get curfew statistics.
 */
export function useCurfewStats() {
  return useQuery<CurfewStats>({
    queryKey: curfewKeys.stats(),
    queryFn: getCurfewStats,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Hook to get curfew for a specific district.
 */
export function useCurfewByDistrict(district: string, enabled: boolean = true) {
  return useQuery<CurfewAlert>({
    queryKey: curfewKeys.district(district),
    queryFn: () => getCurfewByDistrict(district),
    enabled: enabled && !!district,
    staleTime: 5 * 60 * 1000,
    retry: false, // Don't retry on 404
  });
}

/**
 * Hook to get curfews for a province.
 */
export function useCurfewsByProvince(province: string, enabled: boolean = true) {
  return useQuery({
    queryKey: curfewKeys.province(province),
    queryFn: () => getCurfewsByProvince(province),
    enabled: enabled && !!province,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to get curfew history for a district.
 */
export function useCurfewHistory(district: string, limit: number = 10) {
  return useQuery({
    queryKey: curfewKeys.history(district),
    queryFn: () => getCurfewHistory(district, limit),
    enabled: !!district,
    staleTime: 10 * 60 * 1000, // History changes less frequently
  });
}

/**
 * Hook to get recent curfew alerts.
 */
export function useRecentCurfews(limit: number = 10) {
  return useQuery({
    queryKey: curfewKeys.recent(),
    queryFn: () => getRecentCurfews(limit),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation hook to deactivate a curfew alert.
 */
export function useDeactivateCurfew() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deactivateCurfew,
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: curfewKeys.all });
    },
  });
}

/**
 * Mutation hook to extend a curfew alert.
 */
export function useExtendCurfew() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ alertId, hours }: { alertId: string; hours?: number }) =>
      extendCurfew(alertId, hours),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: curfewKeys.all });
    },
  });
}

/**
 * Mutation hook to confirm a curfew alert.
 */
export function useConfirmCurfew() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: confirmCurfew,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: curfewKeys.all });
    },
  });
}

/**
 * Simplified hook that returns just the districts with active curfews.
 *
 * Useful for map components that only need the district list.
 */
export function useCurfewDistricts() {
  const { data, isLoading, error } = useCurfewMapData();

  return {
    districts: data?.districts ?? [],
    alerts: data?.alerts ?? [],
    isLoading,
    error,
    hasCurfews: (data?.districts?.length ?? 0) > 0,
  };
}
