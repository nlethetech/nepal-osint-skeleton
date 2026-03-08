/**
 * Twitter/X API client
 *
 * Fetches tweets from the backend Twitter integration.
 */

import { apiClient } from './client';

// Types
export interface Tweet {
  id: string;
  tweet_id: string;
  author_id: string;
  author_username: string | null;
  author_name: string | null;
  text: string;
  language: string;
  is_retweet: boolean;
  is_reply: boolean;
  is_quote: boolean;
  retweet_count: number;
  reply_count: number;
  like_count: number;
  hashtags: string[];
  mentions: string[];
  urls: string[];
  nepal_relevance: string | null;
  category: string | null;
  severity: string | null;
  is_relevant: boolean | null;
  source_query: string | null;
  tweet_cluster_id: string | null;
  cluster_size: number | null;
  districts: string[];
  provinces: string[];
  media_urls: string[];
  tweeted_at: string | null;
  fetched_at: string | null;
}

export interface TweetListResponse {
  tweets: Tweet[];
  count: number;
  total_in_period?: number;
}

export interface TwitterStatus {
  configured: boolean;
  message: string;
}

export interface TwitterUsageStats {
  month: string;
  tier: string;
  monthly_limit: number;
  tweets_read: number;
  budget_remaining: number;
  api_calls: number;
  cached_calls: number;
  errors: number;
  budget_percentage_used: number;
  last_call: string | null;
}

// API functions

/**
 * Get Twitter integration status.
 */
export async function getTwitterStatus(): Promise<TwitterStatus> {
  const response = await apiClient.get('/twitter/status');
  return response.data;
}

/**
 * Get recent tweets from the database.
 */
export async function getTweets(params: {
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
} = {}): Promise<TweetListResponse> {
  const response = await apiClient.get('/twitter/tweets', { params });
  return response.data;
}

/**
 * Search stored tweets by text content.
 */
export async function searchTweets(params: {
  q: string;
  limit?: number;
  hours?: number;
}): Promise<TweetListResponse> {
  const response = await apiClient.get('/twitter/search', { params });
  return response.data;
}

/**
 * Get Twitter API usage statistics.
 */
export async function getTwitterUsageStats(): Promise<TwitterUsageStats> {
  const response = await apiClient.get('/twitter/usage');
  return response.data;
}
