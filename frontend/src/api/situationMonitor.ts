/**
 * Situation Monitor API — Stub for open-source skeleton
 */
import apiClient from './client';

export interface ClusterTimelineEntry {
  cluster_id: string;
  headline: string;
  bluf?: string;
  category?: string;
  severity?: string;
  development_stage?: string;
  confidence_level?: string;
  source_count: number;
  last_updated: string | null;
  timeline: Array<{
    title: string;
    source_name?: string;
    published_at: string;
    url?: string;
  }>;
}

export interface ProvinceAnomalyLatest {
  id: string;
  province_id: number;
  province_name: string;
  anomaly_type: string;
  severity: string;
  headline: string;
  summary: string;
  created_at: string;
}

export async function getDevelopingStories(): Promise<ClusterTimelineEntry[]> {
  return [];
}

export async function getClusterTimeline(params?: {
  hours?: number;
  limit?: number;
  min_stories?: number;
}): Promise<ClusterTimelineEntry[]> {
  try {
    const { data } = await apiClient.get('/stories/cluster-timeline', { params });
    return data;
  } catch {
    return [];
  }
}

export async function getProvinceAnomalies(params?: {
  province_id?: number;
  limit?: number;
}): Promise<ProvinceAnomalyLatest[]> {
  try {
    const { data } = await apiClient.get('/province-anomalies/latest', { params });
    return data;
  } catch {
    return [];
  }
}
