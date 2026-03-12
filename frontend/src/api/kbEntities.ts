import apiClient from './client'

// =============================================================================
// TYPES
// =============================================================================

export interface KBEntityAlias {
  id: string
  alias_text: string
  alias_norm: string
  lang: string
  alias_type: string
  weight: number
}

export interface KBEntity {
  id: string
  entity_type: string
  canonical_name: string
  canonical_name_ne: string | null
  canonical_lang: string
  attributes: Record<string, unknown> | null
  total_mentions: number
  total_links: number
  avg_confidence: number
  is_curated: boolean
  source: string
  created_at: string
  updated_at: string
  aliases: KBEntityAlias[] | null
}

export interface EntitySubmission {
  id: string
  proposed_name_en: string
  proposed_name_ne: string | null
  proposed_type: string
  proposed_attributes: Record<string, unknown> | null
  proposed_aliases: Array<{ text: string; lang: string; type: string }> | null
  submission_reason: string
  evidence_urls: string[] | null
  upvotes: number
  downvotes: number
  vote_score: number
  status: string
  submitted_by_id: string | null
  reviewed_by_id: string | null
  reviewed_at: string | null
  review_notes: string | null
  created_entity_id: string | null
  merged_into_entity_id: string | null
  created_at: string
  user_vote: string | null
}

export interface EditHistory {
  id: string
  entity_id: string
  edit_type: string
  field_changed: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  change_context: Record<string, unknown> | null
  edited_by_id: string | null
  edited_by_system: boolean
  edit_reason: string | null
  source_url: string | null
  edited_at: string
  summary: string
}

export interface KBEntityListResponse {
  entities: KBEntity[]
  total: number
  limit: number
  offset: number
}

export interface SubmissionListResponse {
  submissions: EntitySubmission[]
  total: number
  limit: number
  offset: number
}

export interface KBEntityStats {
  total_entities: number
  entities_by_type: Record<string, number>
  pending_submissions: number
}

export interface ProvenanceStory {
  story_id: string
  title: string
  title_ne: string | null
  url: string
  source_id: string
  published_at: string | null
  mention_count: number
  max_link_confidence: number
  last_mention_at: string | null
  evidence_excerpt: string | null
  context_window: string | null
  example_mention_text: string | null
}

export interface EntityProvenanceResponse {
  entity_id: string
  total_mentions: number
  total_source_stories: number
  stories: ProvenanceStory[]
}

// =============================================================================
// KB ENTITY API
// =============================================================================

export interface ListEntitiesParams {
  entity_type?: string
  search?: string
  limit?: number
  offset?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

export const listKBEntities = async (params: ListEntitiesParams = {}): Promise<KBEntityListResponse> => {
  const response = await apiClient.get('/kb-entities', { params })
  return response.data
}

export const searchKBEntities = async (
  q: string,
  entity_type?: string,
  limit = 20
): Promise<KBEntity[]> => {
  const response = await apiClient.get('/kb-entities/search', {
    params: { q, entity_type, limit },
  })
  return response.data
}

export const getKBEntity = async (entityId: string): Promise<KBEntity> => {
  const response = await apiClient.get(`/kb-entities/${entityId}`)
  return response.data
}

export const getEntityHistory = async (entityId: string, limit = 50): Promise<EditHistory[]> => {
  const response = await apiClient.get(`/kb-entities/${entityId}/history`, {
    params: { limit },
  })
  return response.data
}

export const getKBEntityStats = async (): Promise<KBEntityStats> => {
  const response = await apiClient.get('/kb-entities/stats/summary')
  return response.data
}

export const getKBEntityProvenance = async (
  entityId: string,
  limit: number = 25
): Promise<EntityProvenanceResponse> => {
  const response = await apiClient.get(`/kb-entities/${entityId}/provenance`, {
    params: { limit },
  })
  return response.data
}

// =============================================================================
// SUBMISSION API
// =============================================================================

export interface ListSubmissionsParams {
  status?: string
  sort_by?: 'vote_score' | 'created_at'
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export const listSubmissions = async (params: ListSubmissionsParams = {}): Promise<SubmissionListResponse> => {
  const response = await apiClient.get('/kb-entities/submissions', { params })
  return response.data
}

export const getSubmission = async (submissionId: string): Promise<EntitySubmission> => {
  const response = await apiClient.get(`/kb-entities/submissions/${submissionId}`)
  return response.data
}

export interface SubmitEntityData {
  proposed_name_en: string
  proposed_name_ne?: string
  proposed_type: string
  proposed_attributes?: Record<string, unknown>
  proposed_aliases?: Array<{ text: string; lang: string; type: string }>
  submission_reason: string
  evidence_urls?: string[]
}

export const submitEntity = async (data: SubmitEntityData): Promise<EntitySubmission> => {
  const response = await apiClient.post('/kb-entities/submissions', data)
  return response.data
}

export const voteOnSubmission = async (
  submissionId: string,
  vote_type: 'up' | 'down'
): Promise<EntitySubmission> => {
  const response = await apiClient.post(`/kb-entities/submissions/${submissionId}/vote`, {
    vote_type,
  })
  return response.data
}

export const approveSubmission = async (
  submissionId: string,
  review_notes?: string
): Promise<KBEntity> => {
  const response = await apiClient.post(`/kb-entities/submissions/${submissionId}/approve`, {
    review_notes,
  })
  return response.data
}

export const rejectSubmission = async (
  submissionId: string,
  review_notes: string
): Promise<EntitySubmission> => {
  const response = await apiClient.post(`/kb-entities/submissions/${submissionId}/reject`, {
    review_notes,
  })
  return response.data
}

export const mergeSubmission = async (
  submissionId: string,
  target_entity_id: string,
  review_notes?: string
): Promise<KBEntity> => {
  const response = await apiClient.post(`/kb-entities/submissions/${submissionId}/merge`, {
    target_entity_id,
    review_notes,
  })
  return response.data
}

// =============================================================================
// ENTITY MANAGEMENT API (Dev only)
// =============================================================================

export interface CreateEntityData {
  canonical_name: string
  canonical_name_ne?: string
  entity_type: string
  attributes?: Record<string, unknown>
  aliases?: Array<{ text?: string; alias_text?: string; lang?: string; type?: string; alias_type?: string; weight?: number }>
}

export const createKBEntity = async (data: CreateEntityData): Promise<KBEntity> => {
  const response = await apiClient.post('/kb-entities', data)
  return response.data
}

export interface UpdateEntityData {
  canonical_name?: string
  canonical_name_ne?: string
  attributes?: Record<string, unknown>
}

export const updateKBEntity = async (
  entityId: string,
  data: UpdateEntityData,
  edit_reason: string
): Promise<KBEntity> => {
  const response = await apiClient.patch(`/kb-entities/${entityId}`, data, {
    params: { edit_reason },
  })
  return response.data
}

export interface AddAliasData {
  alias_text: string
  lang?: string
  alias_type?: string
  weight?: number
}

export const addEntityAlias = async (entityId: string, data: AddAliasData): Promise<KBEntityAlias> => {
  const response = await apiClient.post(`/kb-entities/${entityId}/aliases`, data)
  return response.data
}

export const removeEntityAlias = async (entityId: string, aliasId: string): Promise<void> => {
  await apiClient.delete(`/kb-entities/${entityId}/aliases/${aliasId}`)
}

export interface PartyChangeData {
  old_party: string
  new_party: string
  effective_date: string
  source_url?: string
}

export const recordPartyChange = async (entityId: string, data: PartyChangeData): Promise<KBEntity> => {
  const response = await apiClient.post(`/kb-entities/${entityId}/party-change`, data)
  return response.data
}
