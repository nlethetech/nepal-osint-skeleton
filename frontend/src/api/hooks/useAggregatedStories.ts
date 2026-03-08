/**
 * React Query hook for fetching aggregated/clustered stories
 */

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../client'

export interface ClusterStory {
  id: string
  source_id: string
  source_name?: string
  title: string
  summary?: string
  url: string
  published_at?: string
}

export interface ClusterStoryGroup {
  canonical: ClusterStory
  duplicates: ClusterStory[]
  duplicate_count: number
}

export interface AggregatedCluster {
  id: string
  headline: string
  summary?: string
  category?: string
  severity?: string
  story_count: number
  source_count: number
  sources: string[]
  first_published?: string
  last_updated?: string
  stories: ClusterStory[]
  story_groups?: ClusterStoryGroup[] | null
  published_at?: string | null
  latest_version?: number | null
  latest_publication_at?: string | null
  citations_count?: number | null
  official_confirmation?: boolean | null
  peer_review?: {
    peer_state: string
    agree_count: number
    needs_correction_count: number
    dispute_count: number
    last_reviewed_at?: string | null
    last_contested_at?: string | null
    latest_version?: number | null
    latest_publication_at?: string | null
    official_confirmation?: boolean | null
    citations_count?: number | null
  } | null
}

export interface AggregatedNewsResponse {
  clusters: AggregatedCluster[]
  unclustered_count: number
  total_stories: number
}

interface UseAggregatedStoriesOptions {
  hours?: number
  category?: string
  severity?: string
  publishedOnly?: boolean
  includeStoryGroups?: boolean
  enabled?: boolean
}

async function getAggregatedNews(
  hours: number = 72,
  category?: string,
  severity?: string,
  publishedOnly?: boolean,
  includeStoryGroups?: boolean,
): Promise<AggregatedNewsResponse> {
  const params = new URLSearchParams()
  params.set('hours', hours.toString())
  if (category) params.set('category', category)
  if (severity) params.set('severity', severity)
  if (publishedOnly) params.set('published_only', 'true')
  if (includeStoryGroups) params.set('include_story_groups', 'true')

  const response = await apiClient.get(`/analytics/aggregated-news?${params.toString()}`)
  return response.data
}

export function useAggregatedStories(options: UseAggregatedStoriesOptions = {}) {
  const { hours = 72, category, severity, publishedOnly, includeStoryGroups, enabled = true } = options

  return useQuery({
    queryKey: ['aggregated-stories', hours, category, severity, publishedOnly, includeStoryGroups],
    queryFn: () => getAggregatedNews(hours, category, severity, publishedOnly, includeStoryGroups),
    enabled,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // 5 minutes
  })
}
