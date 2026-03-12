// API Response Types for Nepal OSINT Platform

// Pagination
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

// Entity Types
export type EntityType = 'PERSON' | 'ORGANIZATION' | 'LOCATION' | 'DISTRICT'

export interface Entity {
  id: string
  name: string
  name_ne?: string
  entity_type: EntityType
  normalized_name: string
  mention_count: number
  first_seen_at: string
  last_seen_at: string
  is_verified?: boolean
  is_irrelevant?: boolean
  avg_confidence?: number
}

// Human-in-the-Loop Entity Resolution Types
export interface SimilarEntity {
  id: string
  name: string
  name_ne?: string
  entity_type: EntityType
  mention_count: number
  similarity_score: number
  match_reason: 'exact_match' | 'substring_match' | 'shared_words' | 'fuzzy_match'
}

export interface MergeSuggestion {
  entity: Entity
  suggestions: SimilarEntity[]
  total_suggestions: number
}

export interface MergeRequest {
  source_ids: string[]
  target_id: string
  reason?: string
}

export interface MergeResponse {
  success: boolean
  merged_count: number
  target_entity: Entity
  merged_entity_names: string[]
}

export interface BulkActionRequest {
  entity_ids: string[]
  action: 'verify' | 'mark_irrelevant' | 'unverify' | 'restore'
}

export interface BulkActionResponse {
  success: boolean
  affected_count: number
  action: string
}

// Story Types
export interface Story {
  id: string
  external_id: string
  source_id: string
  title: string
  title_ne?: string
  url: string
  summary?: string
  language: string
  published_at: string
  created_at: string
}

// Event Types
export type EventType =
  | 'protest' | 'election' | 'flood' | 'earthquake'
  | 'price_shock' | 'power_outage' | 'border' | 'terrorism'
  | 'corruption' | 'diplomacy' | 'health_crisis' | 'crime'
  | 'military' | 'remittance'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Event {
  id: string
  story_id: string
  event_type: EventType
  confidence: number
  severity: Severity
  triggers: string[]
  metadata?: Record<string, unknown>
  occurred_at?: string
  created_at: string
  districts?: string[]
}

// Alert Types
export type AlertType = 'event_spike' | 'multi_district' | 'anomaly'

export interface Alert {
  id: string
  alert_type: AlertType
  severity: Severity
  title: string
  description: string
  rule_id?: string
  related_entity_ids: string[]
  related_event_ids: string[]
  related_district_names: string[]
  is_read: boolean
  acknowledged_at?: string
  created_at: string
}

export interface AlertRule {
  id: string
  name: string
  description: string
  rule_type: 'threshold' | 'composite' | 'anomaly'
  config: Record<string, unknown>
  is_active: boolean
  created_at: string
}

// Graph Types
export interface GraphNode {
  id: string
  label: string
  type: string
  properties: Record<string, unknown>
}

export interface GraphEdge {
  source: string
  target: string
  type: string
  confidence: number
  properties?: Record<string, unknown>
  // Palantir-grade relationship intelligence
  rel_type?: string  // Classified relationship type (MEMBER_OF, LEADS, etc.)
  llm_confidence?: number  // LLM classification confidence
  mention_count?: number  // Co-occurrence count
}

export interface SubgraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// Analytics Types
export interface DistrictStress {
  district: string
  lat: number
  lng: number
  youth_stress: number
  level: 'high' | 'elevated' | 'low'
  event_count: number
  event_types: Record<string, number>
}

export interface TrendPoint {
  date: string
  count: number
}

export interface EventTrend {
  event_type: EventType
  trend: TrendPoint[]
}

export interface AnalyticsSummary {
  stories: number
  events: number
  entities: number
  active_alerts: number
  top_event_types: Array<{ event_type: string; count: number }>
  time_range_hours: number
}

// Search Types
export interface SearchResult {
  id: string
  type: 'story' | 'entity'
  title: string
  snippet?: string
  subtitle?: string
  score: number
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  total: number
}
