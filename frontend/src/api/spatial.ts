/**
 * Spatial API — Stub for open-source skeleton
 */

export interface HotspotCluster {
  cluster_id: number;
  centroid: [number, number];
  bounding_box: [number, number, number, number];
  member_count: number;
  districts: string[];
  dominant_category: string;
  severity_breakdown: Record<string, number>;
  time_range: {
    earliest: string;
    latest: string;
  };
}

export async function getHotspots(): Promise<HotspotCluster[]> {
  return [];
}
