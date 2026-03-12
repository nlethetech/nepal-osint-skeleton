/**
 * Fact-check API client — user-requested story verification.
 */
import apiClient from './client';

// ── Types ──

export interface FactCheckStatus {
  story_id: string;
  request_count: number;
  already_checked: boolean;
  user_requested: boolean;
}

export interface FactCheckClaim {
  claim: string;
  verdict: string;
  evidence: string;
  sources?: string[];
}

export interface FactCheckSource {
  url: string;
  title?: string;
  relevant_excerpt?: string;
  supports?: boolean;
}

export interface FactCheckResult {
  id: string;
  story_id: string;
  story_title: string | null;
  story_source: string | null;
  story_url: string | null;
  verdict: string;
  verdict_summary: string;
  confidence: number;
  claims_analyzed: FactCheckClaim[] | null;
  sources_checked: FactCheckSource[] | null;
  key_finding: string | null;
  context: string | null;
  request_count: number;
  checked_at: string;
}

// ── API Calls ──

/** Request a fact-check for a story. Returns updated request count. */
export async function requestFactCheck(storyId: string): Promise<{ status: string; request_count: number }> {
  const response = await apiClient.post(`/fact-check/request/${storyId}`);
  return response.data;
}

/** Get fact-check status for a story. */
export async function getFactCheckStatus(storyId: string): Promise<FactCheckStatus> {
  const response = await apiClient.get(`/fact-check/status/${storyId}`);
  return response.data;
}

/** Get recent fact-check results. */
export async function getFactCheckResults(params: {
  limit?: number;
  hours?: number;
} = {}): Promise<FactCheckResult[]> {
  const response = await apiClient.get('/fact-check/results', { params });
  return response.data;
}

/** Get fact-check result for a specific story. */
export async function getFactCheckResultForStory(storyId: string): Promise<FactCheckResult | null> {
  const response = await apiClient.get(`/fact-check/results/${storyId}`);
  return response.data;
}
