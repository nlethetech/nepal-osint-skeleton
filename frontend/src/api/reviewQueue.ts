import apiClient from './client'

// Types
export interface MentionInfo {
  id: string
  text: string
  normalized: string
  type: string
  context: string | null
  doc_id: string
  story_id: string | null
}

export interface EntityInfo {
  id: string | null
  name: string | null
  name_ne: string | null
  type: string | null
  total_mentions: number
  total_links: number
}

export interface LinkReviewItem {
  link_id: string
  mention: MentionInfo
  proposed_entity: EntityInfo | null
  confidence: number
  rule: string
  evidence: Record<string, unknown>
  status: string
  created_at: string | null
}

export interface MergeReviewItem {
  merge_request_id: string
  source_entity: EntityInfo
  target_entity: EntityInfo
  similarity_score: number
  match_evidence: Record<string, unknown>
  status: string
  created_at: string | null
}

export interface ReviewStats {
  pending_link_reviews: number
  pending_merge_reviews: number
  reviewed_today: number
  auto_linked_total: number
}

export interface LinkReviewResponse {
  reviews: LinkReviewItem[]
  total: number
  page: number
  limit: number
}

export interface MergeReviewResponse {
  reviews: MergeReviewItem[]
  total: number
  page: number
  limit: number
}

// Pending Entity types
export interface SampleMention {
  story_id: string | null
  source: string | null
  context: string | null
  timestamp: string | null
}

export interface PendingEntityItem {
  id: string
  proposed_name: string
  proposed_name_ne: string | null
  proposed_type: string
  mention_count: number
  source_count: number
  first_seen_at: string | null
  last_seen_at: string | null
  sample_mentions: SampleMention[]
  status: string
}

export interface PendingEntityResponse {
  entities: PendingEntityItem[]
  total: number
  page: number
  limit: number
}

export interface KBEntitySearchResult {
  id: string
  canonical_name: string
  canonical_name_ne: string | null
  entity_type: string
  total_mentions: number
}

// API Functions

export const getReviewStats = async (): Promise<ReviewStats> => {
  const response = await apiClient.get('/review-queue/stats')
  return response.data
}

export const getPendingLinkReviews = async (
  page: number = 1,
  limit: number = 20,
  entityType?: string,
  minConfidence?: number,
  maxConfidence?: number,
): Promise<LinkReviewResponse> => {
  const params: Record<string, unknown> = { page, limit }
  if (entityType) params.entity_type = entityType
  if (minConfidence !== undefined) params.min_confidence = minConfidence
  if (maxConfidence !== undefined) params.max_confidence = maxConfidence

  const response = await apiClient.get('/review-queue/links', { params })
  return response.data
}

export const getPendingMergeReviews = async (
  page: number = 1,
  limit: number = 20,
  entityType?: string,
): Promise<MergeReviewResponse> => {
  const params: Record<string, unknown> = { page, limit }
  if (entityType) params.entity_type = entityType

  const response = await apiClient.get('/review-queue/merges', { params })
  return response.data
}

export const approveLink = async (
  linkId: string,
  reviewer: string,
  notes?: string,
  correctedEntityId?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/links/${linkId}/approve`, {
    reviewer,
    notes,
    corrected_entity_id: correctedEntityId,
  })
  return response.data
}

export const rejectLink = async (
  linkId: string,
  reviewer: string,
  notes?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/links/${linkId}/reject`, {
    reviewer,
    notes,
  })
  return response.data
}

export const approveMerge = async (
  mergeRequestId: string,
  reviewer: string,
  notes?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/merges/${mergeRequestId}/approve`, {
    reviewer,
    notes,
  })
  return response.data
}

export const rejectMerge = async (
  mergeRequestId: string,
  reviewer: string,
  notes?: string,
  addToCannotLink: boolean = false,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/merges/${mergeRequestId}/reject`, {
    reviewer,
    notes,
    add_to_cannot_link: addToCannotLink,
  })
  return response.data
}

export const runAutoLinking = async (
  batchSize: number = 50,
  detectDuplicates: boolean = true,
  syncGraph: boolean = true,
): Promise<{ status: string; message: string; results: Record<string, unknown> }> => {
  const response = await apiClient.post('/review-queue/run-auto-linking', null, {
    params: {
      batch_size: batchSize,
      detect_duplicates: detectDuplicates,
      sync_graph: syncGraph,
    },
  })
  return response.data
}

// Pending Entity API functions

export const getPendingEntities = async (
  page: number = 1,
  limit: number = 20,
  entityType?: string,
): Promise<PendingEntityResponse> => {
  const params: Record<string, unknown> = { page, limit }
  if (entityType) params.entity_type = entityType

  const response = await apiClient.get('/review-queue/pending-entities', { params })
  return response.data
}

export const approvePendingEntity = async (
  pendingId: string,
  reviewer: string,
  notes?: string,
  canonicalName?: string,
  canonicalNameNe?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/pending-entities/${pendingId}/approve`, {
    reviewer,
    notes,
    canonical_name: canonicalName,
    canonical_name_ne: canonicalNameNe,
  })
  return response.data
}

export const rejectPendingEntity = async (
  pendingId: string,
  reviewer: string,
  reason: string,
  notes?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/pending-entities/${pendingId}/reject`, {
    reviewer,
    reason,
    notes,
  })
  return response.data
}

export const mergePendingEntity = async (
  pendingId: string,
  reviewer: string,
  targetEntityId: string,
  notes?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await apiClient.post(`/review-queue/pending-entities/${pendingId}/merge`, {
    reviewer,
    target_entity_id: targetEntityId,
    notes,
  })
  return response.data
}

export const searchKBEntities = async (
  query: string,
  entityType?: string,
  limit: number = 20,
): Promise<KBEntitySearchResult[]> => {
  const params: Record<string, unknown> = { q: query, limit }
  if (entityType) params.entity_type = entityType

  const response = await apiClient.get('/review-queue/kb-entities/search', { params })
  return response.data
}

export const detectDuplicates = async (
  entityType?: string,
  limit: number = 100,
): Promise<{ status: string; message: string; results: Record<string, unknown> }> => {
  const params: Record<string, unknown> = { limit }
  if (entityType) params.entity_type = entityType

  const response = await apiClient.post('/review-queue/detect-duplicates', null, { params })
  return response.data
}
