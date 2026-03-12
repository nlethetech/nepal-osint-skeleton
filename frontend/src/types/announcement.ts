// Government Announcement Types

export interface Attachment {
  name: string;
  url: string;
}

export interface Announcement {
  id: string;
  external_id: string;
  source: string;
  source_name: string;
  title: string;
  url: string;
  category: string;
  date_bs: string | null;
  date_ad: string | null;
  attachments: Attachment[];
  has_attachments: boolean;
  content: string | null;
  is_read: boolean;
  is_important: boolean;
  published_at: string | null;
  fetched_at: string;
  created_at: string;
}

export interface AnnouncementListResponse {
  announcements: Announcement[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

export interface AnnouncementSummary {
  total: number;
  unread: number;
  by_source: Record<string, number>;
  by_category: Record<string, number>;
  latest: Announcement[];
}

export interface IngestionStats {
  source: string;
  fetched: number;
  new: number;
  updated: number;
  errors: string[];
}

export interface SourceInfo {
  source: string;
  name: string;
  name_ne: string | null;
  categories: string[];
  total_announcements: number;
  last_fetched: string | null;
}
