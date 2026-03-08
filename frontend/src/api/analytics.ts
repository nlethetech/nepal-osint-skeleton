/**
 * Analytics API — Stub for open-source skeleton
 * (Full implementation removed for open-source release)
 */
import apiClient from './client';

// =============================================================================
// Types
// =============================================================================

export interface AnalyticsSummary {
  stories: number;
  events: number;
  entities: number;
  active_alerts: number;
  top_event_types: Array<{ event_type: string; count: number }>;
}

export interface DistrictStress {
  district: string;
  lat: number;
  lng: number;
  youth_stress: number;
  level: 'high' | 'elevated' | 'low';
  event_count: number;
  event_types: Record<string, number>;
}

export interface DistrictThreat {
  district: string;
  threat_level: string;
  total_events: number;
  critical_events: number;
  high_events: number;
  medium_events: number;
  low_events: number;
  top_event_type: string;
}

export interface DistrictMetric {
  district: string;
  risk_level: string;
  total_events_7d: number;
  overall_stability_score: number;
  violent_crime_score: number;
  communal_tension_score: number;
  economic_health_score: number;
}

export interface DistrictBrief {
  district: string;
  summary: string;
  key_factors: string[];
  llm_model?: string;
  sources: SourceReference[];
}

export interface SourceReference {
  story_id: string;
  title: string;
  url?: string;
  source?: string;
  published_at?: string;
  relevance: 'primary' | 'supporting' | 'context';
}

export interface PoliticalEntity {
  id: string;
  canonical_name: string;
  canonical_name_ne?: string;
  entity_type: string;
  total_mentions: number;
  last_seen?: string;
}

export interface EntityListResponse {
  items: PoliticalEntity[];
  total: number;
}

export interface EntityStoriesResponse {
  items: Array<{ id: string; title: string; published_at: string }>;
  total: number;
}

export interface EntityTimelineResponse {
  days: Array<{ date: string; count: number }>;
}

export interface KeyActor {
  id: string;
  canonical_name: string;
  entity_type: string;
  mention_count: number;
  stories: Array<{ id: string; title: string }>;
}

export interface ConsolidatedStory {
  id: string;
  title: string;
  summary?: string;
  category?: string;
  severity?: string;
  published_at: string;
  source_count: number;
  cluster_id?: string;
}

export interface TrendsData {
  labels: string[];
  stories: number[];
  events: number[];
}

export interface StorySummaryResponse {
  summary: string;
  key_entities: Array<{ name: string; type: string }>;
  sources: Array<{ name: string; url?: string }>;
}

export interface ClusterSummaryResponse {
  summary: string;
  key_entities: Array<{ name: string; type: string }>;
  sources: Array<{ name: string; url?: string }>;
}

// =============================================================================
// API Functions (stubs — return empty data)
// =============================================================================

export async function getTrends(days: number = 30): Promise<Array<{ event_type: string; trend: Array<{ date: string; count: number }> }>> {
  try {
    const { data } = await apiClient.get('/analytics/trends', { params: { days } });
    return data;
  } catch {
    return [];
  }
}

export async function getStorySummary(storyId: string): Promise<StorySummaryResponse> {
  const { data } = await apiClient.get(`/stories/${storyId}/summary`);
  return data;
}

export async function getClusterSummary(clusterId: string): Promise<ClusterSummaryResponse> {
  const { data } = await apiClient.get(`/stories/clusters/${clusterId}/summary`);
  return data;
}

export async function getAnalyticsSummary(
  _hours: number,
  _districts?: string[],
): Promise<AnalyticsSummary> {
  const { data } = await apiClient.get('/analytics/summary', {
    params: { hours: _hours, districts: _districts?.join(',') },
  });
  return data;
}

export async function getYouthStress(): Promise<DistrictStress[]> {
  try {
    const { data } = await apiClient.get('/analytics/youth-stress');
    return data;
  } catch {
    return [];
  }
}

export async function getDistrictThreats(hours: number): Promise<DistrictThreat[]> {
  try {
    const { data } = await apiClient.get('/analytics/district-threats', {
      params: { hours },
    });
    return data;
  } catch {
    return [];
  }
}

export async function getDistrictMetrics(): Promise<DistrictMetric[]> {
  try {
    const { data } = await apiClient.get('/analytics/district-metrics');
    return data;
  } catch {
    return [];
  }
}

export async function getDistrictBrief(district: string): Promise<DistrictBrief> {
  const { data } = await apiClient.get(`/analytics/district-brief/${encodeURIComponent(district)}`);
  return data;
}

export async function getPoliticalEntities(
  entityType?: string,
  search?: string,
  hasMentions?: boolean,
  limit: number = 50,
  offset: number = 0,
): Promise<EntityListResponse> {
  const { data } = await apiClient.get('/entities/political', {
    params: { entity_type: entityType, search, has_mentions: hasMentions, limit, offset },
  });
  return data;
}

export async function getPoliticalEntity(entityId: string): Promise<PoliticalEntity> {
  const { data } = await apiClient.get(`/entities/political/${entityId}`);
  return data;
}

export async function getPoliticalEntityByCanonicalId(canonicalId: string): Promise<PoliticalEntity> {
  const { data } = await apiClient.get(`/entities/political/canonical/${canonicalId}`);
  return data;
}

export async function getEntityStories(
  entityId: string,
  hours: number = 168,
  limit: number = 50,
  offset: number = 0,
  category?: string,
): Promise<EntityStoriesResponse> {
  const { data } = await apiClient.get(`/entities/political/${entityId}/stories`, {
    params: { hours, limit, offset, category },
  });
  return data;
}

export async function getEntityTimeline(
  entityId: string,
  days: number = 30,
): Promise<EntityTimelineResponse> {
  const { data } = await apiClient.get(`/entities/political/${entityId}/timeline`, {
    params: { days },
  });
  return data;
}

export async function getKeyActorDetail(entityId: string): Promise<KeyActor> {
  const { data } = await apiClient.get(`/entities/key-actors/${entityId}`);
  return data;
}

export async function getConsolidatedStories(
  hours: number = 24,
  storyType?: string,
  severity?: string,
  limit: number = 10,
): Promise<ConsolidatedStory[]> {
  const { data } = await apiClient.get('/stories/consolidated', {
    params: { hours, story_type: storyType, severity, limit },
  });
  return data;
}
