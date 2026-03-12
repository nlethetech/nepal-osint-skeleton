/**
 * React Query hooks for Situation Monitor widgets.
 */
import { useQuery } from '@tanstack/react-query';
import { getClusterTimeline, getDevelopingStories, getProvinceAnomalies, getStoryTracker } from '../situationMonitor';
import type { ClusterTimelineEntry, DevelopingStoryEntry, ProvinceAnomalyLatest, StoryTrackerEntry } from '../situationMonitor';

export const situationMonitorKeys = {
  all: ['situation-monitor'] as const,
  clusterTimeline: (params: { hours?: number; limit?: number; category?: string; min_stories?: number }) =>
    [...situationMonitorKeys.all, 'cluster-timeline', params] as const,
  developingStories: (params: { hours?: number; limit?: number; category?: string }) =>
    [...situationMonitorKeys.all, 'developing-stories', params] as const,
  storyTracker: (params: { hours?: number; limit?: number; refresh?: boolean }) =>
    [...situationMonitorKeys.all, 'story-tracker', params] as const,
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
  return useQuery<DevelopingStoryEntry[]>({
    queryKey: situationMonitorKeys.developingStories({ hours: 72, limit: 15 }),
    queryFn: () => getDevelopingStories({ hours: 72, limit: 15 }),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 20 * 60 * 1000,
  });
}

/** Strategic tracker — narratives across related clusters. */
export function useStoryTracker(params: {
  hours?: number;
  limit?: number;
  refresh?: boolean;
} = {}) {
  return useQuery<StoryTrackerEntry[]>({
    queryKey: situationMonitorKeys.storyTracker(params),
    queryFn: () => getStoryTracker(params),
    staleTime: 30 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
  });
}

/** Province anomaly data for ProvinceMonitorWidget. */
export function useProvinceAnomalies() {
  return useQuery<ProvinceAnomalyLatest>({
    queryKey: situationMonitorKeys.provinceAnomalies(),
    queryFn: () => getProvinceAnomalies(),
    staleTime: 5 * 60 * 1000,          // 5 minutes
    refetchInterval: 10 * 60 * 1000,   // 10 minutes
  });
}
