import { useQuery } from '@tanstack/react-query';
import {
  getAnalyticsSummary,
  getThreatMatrix,
  getKeyActors,
  getExecutiveSummary,
  type ThreatMatrix,
  type KeyActor,
  type ExecutiveSummary,
} from '../analytics';
import type { AnalyticsSummary } from '../../types/api';

// Query keys - centralized for cache invalidation
export const analyticsKeys = {
  all: ['analytics'] as const,
  summary: (hours: number) => [...analyticsKeys.all, 'summary', hours] as const,
  threatMatrix: (hours: number) => [...analyticsKeys.all, 'threat-matrix', hours] as const,
  keyActors: (hours: number, limit: number) => [...analyticsKeys.all, 'key-actors', hours, limit] as const,
  executiveSummary: (hours: number) => [...analyticsKeys.all, 'executive-summary', hours] as const,
};

/**
 * Hook for KPI summary (stories, events, entities, alerts count)
 */
export function useAnalyticsSummary(hours: number = 72) {
  return useQuery<AnalyticsSummary>({
    queryKey: analyticsKeys.summary(hours),
    queryFn: () => getAnalyticsSummary(hours),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook for threat matrix data
 */
export function useThreatMatrix(hours: number = 24) {
  return useQuery<ThreatMatrix>({
    queryKey: analyticsKeys.threatMatrix(hours),
    queryFn: () => getThreatMatrix(hours),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for key actors (trending entities)
 */
export function useKeyActors(hours: number = 24, limit: number = 10) {
  return useQuery<KeyActor[]>({
    queryKey: analyticsKeys.keyActors(hours, limit),
    queryFn: () => getKeyActors(hours, undefined, limit),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook for AI-generated executive summary
 */
export function useExecutiveSummary(hours: number = 6) {
  return useQuery<ExecutiveSummary>({
    queryKey: analyticsKeys.executiveSummary(hours),
    queryFn: () => getExecutiveSummary(hours),
    staleTime: 30 * 60 * 1000, // 30 minutes (cached on backend for 6 hours)
  });
}
