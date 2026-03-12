import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPoliticalEntities,
  getPoliticalEntity,
  getPoliticalEntityByCanonicalId,
  getEntityStories,
  getEntityTimeline,
  getKeyActorDetail,
  type PoliticalEntity,
  type EntityListResponse,
  type EntityStoriesResponse,
  type EntityTimelineResponse,
  type KeyActor,
} from '../analytics';

// Query keys - centralized for cache invalidation
export const entityKeys = {
  all: ['entities'] as const,
  list: (params: { entityType?: string; search?: string; hasMentions?: boolean }) =>
    [...entityKeys.all, 'list', params] as const,
  detail: (id: string) => [...entityKeys.all, 'detail', id] as const,
  byCanonical: (canonicalId: string) => [...entityKeys.all, 'canonical', canonicalId] as const,
  stories: (id: string, hours: number, category?: string) =>
    [...entityKeys.all, 'stories', id, hours, category] as const,
  timeline: (id: string, days: number) =>
    [...entityKeys.all, 'timeline', id, days] as const,
  keyActorDetail: (id: string) => [...entityKeys.all, 'key-actor', id] as const,
};

/**
 * Hook to list political entities with filtering
 */
export function usePoliticalEntities(
  entityType?: string,
  search?: string,
  hasMentions: boolean = true,
  limit: number = 50,
  offset: number = 0
) {
  return useQuery<EntityListResponse>({
    queryKey: entityKeys.list({ entityType, search, hasMentions }),
    queryFn: () => getPoliticalEntities(entityType, search, hasMentions, limit, offset),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook to get a single political entity by ID
 */
export function usePoliticalEntity(entityId: string | undefined) {
  return useQuery<PoliticalEntity>({
    queryKey: entityKeys.detail(entityId || ''),
    queryFn: () => getPoliticalEntity(entityId!),
    enabled: !!entityId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to get a political entity by canonical ID (e.g., 'oli', 'karki')
 */
export function usePoliticalEntityByCanonical(canonicalId: string | undefined) {
  return useQuery<PoliticalEntity>({
    queryKey: entityKeys.byCanonical(canonicalId || ''),
    queryFn: () => getPoliticalEntityByCanonicalId(canonicalId!),
    enabled: !!canonicalId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to get stories mentioning a specific entity
 */
export function useEntityStories(
  entityId: string | undefined,
  hours: number = 168,
  limit: number = 50,
  offset: number = 0,
  category?: string
) {
  return useQuery<EntityStoriesResponse>({
    queryKey: entityKeys.stories(entityId || '', hours, category),
    queryFn: () => getEntityStories(entityId!, hours, limit, offset, category),
    enabled: !!entityId,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Hook to get entity mention timeline (daily counts)
 */
export function useEntityTimeline(
  entityId: string | undefined,
  days: number = 30
) {
  return useQuery<EntityTimelineResponse>({
    queryKey: entityKeys.timeline(entityId || '', days),
    queryFn: () => getEntityTimeline(entityId!, days),
    enabled: !!entityId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to get detailed key actor info with stories
 */
export function useKeyActorDetail(entityId: string | undefined) {
  return useQuery<KeyActor>({
    queryKey: entityKeys.keyActorDetail(entityId || ''),
    queryFn: () => getKeyActorDetail(entityId!),
    enabled: !!entityId,
    staleTime: 30 * 1000,
  });
}
