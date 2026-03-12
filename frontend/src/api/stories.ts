import apiClient from './client'
import type { Story, PaginatedResponse } from '../types/api'

export interface StoryParams {
  page?: number
  pageSize?: number
  sourceId?: string
  sourceIds?: string[]
  category?: string
  fromDate?: string
  toDate?: string
  nepalOnly?: boolean
  multiSourceOnly?: boolean
}

export const getStories = async (params: StoryParams = {}): Promise<PaginatedResponse<Story>> => {
  const response = await apiClient.get('/stories', {
    params: {
      page: params.page,
      page_size: params.pageSize,
      source_id: params.sourceId,
      source_ids: params.sourceIds && params.sourceIds.length > 0 ? params.sourceIds.join(',') : undefined,
      category: params.category,
      from_date: params.fromDate,
      to_date: params.toDate,
      nepal_only: params.nepalOnly,
      multi_source_only: params.multiSourceOnly,
    },
  })
  return response.data
}

export interface StorySourceOption {
  source_id: string
  source_name: string
  story_count: number
}

export interface StorySourceParams {
  category?: string
  fromDate?: string
  toDate?: string
  nepalOnly?: boolean
  multiSourceOnly?: boolean
  limit?: number
}

export const getStorySources = async (
  params: StorySourceParams = {}
): Promise<StorySourceOption[]> => {
  const response = await apiClient.get('/stories/sources', {
    params: {
      category: params.category,
      from_date: params.fromDate,
      to_date: params.toDate,
      nepal_only: params.nepalOnly,
      multi_source_only: params.multiSourceOnly,
      limit: params.limit,
    },
  })
  return response.data
}

export const getStory = async (id: string): Promise<Story> => {
  const response = await apiClient.get(`/stories/${id}`)
  return response.data
}

export interface RelatedStoryItem {
  story_id: string
  title: string
  source_name?: string | null
  source_id?: string
  url?: string
  category?: string | null
  severity?: string | null
  similarity: number
  published_at?: string | null
}

export interface RelatedStoriesResponse {
  source_story_id: string
  similar_stories: RelatedStoryItem[]
  total_found: number
  model: string
}

export interface RelatedStoryParams {
  topK?: number
  minSimilarity?: number
  hours?: number
}

export const getRelatedStories = async (
  storyId: string,
  params: RelatedStoryParams = {}
): Promise<RelatedStoriesResponse> => {
  const response = await apiClient.get(`/stories/${storyId}/related`, {
    params: {
      top_k: params.topK,
      min_similarity: params.minSimilarity,
      hours: params.hours,
    },
  })
  return response.data
}

export interface StoryKBEntityItem {
  entity_id: string
  entity_type: string
  canonical_name: string
  canonical_name_ne: string | null
  mention_count: number
  max_link_confidence: number
  evidence_excerpt: string | null
  context_window: string | null
  example_mention_text: string | null
}

export interface StoryKBEntitiesResponse {
  story_id: string
  entities: StoryKBEntityItem[]
}

export const getStoryKBEntities = async (
  storyId: string,
  limit: number = 100
): Promise<StoryKBEntitiesResponse> => {
  const response = await apiClient.get(`/stories/${storyId}/kb-entities`, {
    params: { limit },
  })
  return response.data
}
