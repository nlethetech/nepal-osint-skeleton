import apiClient from './client'

// ============================================================================
// Types
// ============================================================================

export interface EntityBrief {
  id: string
  name_en: string
  entity_type: string
  party?: string
  image_url?: string
}

export interface EntityProfile {
  entity: {
    id: string
    canonical_id: string
    name_en: string
    name_ne?: string
    entity_type: string
    party?: string
    role?: string
    aliases: string[]
    description?: string
    image_url?: string
    total_mentions: number
    mentions_24h: number
    mentions_7d: number
    trend: string
    last_mentioned_at?: string
    is_watchable: boolean
    extra_data?: Record<string, unknown>
  }
  mention_summary: {
    by_period: Record<string, number>
    daily_trend: Array<{ date: string; count: number }>
  }
  recent_stories?: Array<{
    id: string
    title: string
    summary?: string
    url: string
    source_name: string
    category?: string
    severity?: string
    published_at?: string
    mention_confidence?: number
    is_title_mention?: boolean
  }>
  story_categories?: Record<string, number>
  relationships?: Record<string, Array<{
    entity: EntityBrief
    strength: number
    co_mentions: number
    is_verified: boolean
    last_interaction?: string
  }>>
  top_co_mentions?: Array<{
    entity: EntityBrief
    co_mention_count: number
    strength: number
  }>
  network_metrics?: Record<string, {
    pagerank?: number
    degree_centrality?: number
    betweenness_centrality?: number
    eigenvector_centrality?: number
    clustering_coefficient?: number
    cluster_id?: number
    is_hub: boolean
    is_authority: boolean
    is_bridge: boolean
    influence_rank?: number
    total_connections: number
    computed_at?: string
  }>
  parliament_record?: {
    member_id: string
    constituency?: string
    election_type?: string
    term_start?: string
    term_end?: string
    is_current: boolean
    speeches_count: number
    questions_count: number
    attendance_rate?: number
    committee_memberships?: string[]
  }
  generated_at: string
}

export interface NetworkGraph {
  elements: {
    nodes: Array<{
      data: {
        id: string
        label: string
        type: string
        party?: string
        pagerank?: number
        degree?: number
        cluster?: number
        isHub?: boolean
        isBridge?: boolean
        influenceRank?: number
        isCenter?: boolean
      }
    }>
    edges: Array<{
      data: {
        id: string
        source: string
        target: string
        weight: number
        coMentions: number
        type?: string
      }
    }>
  }
  stats?: {
    nodeCount: number
    edgeCount: number
    windowType: string
  }
  center_entity?: string
  window_type?: string
}

export interface LeaderboardEntry {
  rank: number
  entity: EntityBrief
  metrics: {
    pagerank?: number
    degree?: number
    betweenness?: number
    eigenvector?: number
    total_connections: number
    is_hub: boolean
    is_bridge: boolean
    cluster_id?: number
  }
}

export interface Community {
  cluster_id: number
  name?: string
  description?: string
  member_count: number
  dominant_party?: string
  dominant_entity_type?: string
  density?: number
  central_entities: EntityBrief[]
  computed_at?: string
}

export interface SearchResult {
  id: string
  canonical_id: string
  name_en: string
  name_ne?: string
  entity_type: string
  party?: string
  role?: string
  total_mentions: number
  mentions_24h: number
  trend: string
  match_type: string
  image_url?: string
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get comprehensive entity profile (dossier)
 */
export const getEntityProfile = async (
  entityId: string,
  options?: {
    includeStories?: boolean
    includeRelationships?: boolean
    includeMetrics?: boolean
    includeParliament?: boolean
    storyLimit?: number
    relationshipLimit?: number
  }
): Promise<EntityProfile> => {
  const response = await apiClient.get(`/entities/${entityId}/profile`, {
    params: {
      include_stories: options?.includeStories ?? true,
      include_relationships: options?.includeRelationships ?? true,
      include_metrics: options?.includeMetrics ?? true,
      include_parliament: options?.includeParliament ?? true,
      story_limit: options?.storyLimit ?? 20,
      relationship_limit: options?.relationshipLimit ?? 30,
    },
  })
  return response.data
}

/**
 * Get entity relationships
 */
export const getEntityRelationships = async (
  entityId: string,
  options?: {
    relationshipType?: string
    minStrength?: number
    limit?: number
  }
): Promise<{
  entity_id: string
  entity_name: string
  relationships: Array<{
    id: string
    other_entity: EntityBrief
    relationship_type: string
    strength: number
    co_mentions: number
    confidence?: number
    is_verified: boolean
    first_co_mention_at?: string
    last_co_mention_at?: string
  }>
  total: number
}> => {
  const response = await apiClient.get(`/entities/${entityId}/relationships`, {
    params: {
      relationship_type: options?.relationshipType,
      min_strength: options?.minStrength ?? 0,
      limit: options?.limit ?? 50,
    },
  })
  return response.data
}

/**
 * Get entity network subgraph in Cytoscape format
 */
export const getEntityNetwork = async (
  entityId: string,
  options?: {
    window?: string
    depth?: number
    minStrength?: number
    limit?: number
  }
): Promise<NetworkGraph> => {
  const response = await apiClient.get(`/entities/${entityId}/network`, {
    params: {
      window: options?.window ?? '7d',
      depth: options?.depth ?? 1,
      min_strength: options?.minStrength ?? 0.1,
      limit: options?.limit ?? 50,
    },
  })
  return response.data
}

/**
 * Get full network graph
 */
export const getFullNetworkGraph = async (
  options?: {
    window?: string
    minStrength?: number
    limitNodes?: number
  }
): Promise<NetworkGraph> => {
  const response = await apiClient.get('/entities/network/graph', {
    params: {
      window: options?.window ?? '7d',
      min_strength: options?.minStrength ?? 0.1,
      limit_nodes: options?.limitNodes ?? 100,
    },
  })
  return response.data
}

/**
 * Get influence leaderboard
 */
export const getInfluenceLeaderboard = async (
  options?: {
    window?: string
    metric?: string
    limit?: number
  }
): Promise<{
  window_type: string
  metric: string
  leaderboard: LeaderboardEntry[]
}> => {
  const response = await apiClient.get('/entities/network/metrics/leaderboard', {
    params: {
      window: options?.window ?? '7d',
      metric: options?.metric ?? 'pagerank',
      limit: options?.limit ?? 20,
    },
  })
  return response.data
}

/**
 * Get detected communities
 */
export const getNetworkCommunities = async (
  window?: string
): Promise<{
  window_type: string
  communities: Community[]
}> => {
  const response = await apiClient.get('/entities/network/communities', {
    params: { window: window ?? '7d' },
  })
  return response.data
}

/**
 * Autocomplete search
 */
export const autocompleteEntities = async (
  query: string,
  limit?: number
): Promise<Array<{ id: string; name: string; type: string }>> => {
  const response = await apiClient.get('/entities/search/autocomplete', {
    params: { q: query, limit: limit ?? 10 },
  })
  return response.data
}

/**
 * Fuzzy search entities
 */
export const fuzzySearchEntities = async (
  query: string,
  options?: {
    entityType?: string
    party?: string
    minMentions?: number
    limit?: number
  }
): Promise<SearchResult[]> => {
  const response = await apiClient.get('/entities/search/fuzzy', {
    params: {
      q: query,
      entity_type: options?.entityType,
      party: options?.party,
      min_mentions: options?.minMentions ?? 0,
      limit: options?.limit ?? 20,
    },
  })
  return response.data
}

/**
 * Get trending entities
 */
export const getTrendingEntities = async (
  options?: {
    hours?: number
    entityType?: string
    limit?: number
  }
): Promise<Array<{
  id: string
  canonical_id: string
  name_en: string
  entity_type: string
  party?: string
  mentions_24h: number
  trend: string
  image_url?: string
}>> => {
  const response = await apiClient.get('/entities/search/trending', {
    params: {
      hours: options?.hours ?? 24,
      entity_type: options?.entityType,
      limit: options?.limit ?? 20,
    },
  })
  return response.data
}

/**
 * Trigger network computation (admin)
 */
export const triggerNetworkComputation = async (
  window?: string
): Promise<{ status: string; window_type: string; stats: Record<string, number> }> => {
  const response = await apiClient.post('/entities/network/compute', null, {
    params: { window: window ?? '7d' },
  })
  return response.data
}

/**
 * Trigger relationship discovery (admin)
 */
export const triggerRelationshipDiscovery = async (
  hours?: number,
  minConfidence?: number
): Promise<{ status: string; stats: Record<string, number> }> => {
  const response = await apiClient.post('/entities/relationships/discover', null, {
    params: {
      hours: hours ?? 720,
      min_confidence: minConfidence ?? 0.5,
    },
  })
  return response.data
}
