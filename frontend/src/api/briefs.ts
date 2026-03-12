/**
 * Situation Briefs API — Narada Analyst Agent output.
 */
import apiClient from './client';

// ── Types ──

export interface BriefHotspot {
  province?: string;
  district?: string;
  severity?: string;
  description?: string;
  confidence?: string;
}

export interface FakeNewsFlag {
  id: string;
  story_id?: string;
  headline: string;
  source_name?: string;
  flag_reason: string;
  verdict?: string;
  verdict_reasoning?: string;
  confidence?: number;
  created_at: string;
}

export interface ProvinceSitrep {
  id: string;
  province_id: number;
  province_name: string;
  bluf?: string;
  security?: string;
  political?: string;
  economic?: string;
  disaster?: string;
  election?: string;
  threat_level?: string;
  threat_trajectory?: string;
  hotspots?: BriefHotspot[];
  flagged_stories?: Array<{
    story_id: string;
    headline: string;
    reason: string;
    confidence: number;
  }>;
  story_count: number;
  created_at: string;
}

export interface BriefSummary {
  id: string;
  run_number: number;
  period_start: string;
  period_end: string;
  national_summary?: string;
  trend_vs_previous?: string;
  key_judgment?: string;
  stories_analyzed: number;
  clusters_analyzed: number;
  claude_calls: number;
  duration_seconds?: number;
  status: string;
  created_at: string;
}

export interface BriefDetail extends BriefSummary {
  national_analysis?: Record<string, unknown>;
  hotspots?: BriefHotspot[];
  province_sitreps: ProvinceSitrep[];
  fake_news_flags: FakeNewsFlag[];
}

// ── API calls ──

export async function getLatestBrief(): Promise<BriefDetail | null> {
  const { data } = await apiClient.get<BriefDetail | null>('/briefs/latest');
  return data;
}

export async function getBriefHistory(limit = 10): Promise<BriefSummary[]> {
  const { data } = await apiClient.get<BriefSummary[]>('/briefs/history', {
    params: { limit },
  });
  return data;
}

export async function getFakeNewsFlags(limit = 20): Promise<FakeNewsFlag[]> {
  const { data } = await apiClient.get<FakeNewsFlag[]>('/briefs/flags', {
    params: { limit },
  });
  return data;
}

export async function getBriefById(briefId: string): Promise<BriefDetail | null> {
  const { data } = await apiClient.get<BriefDetail | null>(`/briefs/${briefId}`);
  return data;
}

export async function getProvinceSitrep(
  provinceId: number,
): Promise<ProvinceSitrep | null> {
  const { data } = await apiClient.get<ProvinceSitrep | null>(
    `/briefs/province/${provinceId}`,
  );
  return data;
}
