/**
 * Connected Analyst API — Stub for open-source skeleton
 */

export interface AnalystBrief {
  id: string;
  title: string;
  summary: string;
  created_at: string;
}

export async function getLatestBrief(): Promise<AnalystBrief | null> {
  return null;
}
