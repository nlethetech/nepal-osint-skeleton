/**
 * React Query hooks for the fact-check system.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getFactCheckResults,
  getFactCheckStatus,
  getFactCheckResultForStory,
  requestFactCheck,
} from '../factCheck';
import type { FactCheckResult, FactCheckStatus } from '../factCheck';

export const factCheckKeys = {
  all: ['fact-check'] as const,
  results: (params: { limit?: number; hours?: number }) =>
    [...factCheckKeys.all, 'results', params] as const,
  status: (storyId: string) =>
    [...factCheckKeys.all, 'status', storyId] as const,
  result: (storyId: string) =>
    [...factCheckKeys.all, 'result', storyId] as const,
};

/** Recent fact-check results for the widget. */
export function useFactCheckResults(params: { limit?: number; hours?: number } = {}) {
  return useQuery<FactCheckResult[]>({
    queryKey: factCheckKeys.results(params),
    queryFn: () => getFactCheckResults(params),
    staleTime: 2 * 60 * 1000,         // 2 minutes
    refetchInterval: 5 * 60 * 1000,   // 5 minutes
  });
}

/** Fact-check status for a specific story (request count, checked status). */
export function useFactCheckStatus(storyId: string | undefined) {
  return useQuery<FactCheckStatus>({
    queryKey: factCheckKeys.status(storyId || ''),
    queryFn: () => getFactCheckStatus(storyId!),
    enabled: !!storyId,
    staleTime: 30 * 1000,
  });
}

/** Request a fact-check for a story. */
export function useRequestFactCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (storyId: string) => requestFactCheck(storyId),
    onSuccess: (_data, storyId) => {
      // Invalidate the status for this story
      queryClient.invalidateQueries({ queryKey: factCheckKeys.status(storyId) });
      // Invalidate the results list
      queryClient.invalidateQueries({ queryKey: factCheckKeys.all });
    },
  });
}

/** Fact-check result for a specific story. */
export function useFactCheckResultForStory(storyId: string | undefined) {
  return useQuery<FactCheckResult | null>({
    queryKey: factCheckKeys.result(storyId || ''),
    queryFn: () => getFactCheckResultForStory(storyId!),
    enabled: !!storyId,
    staleTime: 60 * 1000,
  });
}
