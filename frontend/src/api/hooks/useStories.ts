import { useQuery } from '@tanstack/react-query';
import { getConsolidatedStories, type ConsolidatedStory } from '../analytics';

// Query keys
export const storiesKeys = {
  all: ['stories'] as const,
  consolidated: (hours: number, limit: number, storyType?: string) =>
    [...storiesKeys.all, 'consolidated', hours, limit, storyType] as const,
};

export interface UseStoriesOptions {
  hours?: number;
  limit?: number;
  storyType?: string;
  enabled?: boolean;
}

/**
 * Hook for consolidated stories (intelligence-enriched)
 * Uses the Palantir-grade consolidated stories endpoint
 */
export function useStories(options: UseStoriesOptions = {}) {
  const { hours = 24, limit = 10, storyType, enabled = true } = options;

  return useQuery<ConsolidatedStory[]>({
    queryKey: storiesKeys.consolidated(hours, limit, storyType),
    queryFn: () => getConsolidatedStories(hours, storyType, undefined, limit),
    staleTime: 60 * 1000, // 1 minute
    enabled,
  });
}

/**
 * Hook for critical/high severity stories only
 */
export function useCriticalStories(limit: number = 5) {
  return useQuery<ConsolidatedStory[]>({
    queryKey: [...storiesKeys.all, 'critical', limit],
    queryFn: async () => {
      const stories = await getConsolidatedStories(24, undefined, 'critical', limit);
      if (stories.length < limit) {
        const highStories = await getConsolidatedStories(24, undefined, 'high', limit - stories.length);
        return [...stories, ...highStories];
      }
      return stories;
    },
    staleTime: 30 * 1000, // 30 seconds for critical stories
  });
}
