/**
 * React Query hooks for aviation monitoring data.
 */
import { useQuery } from '@tanstack/react-query';
import {
  getLiveAircraft,
  getAirports,
  getAirportTraffic,
  getAircraftHistory,
  getHourlyCounts,
  getMilitaryStats,
  getTopAircraft,
} from '../aviation';

export const aviationKeys = {
  all: ['aviation'] as const,
  live: (params: Record<string, unknown>) => [...aviationKeys.all, 'live', params] as const,
  airports: () => [...aviationKeys.all, 'airports'] as const,
  traffic: () => [...aviationKeys.all, 'traffic'] as const,
  history: (hex: string) => [...aviationKeys.all, 'history', hex] as const,
  hourly: (days: number) => [...aviationKeys.all, 'hourly', days] as const,
  military: (days: number) => [...aviationKeys.all, 'military', days] as const,
  topAircraft: (days: number) => [...aviationKeys.all, 'top-aircraft', days] as const,
};

export function useLiveAircraft(militaryOnly = false) {
  return useQuery({
    queryKey: aviationKeys.live({ militaryOnly }),
    queryFn: () => getLiveAircraft(militaryOnly),
    refetchInterval: 30_000,  // 30s polling
    staleTime: 15_000,
  });
}

export function useAirports() {
  return useQuery({
    queryKey: aviationKeys.airports(),
    queryFn: getAirports,
    staleTime: Infinity,  // Static data, never refetch
  });
}

export function useAirportTraffic() {
  return useQuery({
    queryKey: aviationKeys.traffic(),
    queryFn: getAirportTraffic,
    refetchInterval: 60_000,  // 1 min
    staleTime: 30_000,
  });
}

export function useAircraftHistory(hexCode: string | null, hours = 24) {
  return useQuery({
    queryKey: aviationKeys.history(hexCode ?? ''),
    queryFn: () => getAircraftHistory(hexCode!, hours),
    enabled: !!hexCode,
    staleTime: 30_000,
  });
}

export function useHourlyCounts(days = 7) {
  return useQuery({
    queryKey: aviationKeys.hourly(days),
    queryFn: () => getHourlyCounts(days),
    refetchInterval: 300_000,  // 5 min
    staleTime: 120_000,
  });
}

export function useMilitaryStats(days = 7) {
  return useQuery({
    queryKey: aviationKeys.military(days),
    queryFn: () => getMilitaryStats(days),
    refetchInterval: 300_000,
    staleTime: 120_000,
  });
}

export function useTopAircraft(days = 7, limit = 20) {
  return useQuery({
    queryKey: aviationKeys.topAircraft(days),
    queryFn: () => getTopAircraft(days, limit),
    refetchInterval: 300_000,
    staleTime: 120_000,
  });
}
