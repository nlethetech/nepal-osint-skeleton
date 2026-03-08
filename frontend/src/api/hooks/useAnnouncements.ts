import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAnnouncementSummary,
  getAnnouncements,
  getAnnouncement,
  getAnnouncementSources,
  markAsRead,
  toggleImportant,
} from '../announcements';
import type {
  AnnouncementSummary,
  AnnouncementListResponse,
  Announcement,
  SourceInfo,
} from '../../types/announcement';

// Query keys - centralized for cache invalidation
export const announcementKeys = {
  all: ['announcements'] as const,
  summary: (limit: number, hours?: number, provinces?: string[]) =>
    [...announcementKeys.all, 'summary', limit, hours, provinces?.join(',') ?? 'all'] as const,
  list: (params: Record<string, unknown>) => [...announcementKeys.all, 'list', params] as const,
  detail: (id: string) => [...announcementKeys.all, 'detail', id] as const,
  sources: () => [...announcementKeys.all, 'sources'] as const,
};

/**
 * Hook for announcement summary (dashboard widget).
 *
 * Returns counts, breakdown by source/category, and latest announcements.
 * @param limit - Number of announcements to fetch
 * @param hours - Filter by hours (24=1d, 72=3d, 168=7d). Undefined for all time.
 * @param provinces - Filter by province(s). Undefined for all provinces.
 */
export function useAnnouncementSummary(limit: number = 5, hours?: number, provinces?: string[]) {
  return useQuery<AnnouncementSummary>({
    queryKey: announcementKeys.summary(limit, hours, provinces),
    queryFn: () => getAnnouncementSummary(limit, hours, provinces),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 10 * 60 * 1000, // Auto-refresh every 10 minutes
  });
}

/**
 * Hook for paginated announcement list.
 */
export function useAnnouncements(params: {
  page?: number;
  per_page?: number;
  source?: string;
  category?: string;
  unread_only?: boolean;
  hours?: number;
  province?: string;
} = {}) {
  return useQuery<AnnouncementListResponse>({
    queryKey: announcementKeys.list(params),
    queryFn: () => getAnnouncements(params),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook for single announcement detail.
 */
export function useAnnouncement(id: string) {
  return useQuery<Announcement>({
    queryKey: announcementKeys.detail(id),
    queryFn: () => getAnnouncement(id),
    enabled: !!id,
  });
}

/**
 * Hook for announcement sources list.
 */
export function useAnnouncementSources() {
  return useQuery<SourceInfo[]>({
    queryKey: announcementKeys.sources(),
    queryFn: getAnnouncementSources,
    staleTime: 60 * 60 * 1000, // 1 hour (sources rarely change)
  });
}

/**
 * Mutation hook to mark announcement as read.
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAsRead,
    onSuccess: (_, id) => {
      // Invalidate summary and list caches after successful mark-read.
      // API returns {status, id} only, so we refresh the canonical records.
      queryClient.invalidateQueries({ queryKey: announcementKeys.all });
      queryClient.invalidateQueries({ queryKey: announcementKeys.detail(id) });
    },
  });
}

/**
 * Mutation hook to toggle important flag.
 */
export function useToggleImportant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isImportant }: { id: string; isImportant: boolean }) =>
      toggleImportant(id, isImportant),
    onSuccess: (updated) => {
      queryClient.setQueryData(announcementKeys.detail(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: announcementKeys.all });
    },
  });
}
