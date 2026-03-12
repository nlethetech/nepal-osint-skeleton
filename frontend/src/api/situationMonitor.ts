/**
 * Situation Monitor API — cluster timeline for narrative tracking.
 */
import { apiClient } from './client';

// ── Types ──

export interface ClusterTimelineStory {
  source_name: string | null;
  title: string;
  published_at: string | null;
  url: string | null;
}

export interface ClusterTimelineEntry {
  cluster_id: string;
  headline: string;
  category: string | null;
  severity: string | null;
  story_count: number;
  source_count: number;
  first_published: string | null;
  last_updated: string | null;
  diversity_score: number | null;
  confidence_level: string | null;
  bluf: string | null;
  development_stage: string | null;
  timeline: ClusterTimelineStory[];
}

export interface DevelopingStoryEntry extends ClusterTimelineEntry {
  new_sources_6h: number;
  update_velocity: number;
  urgency_score: number;
  cross_lingual: boolean;
}

export interface StoryTrackerClusterRef {
  cluster_id: string;
  headline: string;
  category: string | null;
  severity: string | null;
  story_count: number;
  source_count: number;
  last_updated: string | null;
  bluf: string | null;
  similarity_score: number | null;
}

export interface StoryTrackerEntry {
  narrative_id: string;
  label: string;
  thesis: string | null;
  category: string | null;
  direction: string | null;
  momentum_score: number;
  confidence: number | null;
  cluster_count: number;
  lead_regions: string[];
  lead_entities: string[];
  first_seen_at: string | null;
  last_updated: string | null;
  clusters: StoryTrackerClusterRef[];
}

// Province Anomaly types
export interface ProvinceAnomalyData {
  province_id: number;
  province_name: string;
  threat_level: string;
  threat_trajectory: string;
  summary: string;
  political: string | null;
  economic: string | null;
  security: string | null;
  anomalies: Array<{ type: string; description: string; severity: string; district?: string }>;
  story_count: number;
  tweet_count: number;
}

export interface ProvinceAnomalyLatest {
  run_id: string | null;
  completed_at: string | null;
  stories_analyzed: number;
  tweets_analyzed: number;
  provinces: ProvinceAnomalyData[];
}

// ── API calls ──

export async function getClusterTimeline(params: {
  hours?: number;
  limit?: number;
  category?: string;
  min_stories?: number;
} = {}): Promise<ClusterTimelineEntry[]> {
  const { data } = await apiClient.get<ClusterTimelineEntry[]>(
    '/analytics/cluster-timeline',
    { params },
  );
  return data;
}

export async function getDevelopingStories(params: {
  hours?: number;
  limit?: number;
  category?: string;
} = {}): Promise<DevelopingStoryEntry[]> {
  const { data } = await apiClient.get<DevelopingStoryEntry[]>(
    '/analytics/developing-stories',
    { params },
  );
  return data;
}

export async function getStoryTracker(params: {
  hours?: number;
  limit?: number;
  refresh?: boolean;
} = {}): Promise<StoryTrackerEntry[]> {
  const { data } = await apiClient.get<StoryTrackerEntry[]>(
    '/analytics/story-tracker',
    { params },
  );
  return data;
}

export async function getProvinceAnomalies(): Promise<ProvinceAnomalyLatest> {
  const { data } = await apiClient.get<ProvinceAnomalyLatest>(
    '/province-anomalies/latest',
  );
  return data;
}
