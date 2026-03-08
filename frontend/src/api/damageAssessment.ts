/**
 * Damage Assessment API — Stub for open-source skeleton
 */

export interface QuickAnalyzeResult {
  status: string;
  summary?: string;
}

export interface Assessment {
  id: string;
  district: string;
  districts: string[];
  event_name: string;
  damage_percentage?: number;
  status: string;
  created_at: string;
}

export interface ListAssessmentsResponse {
  items: Assessment[];
  total: number;
}

export async function quickAnalyze(_district: string): Promise<QuickAnalyzeResult> {
  return { status: 'unavailable' };
}

export async function listAssessments(
  _params?: { limit?: number },
): Promise<ListAssessmentsResponse> {
  return { items: [], total: 0 };
}
