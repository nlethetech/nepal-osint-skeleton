import apiClient from './client'

// Types
export interface ClassificationItem {
  story_id: string
  title: string
  source_id: string
  created_at: string | null
  nepal_relevance: string | null
  nepal_relevance_score: number | null
  content_type: string | null
  confidence: number | null
  category: string | null
  severity: string | null
  threat_level: string | null
  keywords: string[]
  tier2_priority: number | null
  districts_mentioned: string[]
  entities_mentioned: string[]
  constituencies_mentioned: string[]
  is_corrected: boolean
  corrected_category: string | null
}

export interface ClassificationsResponse {
  items: ClassificationItem[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface AccuracyMetrics {
  window_days: number
  total_reviewed: number
  overall_accuracy: number
  per_category_accuracy: Record<string, number>
  entity_linking_accuracy: number | null
  constituency_routing_accuracy: number | null
  rl_samples: {
    classification: number
    priority: number
  }
  rl_thresholds: {
    classifier_min: number
    priority_min: number
  }
}

// API functions
export async function getRecentClassifications(
  page: number = 1,
  limit: number = 20,
  sortBy: string = 'confidence_asc',
): Promise<ClassificationsResponse> {
  const response = await apiClient.get('/pipeline-feedback/classifications', {
    params: { page, limit, sort_by: sortBy },
  })
  return response.data
}

export async function submitClassificationFeedback(
  storyId: string,
  systemCategory: string,
  humanCategory: string,
  confidence?: number,
): Promise<{ status: string; is_correct: boolean }> {
  const response = await apiClient.post('/pipeline-feedback/classification', {
    story_id: storyId,
    system_category: systemCategory,
    human_category: humanCategory,
    confidence,
    analyst_id: 'analyst',
  })
  return response.data
}

export async function submitEntityFeedback(
  storyId: string,
  mentionId: string | null,
  isCorrect: boolean,
  correctedType?: string,
  correctedKbEntityId?: string,
): Promise<{ status: string }> {
  const response = await apiClient.post('/pipeline-feedback/entity', {
    story_id: storyId,
    mention_id: mentionId,
    is_correct: isCorrect,
    corrected_type: correctedType,
    corrected_kb_entity_id: correctedKbEntityId,
    analyst_id: 'analyst',
  })
  return response.data
}

export async function submitConstituencyFeedback(
  storyId: string,
  assignedConstituencyId: string | null,
  correctConstituencyId: string | null,
): Promise<{ status: string }> {
  const response = await apiClient.post('/pipeline-feedback/constituency', {
    story_id: storyId,
    assigned_constituency_id: assignedConstituencyId,
    correct_constituency_id: correctConstituencyId,
    analyst_id: 'analyst',
  })
  return response.data
}

export async function getAccuracyMetrics(
  days: number = 30,
): Promise<AccuracyMetrics> {
  const response = await apiClient.get('/pipeline-feedback/accuracy', {
    params: { days },
  })
  return response.data
}
