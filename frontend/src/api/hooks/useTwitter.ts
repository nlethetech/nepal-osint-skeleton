/**
 * Twitter/X React Query hooks
 *
 * Provides hooks for fetching tweets from the backend.
 */

import { useQuery } from '@tanstack/react-query';
import {
  getTweets,
  getTwitterStatus,
  getTwitterUsageStats,
  searchTweets,
} from '../twitter';
import type { Tweet, TweetListResponse, TwitterStatus, TwitterUsageStats } from '../twitter';

// Query keys
export const twitterKeys = {
  all: ['twitter'] as const,
  status: () => [...twitterKeys.all, 'status'] as const,
  usage: () => [...twitterKeys.all, 'usage'] as const,
  tweets: (params: Record<string, unknown>) => [...twitterKeys.all, 'tweets', params] as const,
  search: (params: Record<string, unknown>) => [...twitterKeys.all, 'search', params] as const,
};

/**
 * Hook for Twitter integration status.
 */
export function useTwitterStatus() {
  return useQuery<TwitterStatus>({
    queryKey: twitterKeys.status(),
    queryFn: getTwitterStatus,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

/**
 * Hook for recent tweets.
 *
 * @param limit - Number of tweets to fetch (default: 10)
 * @param hours - Time window in hours (default: 24)
 * @param relevantOnly - Only fetch Nepal-relevant tweets (default: true)
 */
export function useTweets(params: {
  limit?: number;
  hours?: number;
  nepal_relevance?: string;
  category?: string;
  relevant_only?: boolean;
  source?: 'accounts' | 'hashtags';
  author?: string;
  hashtag?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  ground_reports?: boolean;
} = {}) {
  const queryParams = {
    limit: params.limit ?? 10,
    hours: params.hours ?? 24,
    relevant_only: params.relevant_only ?? false,
    ...params,
  };

  return useQuery<TweetListResponse>({
    queryKey: twitterKeys.tweets(queryParams),
    queryFn: () => getTweets(queryParams),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Auto-refresh every 10 minutes
  });
}

/**
 * Hook for searching tweets.
 */
export function useSearchTweets(query: string, params: {
  limit?: number;
  hours?: number;
} = {}) {
  return useQuery<TweetListResponse>({
    queryKey: twitterKeys.search({ q: query, ...params }),
    queryFn: () => searchTweets({ q: query, ...params }),
    enabled: !!query && query.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for Twitter API usage stats.
 */
export function useTwitterUsageStats() {
  return useQuery<TwitterUsageStats>({
    queryKey: twitterKeys.usage(),
    queryFn: getTwitterUsageStats,
    staleTime: 5 * 60 * 1000,
  });
}

// Re-export types
export type { Tweet, TweetListResponse, TwitterStatus, TwitterUsageStats };
