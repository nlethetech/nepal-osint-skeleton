import apiClient from './client'
import type { SubgraphResponse, EntityType } from '../types/api'

export interface GraphCentralityResult {
  id: string
  label: string
  type: string
  score: number
}

export interface CommunityResult {
  community_id: number
  nodes: string[]
  size: number
}

export interface GraphStats {
  node_count: number
  edge_count: number
  node_types: Record<string, number>
  edge_types: Record<string, number>
}

export interface SubgraphOptions {
  depth?: number
  maxNeighbors?: number
  classifiedOnly?: boolean
}

export const getSubgraph = async (
  nodeId: string,
  options: SubgraphOptions = {}
): Promise<SubgraphResponse> => {
  const { depth = 1, maxNeighbors = 100, classifiedOnly = false } = options
  const response = await apiClient.get(`/graph/subgraph/${nodeId}`, {
    params: {
      depth,
      max_neighbors: maxNeighbors,
      classified_only: classifiedOnly,
    },
  })
  return response.data
}

export const getShortestPath = async (sourceId: string, targetId: string) => {
  const response = await apiClient.get('/graph/shortest-path', {
    params: {
      source_id: sourceId,
      target_id: targetId,
    },
  })
  return response.data
}

export const getCentrality = async (nodeType?: EntityType, limit: number = 50): Promise<GraphCentralityResult[]> => {
  const response = await apiClient.get('/graph/centrality', {
    params: {
      node_type: nodeType,
      limit,
    },
  })
  return response.data
}

export const getCommunities = async (limit: number = 20): Promise<{ communities: CommunityResult[] }> => {
  const response = await apiClient.get('/graph/communities', {
    params: { limit },
  })
  return response.data
}

export const getGraphStats = async (): Promise<GraphStats> => {
  const response = await apiClient.get('/graph/stats')
  return response.data
}

export interface RebuildResponse {
  status: string
  message: string
  stats?: Record<string, number>
}

/**
 * Rebuild graph from KB entities (Palantir-grade).
 * This ensures Neo4j node IDs match KB entity IDs for proper frontend display.
 */
export const rebuildGraphFromKB = async (): Promise<RebuildResponse> => {
  const response = await apiClient.post('/graph/rebuild-kb')
  return response.data
}

// =============================================================================
// RELATIONSHIP CLASSIFICATION (Palantir-grade intelligence)
// =============================================================================

export interface ClassifyRequest {
  max_pairs?: number
  provider?: 'anthropic' | 'ollama'  // Default: anthropic (Claude Haiku)
  ollama_url?: string
  model?: string
  batch_size?: number
}

export interface ClassifyResponse {
  status: string
  message: string
  classified: number
  failed: number
  types: Record<string, number>
}

/**
 * Classify CO_OCCURS_WITH edges using LLM to determine relationship types.
 * Converts generic co-occurrence edges into typed relationships like
 * MEMBER_OF, LEADS, AFFILIATED_WITH, OPPOSES, etc.
 *
 * Call after rebuildGraphFromKB() to add relationship intelligence.
 *
 * @param options.max_pairs - Maximum pairs to classify (default 300)
 * @param options.provider - 'anthropic' (Claude Haiku) or 'ollama' (default: anthropic)
 * @param options.ollama_url - Ollama server URL (for ollama provider)
 * @param options.model - LLM model to use (auto-selected based on provider)
 * @param options.batch_size - Batch size for Anthropic processing (default 20)
 */
export const classifyRelationships = async (
  options: ClassifyRequest = {}
): Promise<ClassifyResponse> => {
  const response = await apiClient.post('/graph/classify-relationships', {
    max_pairs: options.max_pairs || 300,
    provider: options.provider || 'anthropic',
    ollama_url: options.ollama_url || 'http://localhost:11434',
    model: options.model,  // Let backend auto-select if not provided
    batch_size: options.batch_size || 20,
  })
  return response.data
}

// =============================================================================
// BATCH CLASSIFICATION API (50% cost savings - proper Anthropic batch workflow)
// =============================================================================

export interface BatchSubmitRequest {
  max_pairs?: number
  model?: string
}

export interface BatchSubmitResponse {
  batch_id: string
  pair_count: number
  model: string
  status: string
  message: string
}

export interface BatchStatusResponse {
  batch_id: string
  processing_status: string  // 'in_progress' | 'ended' | 'canceling'
  request_counts: Record<string, number>
  created_at?: string
  ended_at?: string
}

export interface BatchProcessResponse {
  status: string
  classified: number
  failed: number
  types: Record<string, number>
  cache_read_tokens: number
  cache_creation_tokens: number
}

/**
 * Submit relationship classification as Anthropic Message Batch (50% savings).
 *
 * **Workflow:**
 * 1. submitClassificationBatch() - Submit batch (returns batch_id)
 * 2. checkClassificationBatchStatus() - Poll until status is "ended"
 * 3. processClassificationBatchResults() - Process results (updates Neo4j)
 *
 * Call after rebuildGraphFromKB() to add relationship intelligence.
 */
export const submitClassificationBatch = async (
  options: BatchSubmitRequest = {}
): Promise<BatchSubmitResponse> => {
  const response = await apiClient.post('/graph/classify-batch/submit', {
    max_pairs: options.max_pairs || 500,
    model: options.model || 'claude-3-haiku-20240307',
  })
  return response.data
}

/**
 * Check status of a classification batch.
 * Poll until processing_status is "ended", then call processClassificationBatchResults().
 */
export const checkClassificationBatchStatus = async (
  batchId: string
): Promise<BatchStatusResponse> => {
  const response = await apiClient.get(`/graph/classify-batch/${batchId}/status`)
  return response.data
}

/**
 * Process completed classification batch and update Neo4j edges.
 * Call after batch status is "ended".
 */
export const processClassificationBatchResults = async (
  batchId: string
): Promise<BatchProcessResponse> => {
  const response = await apiClient.post(`/graph/classify-batch/${batchId}/process`)
  return response.data
}
