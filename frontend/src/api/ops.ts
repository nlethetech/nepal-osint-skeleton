import apiClient from './client'

export type WorkflowStatus = 'unreviewed' | 'monitoring' | 'verified' | 'published' | 'rejected'

export interface OpsStoryItem {
  id: string
  source_id: string
  source_name?: string | null
  title: string
  summary?: string | null
  url: string
  published_at?: string | null
}

export interface OpsDuplicateGroup {
  canonical: OpsStoryItem
  duplicates: OpsStoryItem[]
}

export interface OpsRelatedEvent {
  cluster_id: string
  headline: string
  category?: string | null
  severity?: string | null
  similarity: number
}

export interface OpsEventInboxItem {
  id: string

  headline: string
  summary?: string | null
  category?: string | null
  severity?: string | null

  system_headline: string
  system_category?: string | null
  system_severity?: string | null

  story_count: number
  source_count: number
  first_published?: string | null
  last_updated?: string | null

  workflow_status: WorkflowStatus
  is_published: boolean
  published_at?: string | null
  verified_at?: string | null

  age_minutes?: number | null
  impact_score: number
  uncertainty_score: number
  reasons: string[]
  ready_for_publish: boolean
}

export interface OpsEventInboxResponse {
  items: OpsEventInboxItem[]
  total: number
}

export interface OpsEventDetailResponse {
  id: string

  headline: string
  summary?: string | null
  category?: string | null
  severity?: string | null

  system_headline: string
  system_summary?: string | null
  system_category?: string | null
  system_severity?: string | null

  story_count: number
  source_count: number
  first_published?: string | null
  last_updated?: string | null

  workflow_status: WorkflowStatus
  analyst_notes?: string | null
  customer_brief?: string | null

  is_published: boolean
  published_at?: string | null
  verified_at?: string | null

  story_groups: OpsDuplicateGroup[]
  all_stories: OpsStoryItem[]

  related_events: OpsRelatedEvent[]
}

export interface OpsUpdateEventRequest {
  analyst_headline?: string | null
  analyst_summary?: string | null
  analyst_category?: string | null
  analyst_severity?: string | null
  analyst_notes?: string | null
  workflow_status?: WorkflowStatus | null
}

export interface OpsPublishEventRequest {
  customer_brief?: string | null
  analyst_headline?: string | null
  analyst_summary?: string | null
  analyst_category?: string | null
  analyst_severity?: string | null
}

export async function getEventInbox(params?: {
  hours?: number
  limit?: number
  minAgeMinutes?: number
  includePublished?: boolean
  needsReviewOnly?: boolean
}): Promise<OpsEventInboxResponse> {
  const response = await apiClient.get('/ops/events/inbox', {
    params: {
      hours: params?.hours ?? 72,
      limit: params?.limit ?? 50,
      min_age_minutes: params?.minAgeMinutes ?? 30,
      include_published: params?.includePublished ?? false,
      needs_review_only: params?.needsReviewOnly ?? false,
    },
  })
  return response.data
}

export async function getEventDetail(clusterId: string): Promise<OpsEventDetailResponse> {
  const response = await apiClient.get(`/ops/events/${clusterId}`)
  return response.data
}

export async function updateEvent(
  clusterId: string,
  body: OpsUpdateEventRequest,
): Promise<OpsEventDetailResponse> {
  const response = await apiClient.patch(`/ops/events/${clusterId}`, body)
  return response.data
}

export async function publishEvent(
  clusterId: string,
  body: OpsPublishEventRequest,
  minAgeMinutes: number = 30,
): Promise<OpsEventDetailResponse> {
  const response = await apiClient.post(`/ops/events/${clusterId}/publish`, body, {
    params: { min_age_minutes: minAgeMinutes },
  })
  return response.data
}

export async function rejectEvent(
  clusterId: string,
  notes?: string,
): Promise<OpsEventDetailResponse> {
  const response = await apiClient.post(`/ops/events/${clusterId}/reject`, null, {
    params: { notes },
  })
  return response.data
}

// ============================================================
// Source Management (Human-in-the-loop)
// ============================================================

export interface StoryManagementResponse {
  status: string
  message: string
  story_id: string
  cluster_id: string
  new_story_count: number
  new_source_count: number
}

/**
 * Remove a story from a cluster without deleting it.
 * The story returns to the unclustered pool.
 */
export async function removeStoryFromCluster(
  clusterId: string,
  storyId: string,
): Promise<StoryManagementResponse> {
  const response = await apiClient.delete(`/ops/events/${clusterId}/stories/${storyId}`)
  return response.data
}

/**
 * Add an unclustered story to an existing cluster.
 */
export async function addStoryToCluster(
  clusterId: string,
  storyId: string,
): Promise<StoryManagementResponse> {
  const response = await apiClient.post(`/ops/events/${clusterId}/stories/${storyId}`)
  return response.data
}

// ============================================================
// Candidate Stories (for adding similar stories)
// ============================================================

export interface CandidateStory {
  story_id: string
  title: string
  url: string
  source_id: string
  source_name?: string | null
  published_at?: string | null
  similarity: number // Percentage (0-100)
  current_cluster_id?: string | null
  current_cluster_headline?: string | null
  is_unclustered: boolean
}

export interface CandidateStoriesResponse {
  cluster_id: string
  cluster_headline: string
  candidates: CandidateStory[]
}

/**
 * Get candidate stories that could be added to a cluster.
 * Returns similar unclustered stories and stories from related clusters.
 */
export async function getCandidateStories(
  clusterId: string,
  limit: number = 20,
): Promise<CandidateStoriesResponse> {
  const response = await apiClient.get(`/ops/events/${clusterId}/candidate-stories`, {
    params: { limit },
  })
  return response.data
}

