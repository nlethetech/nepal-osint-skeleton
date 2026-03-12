import apiClient from './client'
import { useQuery } from '@tanstack/react-query'

// ============================================================================
// Types
// ============================================================================

export interface GraphNodeData {
  id: string
  label: string
  node_type: string
  type?: string
  canonical_key?: string
  district?: string
  province?: string
  latitude?: number
  longitude?: number
  subtype?: string
  confidence: number
  properties: Record<string, unknown>
  // Metrics (when available)
  degree?: number
  pagerank?: number
  is_hub?: boolean
  is_bridge?: boolean
  // Compound node fields
  member_count?: number
  parent?: string
}

export interface GraphNode {
  data: GraphNodeData
}

export interface GraphEdgeData {
  id: string
  source: string
  target: string
  predicate: string
  weight: number
  confidence: number
  is_current: boolean
  properties: Record<string, unknown>
}

export interface GraphEdge {
  data: GraphEdgeData
}

export interface DistrictSummary {
  id: string
  name_en: string
  name_ne?: string
  province_id: number
  province_name: string
  graph_node_id?: string
  node_count: number
  latitude?: number
  longitude?: number
}

export interface GraphOverviewResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  rendered_nodes: number
  rendered_edges: number
  total_graph_nodes: number
  total_graph_edges: number
}

export interface GraphExpandResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  total_neighbors: number
  has_more: boolean
  offset: number
  limit: number
}

export interface GraphNeighborhoodResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
  depth_reached: number
}

export interface GraphPathResponse {
  found: boolean
  path: string[]      // node UUIDs in traversal order
  edges: string[]     // edge UUIDs along the path
  length: number
}

export interface GraphSearchResponse {
  nodes: GraphNode[]
  total: number
}

export interface GraphStatsResponse {
  total_nodes: number
  total_edges: number
  by_type: Record<string, number>
  by_predicate: Record<string, number>
  by_district: Record<string, number>
}

export interface GraphHealthDomainCoverage {
  source_table: string
  total_nodes: number
  connected_nodes: number
  coverage_ratio: number
}

export interface GraphHealthResponse {
  status: 'healthy' | 'degraded' | string
  total_nodes: number
  total_edges: number
  connected_node_ratio: number
  largest_component_ratio: number
  per_domain_coverage: GraphHealthDomainCoverage[]
  thresholds_breached: string[]
}

export interface GraphTimeseriesBucket {
  bucket_start: string
  total_edges: number
  by_predicate: Record<string, number>
  by_domain: Record<string, number>
}

export interface GraphTimeseriesResponse {
  window: string
  bucket: 'hour' | 'day' | 'week' | string
  from_ts?: string
  to_ts?: string
  series: GraphTimeseriesBucket[]
}

export interface EdgeDetail {
  id: string
  predicate: string
  direction: 'outgoing' | 'incoming'
  peer_id: string
  peer_title?: string
  peer_type?: string
  weight: number
  confidence: number
  valid_from?: string
  valid_to?: string
  properties: Record<string, unknown>
}

export interface GraphNodeDetailResponse {
  id: string
  node_type: string
  type?: string
  canonical_key?: string
  title: string
  title_ne?: string
  subtitle?: string
  description?: string
  subtype?: string
  district?: string
  province?: string
  latitude?: number
  longitude?: number
  properties: Record<string, unknown>
  source_table?: string
  source_id?: string
  confidence: number
  source_count: number
  is_canonical: boolean
  canonical_node_id?: string
  first_seen_at?: string
  last_seen_at?: string
  created_at?: string
  edges: EdgeDetail[]
  total_outgoing: number
  total_incoming: number
  metrics: Record<string, unknown>[]
  resolutions: Record<string, unknown>[]
}

export interface DistrictListResponse {
  districts: DistrictSummary[]
  total: number
}

export interface ResolveNodeRequest {
  source_table: string
  source_id: string
  canonical_key?: string
}

export interface ResolveNodeResponse {
  found: boolean
  node?: GraphNode
}

export interface UnifiedTimelineEvent {
  event_type: string
  timestamp?: string
  title: string
  object_id?: string
  link_id?: string
  confidence?: number
  source_count?: number
  verification_status?: string
  provenance_refs?: Record<string, unknown>[]
}

export interface UnifiedTimelineResponse {
  center: {
    id: string
    title: string
    object_type: string
  }
  events: UnifiedTimelineEvent[]
  total: number
}

export interface NodeProfileResponse {
  node: {
    id: string
    title: string
    node_type: string
    type?: string
    subtype?: string
    district?: string
    province?: string
    latitude?: number
    longitude?: number
    description?: string
    source_table?: string
    source_id?: string
    properties: Record<string, unknown>
    confidence: number
  }
  profile_type: string
  summary: Record<string, unknown>
  relationships: {
    total: number
    by_predicate: Record<string, number>
    top_neighbors: Array<{
      peer_id?: string
      peer_title?: string
      peer_type?: string
      predicate?: string
      confidence?: number
    }>
  }
  quality: {
    quality_score: number
    missing_fields: string[]
    provenance_count: number
    last_updated?: string
  }
}

export interface GraphCorrectionEntry {
  id: string
  action: string
  status: 'pending' | 'approved' | 'rejected' | 'rolled_back' | string
  node_id?: string
  edge_id?: string
  payload: Record<string, unknown>
  reason: string
  submitted_by: string
  submitted_by_email: string
  submitted_at?: string
  reviewed_by?: string
  reviewed_at?: string
  review_notes?: string
  rejection_reason?: string
  applied_change?: Record<string, unknown>
  applied_at?: string
  rolled_back_by?: string
  rolled_back_at?: string
  rollback_reason?: string
}

export interface GraphCorrectionListResponse {
  items: GraphCorrectionEntry[]
  pending_count: number
  page: number
  total: number
  total_pages: number
}

export interface GraphCorrectionActionResponse {
  id: string
  status: string
  message: string
}

// ============================================================================
// Query parameter interfaces
// ============================================================================

export interface ExpandNodeParams {
  offset?: number
  limit?: number
  predicates?: string
  min_confidence?: number
  as_of?: string
  from_ts?: string
  to_ts?: string
  window?: '24h' | '7d' | '30d' | 'all_time'
  include_inferred?: boolean
}

export interface NeighborhoodParams {
  depth?: number
  limit?: number
  min_confidence?: number
  node_types?: string
  as_of?: string
  from_ts?: string
  to_ts?: string
  window?: '24h' | '7d' | '30d' | 'all_time'
  include_inferred?: boolean
}

export interface SearchParams {
  node_types?: string
  districts?: string
  limit?: number
}

export interface TemporalQueryParams {
  as_of?: string
  from_ts?: string
  to_ts?: string
  window?: '24h' | '7d' | '30d' | 'all_time'
  include_inferred?: boolean
}

// ============================================================================
// API functions
// ============================================================================

const GRAPH_BASE = '/unified-graph'

export const getGraphOverview = (params?: TemporalQueryParams) =>
  apiClient.get<GraphOverviewResponse>(`${GRAPH_BASE}/overview`, { params })

export const expandNode = (nodeId: string, params?: ExpandNodeParams) =>
  apiClient.get<GraphExpandResponse>(`${GRAPH_BASE}/expand/${nodeId}`, { params })

export const getNeighborhood = (nodeId: string, params?: NeighborhoodParams) =>
  apiClient.get<GraphNeighborhoodResponse>(`${GRAPH_BASE}/neighborhood/${nodeId}`, { params })

export const findPath = (fromNode: string, toNode: string, maxDepth?: number) =>
  apiClient.get<GraphPathResponse>(`${GRAPH_BASE}/path`, {
    params: { from_node: fromNode, to_node: toNode, max_depth: maxDepth },
  })

export const searchGraph = (q: string, params?: SearchParams) =>
  apiClient.get<GraphSearchResponse>(`${GRAPH_BASE}/search`, {
    params: { q, ...params },
  })

export const getGraphStats = (params?: TemporalQueryParams) =>
  apiClient.get<GraphStatsResponse>(`${GRAPH_BASE}/stats`, { params })

export const getGraphHealth = () =>
  apiClient.get<GraphHealthResponse>(`${GRAPH_BASE}/health`)

export const getGraphTimeseries = (params?: {
  bucket?: 'hour' | 'day' | 'week'
} & TemporalQueryParams) =>
  apiClient.get<GraphTimeseriesResponse>(`${GRAPH_BASE}/timeseries`, { params })

export const getNodeDetail = (nodeId: string, params?: TemporalQueryParams) =>
  apiClient.get<GraphNodeDetailResponse>(`${GRAPH_BASE}/node/${nodeId}`, { params })

export const listDistricts = () =>
  apiClient.get<DistrictListResponse>(`${GRAPH_BASE}/districts`)

export const resolveGraphNode = (payload: ResolveNodeRequest) =>
  apiClient.post<ResolveNodeResponse>(`${GRAPH_BASE}/resolve-node`, payload)

export const getUnifiedNodeTimeline = (nodeId: string, limit = 100) =>
  apiClient.get<UnifiedTimelineResponse>(`${GRAPH_BASE}/node/${nodeId}/timeline`, {
    params: { limit },
  })

export const getUnifiedNodeProfile = (nodeId: string) =>
  apiClient.get<NodeProfileResponse>(`${GRAPH_BASE}/node/${nodeId}/profile`)

export const submitGraphCorrection = (payload: {
  action: string
  reason: string
  payload: Record<string, unknown>
  node_id?: string
  edge_id?: string
}) => apiClient.post<GraphCorrectionActionResponse>(`${GRAPH_BASE}/corrections`, payload)

export const fetchGraphCorrections = (params?: {
  status?: string
  page?: number
  per_page?: number
}) => apiClient.get<GraphCorrectionListResponse>(`${GRAPH_BASE}/corrections`, { params })

export const approveGraphCorrection = (correctionId: string, notes?: string) =>
  apiClient.post<GraphCorrectionActionResponse>(
    `${GRAPH_BASE}/corrections/${correctionId}/approve`,
    null,
    { params: { notes } },
  )

export const rejectGraphCorrection = (correctionId: string, reason: string) =>
  apiClient.post<GraphCorrectionActionResponse>(
    `${GRAPH_BASE}/corrections/${correctionId}/reject`,
    null,
    { params: { reason } },
  )

export const rollbackGraphCorrection = (correctionId: string, reason: string) =>
  apiClient.post<GraphCorrectionActionResponse>(
    `${GRAPH_BASE}/corrections/${correctionId}/rollback`,
    null,
    { params: { reason } },
  )

// ============================================================================
// React Query hooks
// ============================================================================

export const useGraphOverview = () =>
  useQuery({
    queryKey: ['unified-graph-overview'],
    queryFn: () => getGraphOverview().then((r) => r.data),
    staleTime: 120_000,
  })

export const useExpandNode = (nodeId: string | null, params?: ExpandNodeParams) =>
  useQuery({
    queryKey: ['unified-graph-expand', nodeId, params],
    queryFn: () => expandNode(nodeId!, params).then((r) => r.data),
    enabled: !!nodeId,
    staleTime: 60_000,
  })

export const useNeighborhood = (nodeId: string | null, params?: NeighborhoodParams) =>
  useQuery({
    queryKey: ['unified-graph-neighborhood', nodeId, params],
    queryFn: () => getNeighborhood(nodeId!, params).then((r) => r.data),
    enabled: !!nodeId,
    staleTime: 60_000,
  })

export const useGraphSearch = (query: string, params?: SearchParams) =>
  useQuery({
    queryKey: ['unified-graph-search', query, params],
    queryFn: () => searchGraph(query, params).then((r) => r.data),
    enabled: query.length >= 2,
    staleTime: 30_000,
  })

export const useGraphStats = () =>
  useQuery({
    queryKey: ['unified-graph-stats'],
    queryFn: () => getGraphStats().then((r) => r.data),
    staleTime: 300_000,
  })

export const useGraphHealth = () =>
  useQuery({
    queryKey: ['unified-graph-health'],
    queryFn: () => getGraphHealth().then((r) => r.data),
    staleTime: 60_000,
  })

export const useNodeDetail = (nodeId: string | null) =>
  useQuery({
    queryKey: ['unified-graph-node', nodeId],
    queryFn: () => getNodeDetail(nodeId!).then((r) => r.data),
    enabled: !!nodeId,
    staleTime: 60_000,
  })

export const useDistricts = () =>
  useQuery({
    queryKey: ['unified-graph-districts'],
    queryFn: () => listDistricts().then((r) => r.data),
    staleTime: 600_000,
  })
