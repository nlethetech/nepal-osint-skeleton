import apiClient from './client'

export interface AutomationControl {
  automation_key: string
  label: string
  description: string
  is_enabled: boolean
  reason?: string | null
  last_changed_at?: string | null
  last_rerun_requested_at?: string | null
  last_run_started_at?: string | null
  last_run_completed_at?: string | null
  last_success_at?: string | null
  last_run_status?: string | null
  last_error?: string | null
}

export interface OpenAIStatus {
  status: 'healthy' | 'disabled' | 'misconfigured'
  api_key_configured: boolean
  embedding_enabled: boolean
  clustering_enabled: boolean
  agent_enabled: boolean
  developing_stories_enabled: boolean
  story_tracker_enabled: boolean
  embedding_model_key: string
  embedding_model: string
  clustering_model: string
  agent_fast_model: string
  agent_deep_model: string
  usage_limit_enabled: boolean
  local_embeddings_active: boolean
}

export interface PaginationEnvelope<T> {
  items: T[]
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface EditorialOverviewResponse {
  editorial_backlog: {
    fact_check_pending_review: number
    fact_check_queue: number
    fact_check_reruns: number
    developing_stories_review: number
    story_tracker_review: number
    story_tracker_stale: number
    haiku_relevance_queue: number
    haiku_summary_queue: number
  }
  paused_automations: number
  automation_controls: AutomationControl[]
  alerts: Array<{
    severity: string
    title: string
    detail: string
  }>
  users: {
    total_users: number
    active_last_hour: number
    new_last_24h: number
    new_last_7d: number
    provider_counts: Record<string, number>
    role_counts: Record<string, number>
    guest_to_registered: {
      guest: number
      registered: number
    }
    signups_by_day: Array<{ date: string; count: number }>
  }
  analyst_brief: {
    latest_run_number?: number | null
    latest_status: string
    latest_created_at?: string | null
  }
  recent_actions: Array<{
    id: string
    action: string
    target_type?: string | null
    target_id?: string | null
    details?: Record<string, unknown> | null
    created_at: string
    user_email: string
  }>
}

export interface FactCheckInboxItem {
  story_id: string
  fact_check_result_id: string
  title?: string | null
  source_name?: string | null
  url?: string | null
  request_count: number
  checked_at: string
  raw: {
    verdict: string
    verdict_summary: string
    confidence: number
    key_finding?: string | null
    context?: string | null
    claims_analyzed?: any[] | null
    sources_checked?: any[] | null
  }
  review: {
    workflow_status: string
    final_verdict?: string | null
    final_verdict_summary?: string | null
    final_confidence?: number | null
    final_key_finding?: string | null
    final_context?: string | null
    override_notes?: string | null
    approved_at?: string | null
    rejected_at?: string | null
    rejection_reason?: string | null
    needs_rerun: boolean
    rerun_requested_at?: string | null
  }
  effective: {
    verdict: string
    verdict_summary: string
    confidence: number
    key_finding?: string | null
    context?: string | null
  }
}

export interface DevelopingStoryItem {
  cluster_id: string
  headline: string
  summary?: string | null
  category?: string | null
  severity?: string | null
  system_headline: string
  system_summary?: string | null
  system_category?: string | null
  system_severity?: string | null
  workflow_status: string
  story_count: number
  source_count: number
  first_published?: string | null
  last_updated?: string | null
  bluf?: string | null
  analyst_notes?: string | null
  stories: Array<{
    id: string
    title: string
    summary?: string | null
    source_name?: string | null
    url?: string | null
    published_at?: string | null
  }>
}

export interface StoryTrackerItem {
  narrative_id: string
  label: string
  thesis?: string | null
  category?: string | null
  direction?: string | null
  momentum_score: number
  confidence?: number | null
  workflow_status: string
  review_notes?: string | null
  cluster_count: number
  first_seen_at?: string | null
  last_updated?: string | null
  clusters: Array<{
    cluster_id: string
    headline: string
    category?: string | null
    severity?: string | null
    story_count: number
    source_count: number
    last_updated?: string | null
    similarity_score?: number | null
  }>
}

export interface ReasonBody {
  reason: string
}

export async function fetchEditorialOverview(): Promise<EditorialOverviewResponse> {
  const { data } = await apiClient.get('/admin/editorial/overview')
  return data
}

export async function fetchAutomationControls(): Promise<{ items: AutomationControl[]; openai: OpenAIStatus }> {
  const { data } = await apiClient.get('/admin/editorial/automation-controls')
  return data
}

export async function pauseAutomation(automationKey: string, reason: string): Promise<AutomationControl> {
  const { data } = await apiClient.post(`/admin/editorial/automation-controls/${automationKey}/pause`, { reason })
  return data
}

export async function resumeAutomation(automationKey: string, reason: string): Promise<AutomationControl> {
  const { data } = await apiClient.post(`/admin/editorial/automation-controls/${automationKey}/resume`, { reason })
  return data
}

export async function rerunAutomation(automationKey: string, reason: string): Promise<AutomationControl> {
  const { data } = await apiClient.post(`/admin/editorial/automation-controls/${automationKey}/rerun`, { reason })
  return data
}

export async function fetchFactCheckInbox(params: {
  workflowStatus?: string
  page?: number
  per_page?: number
} = {}): Promise<PaginationEnvelope<FactCheckInboxItem>> {
  const { data } = await apiClient.get('/admin/editorial/fact-check/inbox', {
    params: {
      workflow_status: params.workflowStatus,
      page: params.page,
      per_page: params.per_page,
    },
  })
  return data
}

export async function fetchFactCheckDetail(storyId: string): Promise<FactCheckInboxItem> {
  const { data } = await apiClient.get(`/admin/editorial/fact-check/${storyId}`)
  return data
}

export async function patchFactCheck(storyId: string, payload: Record<string, unknown>): Promise<FactCheckInboxItem> {
  const { data } = await apiClient.patch(`/admin/editorial/fact-check/${storyId}`, payload)
  return data
}

export async function approveFactCheck(storyId: string, reason: string): Promise<FactCheckInboxItem> {
  const { data } = await apiClient.post(`/admin/editorial/fact-check/${storyId}/approve`, { reason })
  return data
}

export async function rejectFactCheck(storyId: string, reason: string, workflowStatus: 'rejected' | 'suppressed' = 'rejected'): Promise<FactCheckInboxItem> {
  const { data } = await apiClient.post(`/admin/editorial/fact-check/${storyId}/reject`, {
    reason,
    workflow_status: workflowStatus,
  })
  return data
}

export async function rerunFactCheck(storyId: string, reason: string): Promise<FactCheckInboxItem> {
  const { data } = await apiClient.post(`/admin/editorial/fact-check/${storyId}/rerun`, { reason })
  return data
}

export async function fetchDevelopingStoriesInbox(params: {
  hours?: number
  page?: number
  per_page?: number
} = {}): Promise<PaginationEnvelope<DevelopingStoryItem>> {
  const { data } = await apiClient.get('/admin/editorial/developing-stories/inbox', { params })
  return data
}

export async function fetchDevelopingStoryDetail(clusterId: string): Promise<DevelopingStoryItem> {
  const { data } = await apiClient.get(`/admin/editorial/developing-stories/${clusterId}`)
  return data
}

export async function patchDevelopingStory(clusterId: string, payload: Record<string, unknown>): Promise<DevelopingStoryItem> {
  const { data } = await apiClient.patch(`/admin/editorial/developing-stories/${clusterId}`, payload)
  return data
}

export async function approveDevelopingStory(clusterId: string, reason: string): Promise<DevelopingStoryItem> {
  const { data } = await apiClient.post(`/admin/editorial/developing-stories/${clusterId}/approve`, { reason })
  return data
}

export async function rejectDevelopingStory(clusterId: string, reason: string): Promise<DevelopingStoryItem> {
  const { data } = await apiClient.post(`/admin/editorial/developing-stories/${clusterId}/reject`, { reason })
  return data
}

export async function rerunDevelopingStory(clusterId: string, reason: string): Promise<DevelopingStoryItem> {
  const { data } = await apiClient.post(`/admin/editorial/developing-stories/${clusterId}/rerun`, { reason })
  return data
}

export async function fetchStoryTrackerInbox(params: {
  hours?: number
  page?: number
  per_page?: number
} = {}): Promise<PaginationEnvelope<StoryTrackerItem>> {
  const { data } = await apiClient.get('/admin/editorial/story-tracker/inbox', { params })
  return data
}

export async function patchStoryTracker(narrativeId: string, payload: Record<string, unknown>): Promise<StoryTrackerItem> {
  const { data } = await apiClient.patch(`/admin/editorial/story-tracker/${narrativeId}`, payload)
  return data
}

export async function approveStoryTracker(narrativeId: string, reason: string): Promise<StoryTrackerItem> {
  const { data } = await apiClient.post(`/admin/editorial/story-tracker/${narrativeId}/approve`, { reason })
  return data
}

export async function rejectStoryTracker(narrativeId: string, reason: string): Promise<StoryTrackerItem> {
  const { data } = await apiClient.post(`/admin/editorial/story-tracker/${narrativeId}/reject`, { reason })
  return data
}

export async function rerunStoryTracker(narrativeId: string, reason: string): Promise<{ status: string; narrative_id: string }> {
  const { data } = await apiClient.post(`/admin/editorial/story-tracker/${narrativeId}/rerun`, { reason })
  return data
}
