// Government Announcements API functions
import apiClient from './client';
import type {
  Announcement,
  AnnouncementListResponse,
  AnnouncementSummary,
  SourceInfo,
} from '../types/announcement';

/**
 * Get announcement summary for dashboard widget.
 *
 * Returns counts, unread status, and latest announcements.
 * @param limit - Number of announcements to fetch
 * @param hours - Filter by hours (24=1d, 72=3d, 168=7d). Undefined for all time.
 * @param provinces - Filter by province(s). Undefined for all provinces.
 */
export const getAnnouncementSummary = async (
  limit: number = 5,
  hours?: number,
  provinces?: string[]
): Promise<AnnouncementSummary> => {
  const response = await apiClient.get('/announcements/summary', {
    params: {
      limit,
      hours,
      // Pass provinces as comma-separated string if provided
      province: provinces && provinces.length > 0 ? provinces.join(',') : undefined,
    },
  });
  return response.data;
};

/**
 * Get paginated list of announcements.
 *
 * @param page - Page number (1-indexed)
 * @param perPage - Items per page
 * @param source - Filter by source (optional)
 * @param category - Filter by category (optional)
 * @param unreadOnly - Only show unread announcements
 * @param province - Filter by province(s) as comma-separated string (optional)
 */
export const getAnnouncements = async (params: {
  page?: number;
  per_page?: number;
  source?: string;
  category?: string;
  unread_only?: boolean;
  hours?: number;
  province?: string;
}): Promise<AnnouncementListResponse> => {
  const response = await apiClient.get('/announcements/list', { params });
  return response.data;
};

/**
 * Get single announcement by ID.
 */
export const getAnnouncement = async (id: string): Promise<Announcement> => {
  const response = await apiClient.get(`/announcements/${id}`);
  return response.data;
};

/**
 * Get available announcement sources.
 */
export const getAnnouncementSources = async (): Promise<SourceInfo[]> => {
  const response = await apiClient.get('/announcements/sources');
  return response.data;
};

/**
 * Mark an announcement as read.
 */
export const markAsRead = async (id: string): Promise<{ status: string; id: string }> => {
  const response = await apiClient.post(`/announcements/${id}/read`);
  return response.data;
};

/**
 * Toggle important flag on an announcement.
 */
export const toggleImportant = async (id: string, isImportant: boolean): Promise<Announcement> => {
  const response = await apiClient.patch(`/announcements/${id}`, {
    is_important: isImportant,
  });
  return response.data;
};

/**
 * Manually refresh announcements from all sources.
 * Admin/debugging endpoint.
 */
export const refreshAnnouncements = async (): Promise<{
  status: string;
  stats: Array<{
    source: string;
    fetched: number;
    new: number;
    updated: number;
    errors: string[];
  }>;
}> => {
  const response = await apiClient.post('/announcements/refresh');
  return response.data;
};
