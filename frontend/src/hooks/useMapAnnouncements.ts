/**
 * Hook for fetching government announcements for map display.
 * Places announcements based on the issuing office:
 * - DAO (District Administration Office) announcements are placed at the district centroid
 * - Central ministries/commissions default to Singha Durbar, Kathmandu
 */

import { useQuery } from '@tanstack/react-query';
import { getAnnouncementSummary } from '../api/announcements';
import type { Announcement } from '../types/announcement';
import { DISTRICTS, normalizeDistrictName } from '../data/districts';
import { formatBsToAd } from '../lib/nepaliDate';

export interface MapAnnouncement {
  id: string;
  title: string;
  source: string;
  source_name: string;
  category: string;
  date_bs: string | null;
  date_ad: string | null;
  url: string;
  is_read: boolean;
  is_important: boolean;
  has_attachments: boolean;
  /** Stable timestamp used for sorting and relative time fallbacks */
  timestamp: string;
  /** User-facing date label for official announcement metadata */
  time_label: string;
  /** Best-effort district name for filtering/labeling */
  district: string;
  // GeoJSON coordinates for marker placement: [lng, lat]
  coordinates: [number, number];
}

// Singha Durbar coordinates (Prime Minister's Office & key ministries)
const SINGHA_DURBAR_COORDS: [number, number] = [85.3206, 27.6989];

const DISTRICT_BY_NORMALIZED = new Map(
  DISTRICTS.map(d => [normalizeDistrictName(d.name), d] as const)
);

function districtToCoordinates(districtName: string): [number, number] | null {
  const info = DISTRICT_BY_NORMALIZED.get(normalizeDistrictName(districtName));
  if (!info) return null;
  // GeoJSON style: [lng, lat]
  return [info.lng, info.lat];
}

// Provincial source domains → province capital district
const PROVINCE_CAPITALS: Record<string, string> = {
  'koshi': 'Morang',
  'madhesh': 'Parsa',
  'bagmati': 'Kathmandu',
  'gandaki': 'Kaski',
  'lumbini': 'Rupandehi',
  'karnali': 'Surkhet',
  'sudurpashchim': 'Kailali',
};

function inferAnnouncementDistrict(announcement: Announcement): string | null {
  // DAO sources are stored as "DAO <District>"
  const m = announcement.source_name.match(/^DAO\s+(.+)$/i);
  if (m?.[1]) return m[1].trim();

  // Fallback: some DAO sources are encoded in the source domain (dao{district}.moha.gov.np)
  const src = (announcement.source || '').toLowerCase();
  const m2 = src.match(/^dao([a-z]+)\.moha\.gov\.np$/);
  if (m2?.[1]) {
    const key = m2[1];
    for (const d of DISTRICTS) {
      const normalized = normalizeDistrictName(d.name).replace(/\s+/g, '');
      if (normalized === key) return d.name;
    }
  }

  // Provincial government sources → map to province capital
  const srcName = announcement.source_name.toLowerCase();
  for (const [province, capital] of Object.entries(PROVINCE_CAPITALS)) {
    if (srcName.includes(province) || src.includes(province)) {
      return capital;
    }
  }

  return null;
}

function formatAdDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return 'Recent';
  }

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function getAnnouncementTimestamp(announcement: Announcement): string {
  return (
    announcement.date_ad ??
    announcement.published_at ??
    announcement.fetched_at ??
    announcement.created_at
  );
}

function getAnnouncementTimeLabel(announcement: Announcement): string {
  if (announcement.date_ad) {
    return formatAdDate(announcement.date_ad);
  }

  if (announcement.date_bs) {
    return formatBsToAd(announcement.date_bs);
  }

  if (announcement.published_at) {
    return formatRelativeTime(announcement.published_at);
  }

  if (announcement.fetched_at) {
    return `Fetched ${formatAdDate(announcement.fetched_at)}`;
  }

  return `Added ${formatAdDate(announcement.created_at)}`;
}

/**
 * Transform announcement to map-ready format
 */
function toMapAnnouncement(announcement: Announcement): MapAnnouncement {
  const inferredDistrict = inferAnnouncementDistrict(announcement);
  const coords = inferredDistrict ? districtToCoordinates(inferredDistrict) : null;

  return {
    id: announcement.id,
    title: announcement.title,
    source: announcement.source,
    source_name: announcement.source_name,
    category: announcement.category,
    date_bs: announcement.date_bs,
    date_ad: announcement.date_ad,
    url: announcement.url,
    is_read: announcement.is_read,
    is_important: announcement.is_important,
    has_attachments: announcement.has_attachments,
    timestamp: getAnnouncementTimestamp(announcement),
    time_label: getAnnouncementTimeLabel(announcement),
    // Use inferred district when available, else default to Kathmandu (Singha Durbar)
    district: inferredDistrict || 'Kathmandu',
    coordinates: coords || SINGHA_DURBAR_COORDS,
  };
}

/**
 * Hook to fetch announcements for map display
 */
export function useMapAnnouncements(hours: number = 168) {
  const query = useQuery({
    queryKey: ['map-announcements', hours],
    queryFn: async () => {
      const summary = await getAnnouncementSummary(20, hours);
      return summary.latest.map(toMapAnnouncement);
    },
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  return {
    announcements: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
