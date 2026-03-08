import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchElectionsDB,
  fetchElectionByYearDB,
  fetchNationalSummaryDB,
  fetchConstituenciesDB,
  fetchConstituencyDetailDB,
  fetchDistrictMapData,
  fetchConstituencyWatchlist,
  addConstituencyToWatchlist,
  removeConstituencyFromWatchlist,
  updateWatchlistAlertLevel,
  fetchSwingAnalysisDB,
} from '../elections';
import type {
  ElectionResponse,
  NationalSummaryDBResponse,
  ConstituencyResponse,
  ConstituencyDetailResponse,
  DistrictMapDataResponse,
  ConstituencyWatchlistItem,
  SwingEntry,
} from '../elections';

// Query keys - centralized for cache invalidation
export const electionKeys = {
  all: ['elections'] as const,
  list: () => [...electionKeys.all, 'list'] as const,
  byYear: (year: number) => [...electionKeys.all, 'year', year] as const,
  nationalSummary: (year: number) => [...electionKeys.all, 'national-summary', year] as const,
  constituencies: (year: number, filters?: object) =>
    [...electionKeys.all, 'constituencies', year, filters] as const,
  constituencyDetail: (year: number, code: string) =>
    [...electionKeys.all, 'constituency', year, code] as const,
  districtMap: (year: number) => [...electionKeys.all, 'district-map', year] as const,
  watchlist: () => [...electionKeys.all, 'watchlist'] as const,
  swing: (year: number, vsYear: number) =>
    [...electionKeys.all, 'swing', year, vsYear] as const,
};

/**
 * Hook to list all elections.
 */
export function useElections() {
  return useQuery<{ elections: ElectionResponse[] }>({
    queryKey: electionKeys.list(),
    queryFn: fetchElectionsDB,
    staleTime: 5 * 60 * 1000, // 5 minutes - elections don't change often
  });
}

/**
 * Hook to get election by year (BS).
 */
export function useElectionByYear(yearBs: number) {
  return useQuery<ElectionResponse>({
    queryKey: electionKeys.byYear(yearBs),
    queryFn: () => fetchElectionByYearDB(yearBs),
    staleTime: 5 * 60 * 1000,
    enabled: yearBs > 0,
  });
}

/**
 * Hook for national election summary (seats, turnout, leading party).
 */
export function useNationalSummary(yearBs: number) {
  return useQuery<NationalSummaryDBResponse>({
    queryKey: electionKeys.nationalSummary(yearBs),
    queryFn: () => fetchNationalSummaryDB(yearBs),
    staleTime: 30 * 1000, // 30 seconds - can change during live counting
    refetchInterval: 60 * 1000, // Auto-refresh every minute during elections
    enabled: yearBs > 0,
  });
}

/**
 * Hook to list constituencies with filters and pagination.
 */
export function useConstituencies(
  yearBs: number,
  filters?: {
    province?: string;
    province_id?: number;
    district?: string;
    status?: string;
    page?: number;
    page_size?: number;
  }
) {
  return useQuery<{
    constituencies: ConstituencyResponse[];
    total: number;
    page: number;
    page_size: number;
  }>({
    queryKey: electionKeys.constituencies(yearBs, filters),
    queryFn: () => fetchConstituenciesDB(yearBs, filters),
    staleTime: 30 * 1000,
    enabled: yearBs > 0,
  });
}

/**
 * Hook to get constituency detail with candidates.
 */
export function useConstituencyDetail(yearBs: number, code: string) {
  return useQuery<ConstituencyDetailResponse>({
    queryKey: electionKeys.constituencyDetail(yearBs, code),
    queryFn: () => fetchConstituencyDetailDB(yearBs, code),
    staleTime: 30 * 1000,
    enabled: yearBs > 0 && !!code,
  });
}

/**
 * Hook for district-level map data (for DistrictPolygonsLayer).
 * Returns dominant party per district for coloring.
 */
export function useDistrictMapData(yearBs: number) {
  return useQuery<DistrictMapDataResponse>({
    queryKey: electionKeys.districtMap(yearBs),
    queryFn: () => fetchDistrictMapData(yearBs),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000, // Auto-refresh during elections
    enabled: yearBs > 0,
  });
}

/**
 * Hook for user's constituency watchlist.
 */
export function useConstituencyWatchlist() {
  return useQuery<{ items: ConstituencyWatchlistItem[] }>({
    queryKey: electionKeys.watchlist(),
    queryFn: fetchConstituencyWatchlist,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook to add constituency to watchlist.
 */
export function useAddToWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      constituencyId,
      alertLevel = 'medium',
      notes,
    }: {
      constituencyId: string;
      alertLevel?: string;
      notes?: string;
    }) => addConstituencyToWatchlist(constituencyId, alertLevel, notes),
    onSuccess: () => {
      // Invalidate watchlist to refetch
      queryClient.invalidateQueries({ queryKey: electionKeys.watchlist() });
    },
  });
}

/**
 * Hook to remove constituency from watchlist.
 */
export function useRemoveFromWatchlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (constituencyId: string) =>
      removeConstituencyFromWatchlist(constituencyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: electionKeys.watchlist() });
    },
  });
}

/**
 * Hook to update watchlist item alert level.
 */
export function useUpdateWatchlistAlertLevel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      constituencyId,
      alertLevel,
    }: {
      constituencyId: string;
      alertLevel: string;
    }) => updateWatchlistAlertLevel(constituencyId, alertLevel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: electionKeys.watchlist() });
    },
  });
}

/**
 * Hook for swing analysis (seat changes between elections).
 */
export function useSwingAnalysis(yearBs: number, vsYearBs: number) {
  return useQuery<{
    swing: SwingEntry[];
    election_year: number;
    vs_year: number;
  }>({
    queryKey: electionKeys.swing(yearBs, vsYearBs),
    queryFn: () => fetchSwingAnalysisDB(yearBs, vsYearBs),
    staleTime: 5 * 60 * 1000,
    enabled: yearBs > 0 && vsYearBs > 0,
  });
}
