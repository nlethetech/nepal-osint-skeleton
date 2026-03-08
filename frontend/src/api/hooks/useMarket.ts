import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMarketSummary,
  refreshMarketData,
  type MarketSummary,
  type MarketIngestResponse,
} from '../market';

// Query keys - centralized for cache invalidation
export const marketKeys = {
  all: ['market'] as const,
  summary: () => [...marketKeys.all, 'summary'] as const,
};

/**
 * Hook for market summary (optimized for dashboard widget).
 *
 * Returns current values for NEPSE index, USD/NPR exchange rate,
 * gold/silver prices per tola, and fuel prices.
 *
 * Auto-refreshes every 5 minutes to keep data current.
 */
export function useMarketSummary() {
  return useQuery<MarketSummary>({
    queryKey: marketKeys.summary(),
    queryFn: getMarketSummary,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Auto-refresh every 5 minutes
  });
}

/**
 * Mutation hook for manually refreshing market data.
 *
 * Useful for admin/debugging purposes when you need fresh data immediately.
 */
export function useRefreshMarketData() {
  const queryClient = useQueryClient();

  return useMutation<MarketIngestResponse>({
    mutationFn: refreshMarketData,
    onSuccess: () => {
      // Invalidate market queries to fetch fresh data
      queryClient.invalidateQueries({ queryKey: marketKeys.all });
    },
  });
}
