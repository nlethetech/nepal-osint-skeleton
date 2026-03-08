/**
 * React Query hooks for Situation Monitor widgets.
 */
import { useQuery } from '@tanstack/react-query';
import { getClusterTimeline, getProvinceAnomalies } from '../situationMonitor';
import type { ClusterTimelineEntry, ProvinceAnomalyLatest } from '../situationMonitor';

export const situationMonitorKeys = {
  all: ['situation-monitor'] as const,
  clusterTimeline: (params: { hours?: number; limit?: number; category?: string; min_stories?: number }) =>
    [...situationMonitorKeys.all, 'cluster-timeline', params] as const,
  provinceAnomalies: () => [...situationMonitorKeys.all, 'province-anomalies'] as const,
};

/** Cluster timeline for NarrativeTrackerWidget. */
export function useClusterTimeline(params: {
  hours?: number;
  limit?: number;
  category?: string;
} = {}) {
  return useQuery<ClusterTimelineEntry[]>({
    queryKey: situationMonitorKeys.clusterTimeline(params),
    queryFn: () => getClusterTimeline(params),
    staleTime: 3 * 60 * 1000,          // 3 minutes
    refetchInterval: 10 * 60 * 1000,   // 10 minutes
  });
}

/** Developing stories — clusters with 3+ sources, last 72h. */
export function useDevelopingStories() {
  return useQuery<ClusterTimelineEntry[]>({
    queryKey: situationMonitorKeys.clusterTimeline({ hours: 72, limit: 15, min_stories: 3 }),
    queryFn: () => getClusterTimeline({ hours: 72, limit: 15, min_stories: 3 }),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  });
}

/** Province anomaly data for ProvinceMonitorWidget. */
export function useProvinceAnomalies() {
  return useQuery<ProvinceAnomalyLatest[]>({
    queryKey: situationMonitorKeys.provinceAnomalies(),
    queryFn: () => getProvinceAnomalies(),
    staleTime: 5 * 60 * 1000,          // 5 minutes
    refetchInterval: 10 * 60 * 1000,   // 10 minutes
  });
}
