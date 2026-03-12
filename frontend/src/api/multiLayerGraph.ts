import apiClient from './client'

// ============================================================================
// Types
// ============================================================================

/** Graph layer identifiers */
export type GraphLayer = 'trade' | 'entity' | 'news' | 'disaster' | 'geographic'

/** Node types across all layers */
export type GraphNodeType =
  | 'nepal' | 'province' | 'district' | 'constituency'
  | 'person' | 'party' | 'organization' | 'institution' | 'government'
  | 'partner_country' | 'hs_chapter' | 'customs_office'
  | 'disaster_incident' | 'hazard_type' | 'story'

/** Edge types across all layers */
export type GraphEdgeType =
  | 'HAS_PROVINCE' | 'HAS_DISTRICT' | 'HAS_CONSTITUENCY' | 'CUSTOMS_IN_DISTRICT'
  | 'IMPORTS_FROM' | 'EXPORTS_TO' | 'TRADES_COMMODITY' | 'CUSTOMS_IMPORTS' | 'CUSTOMS_EXPORTS'
  | 'PARTY_MEMBER' | 'FORMER_PARTY_MEMBER' | 'RAN_IN' | 'OPPONENT'
  | 'WAS_PM' | 'WAS_MINISTER_OF' | 'IS_MP' | 'REPRESENTS' | 'PROVINCIAL_GOVT'
  | 'CO_MENTION' | 'POLITICAL_ALLY' | 'POLITICAL_OPPONENT' | 'FAMILY'
  | 'CO_MENTIONED_IN' | 'MENTIONED_IN' | 'STORY_IN_DISTRICT'
  | 'DISASTER_IN' | 'DISASTER_IN_PROVINCE' | 'IS_HAZARD_TYPE'
  | 'FUNDS' | 'IMPLEMENTS'

export interface GraphNodeData {
  id: string
  label: string
  type: GraphNodeType
  layer: GraphLayer
  layers?: GraphLayer[]
  // Type-specific fields
  pagerank?: number
  tradeValue?: number
  imports?: number
  exports?: number
  deaths?: number
  severity?: string
  party?: string
  category?: string
  provinceId?: number
  district?: string
  isHub?: boolean
  isBridge?: boolean
  isCenter?: boolean
  isExpanded?: boolean
  fiscalYear?: string
  [key: string]: unknown
}

export interface GraphEdgeData {
  id: string
  source: string
  target: string
  edgeType: GraphEdgeType
  layer: GraphLayer
  label?: string
  weight?: number
  value?: number
  style?: 'solid' | 'dashed' | 'dotted'
  [key: string]: unknown
}

export interface GraphNode {
  data: GraphNodeData
}

export interface GraphEdge {
  data: GraphEdgeData
}

export interface MultiLayerGraphResponse {
  elements: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
  stats: {
    nodeCount: number
    edgeCount: number
    layers: GraphLayer[]
  }
  metadata?: Record<string, unknown>
}

export interface GraphMetadata {
  fiscal_years: string[]
  election_years: number[]
}

// ============================================================================
// Parameter Interfaces
// ============================================================================

export interface TradeGraphParams {
  fiscal_year_bs?: string
  direction?: string
  top_countries?: number
  top_hs_chapters?: number
  min_value_npr_thousands?: number
  expand_country?: string
  expand_hs_chapter?: string
  include_customs?: boolean
  top_customs?: number
}

export interface EntityGraphParams {
  window?: string
  min_strength?: number
  limit_nodes?: number
  include_parties?: boolean
  include_constituencies?: boolean
  include_ministerial?: boolean
  include_opponents?: boolean
  include_geographic?: boolean
  election_year_bs?: number
}

export interface GeographicGraphParams {
  expand_province_id?: number
  expand_district?: string
}

export interface NewsGraphParams {
  hours?: number
  min_co_mentions?: number
  limit_entities?: number
  include_story_nodes?: boolean
  category?: string
  include_districts?: boolean
  include_entity_connections?: boolean
}

export interface DisasterGraphParams {
  days?: number
  min_severity?: string
  hazard_type?: string
  limit_incidents?: number
}

export interface CombinedGraphParams {
  layers: GraphLayer[]
  fiscal_year_bs?: string
  direction?: string
  top_countries?: number
  window?: string
  min_strength?: number
  limit_nodes?: number
  include_parties?: boolean
  include_constituencies?: boolean
  include_ministerial?: boolean
  include_opponents?: boolean
  include_geographic?: boolean
  expand_province_id?: number
  expand_district?: string
  news_hours?: number
  min_co_mentions?: number
  disaster_days?: number
  election_year_bs?: number
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get trade layer graph (countries, HS chapters, customs offices)
 */
export const getTradeGraph = async (params?: TradeGraphParams): Promise<MultiLayerGraphResponse> => {
  const response = await apiClient.get('/graph/multi-layer/trade', { params })
  return response.data
}

/**
 * Get entity layer graph (people, parties, political relationships)
 */
export const getEntityGraph = async (params?: EntityGraphParams): Promise<MultiLayerGraphResponse> => {
  const response = await apiClient.get('/graph/multi-layer/entity', { params })
  return response.data
}

/**
 * Get geographic layer graph (provinces, districts, constituencies)
 */
export const getGeographicGraph = async (params?: GeographicGraphParams): Promise<MultiLayerGraphResponse> => {
  const response = await apiClient.get('/graph/multi-layer/geographic', { params })
  return response.data
}

/**
 * Get news layer graph (entity co-mentions, stories, districts)
 */
export const getNewsGraph = async (params?: NewsGraphParams): Promise<MultiLayerGraphResponse> => {
  const response = await apiClient.get('/graph/multi-layer/news', { params })
  return response.data
}

/**
 * Get disaster layer graph (incidents, affected districts)
 */
export const getDisasterGraph = async (params?: DisasterGraphParams): Promise<MultiLayerGraphResponse> => {
  const response = await apiClient.get('/graph/multi-layer/disaster', { params })
  return response.data
}

/**
 * Get combined multi-layer graph (merge multiple layers into one response)
 */
export const getCombinedGraph = async (params: CombinedGraphParams): Promise<MultiLayerGraphResponse> => {
  const response = await apiClient.get('/graph/multi-layer/combined', {
    params,
    paramsSerializer: {
      indexes: null,  // serialize arrays as layers=a&layers=b (not layers[]=a)
    },
  })
  return response.data
}

/**
 * Get graph metadata (available fiscal years and election years)
 */
export const getGraphMetadata = async (): Promise<GraphMetadata> => {
  const response = await apiClient.get('/graph/multi-layer/metadata')
  return response.data
}
