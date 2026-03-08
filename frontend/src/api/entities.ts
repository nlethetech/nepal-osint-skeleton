import apiClient from './client'
import type {
  Entity,
  PaginatedResponse,
  EntityType,
  MergeSuggestion,
  MergeRequest,
  MergeResponse,
  BulkActionRequest,
  BulkActionResponse,
} from '../types/api'

export interface EntityParams {
  page?: number
  pageSize?: number
  entityType?: EntityType
  search?: string
}

export const getEntities = async (params: EntityParams = {}): Promise<PaginatedResponse<Entity>> => {
  const response = await apiClient.get('/entities', {
    params: {
      page: params.page,
      page_size: params.pageSize,
      entity_type: params.entityType,
      search: params.search,
    },
  })
  return response.data
}

export const getEntity = async (id: string): Promise<Entity> => {
  const response = await apiClient.get(`/entities/${id}`)
  return response.data
}

// =============================================================================
// Human-in-the-Loop Entity Resolution API
// =============================================================================

/**
 * Get similar entities for merge suggestions
 */
export const getSimilarEntities = async (
  entityId: string,
  threshold = 0.5,
  limit = 10
): Promise<MergeSuggestion> => {
  const response = await apiClient.get(`/entities/${entityId}/similar`, {
    params: { threshold, limit },
  })
  return response.data
}

/**
 * Get all merge suggestions for entities with potential duplicates
 */
export const getAllMergeSuggestions = async (
  threshold = 0.6,
  limitPerEntity = 5,
  entityType?: EntityType
): Promise<MergeSuggestion[]> => {
  const response = await apiClient.get('/entities/resolution/suggestions', {
    params: {
      threshold,
      limit_per_entity: limitPerEntity,
      entity_type: entityType,
    },
  })
  return response.data
}

/**
 * Merge multiple entities into a target entity
 */
export const mergeEntities = async (request: MergeRequest): Promise<MergeResponse> => {
  const response = await apiClient.post('/entities/merge', request)
  return response.data
}

/**
 * Mark an entity as verified (human-confirmed)
 */
export const verifyEntity = async (entityId: string): Promise<Entity> => {
  const response = await apiClient.post(`/entities/${entityId}/verify`)
  return response.data
}

/**
 * Mark an entity as irrelevant (false positive)
 */
export const markEntityIrrelevant = async (entityId: string): Promise<Entity> => {
  const response = await apiClient.post(`/entities/${entityId}/irrelevant`)
  return response.data
}

/**
 * Perform bulk actions on multiple entities
 */
export const bulkEntityAction = async (request: BulkActionRequest): Promise<BulkActionResponse> => {
  const response = await apiClient.post('/entities/bulk', request)
  return response.data
}

/**
 * Delete an entity permanently
 */
export const deleteEntity = async (entityId: string): Promise<{ success: boolean; deleted: string }> => {
  const response = await apiClient.delete(`/entities/${entityId}`)
  return response.data
}
