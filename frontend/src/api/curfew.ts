/**
 * Curfew Alerts API - Active curfews from DAO/Provincial announcements
 */
import { apiClient } from './client';

export interface CurfewAlert {
  id: string;
  district: string;
  province: string | null;
  title: string;
  source: string;
  source_name: string | null;
  matched_keywords: string[];
  detected_at: string;
  expires_at: string;
  is_active: boolean;
  is_confirmed: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  hours_remaining: number;
}

export interface ActiveCurfewsResponse {
  alerts: CurfewAlert[];
  districts: string[];
  count: number;
}

export interface CurfewMapData {
  districts: string[];
  alerts: {
    district: string;
    severity: string;
    hours_remaining: number;
    title: string;
  }[];
}

export interface CurfewStats {
  active: number;
  total: number;
  by_province: Record<string, number>;
  by_severity: Record<string, number>;
}

/**
 * Get all active curfew alerts.
 *
 * Returns list of districts with active curfews and detailed alert info.
 */
export const getActiveCurfews = async (): Promise<ActiveCurfewsResponse> => {
  const response = await apiClient.get<ActiveCurfewsResponse>('/curfew/active');
  return response.data;
};

/**
 * Get curfew data for map visualization.
 *
 * Returns list of district names for polygon highlighting.
 */
export const getCurfewMapData = async (): Promise<CurfewMapData> => {
  const response = await apiClient.get<CurfewMapData>('/curfew/map-data');
  return response.data;
};

/**
 * Get curfew statistics.
 */
export const getCurfewStats = async (): Promise<CurfewStats> => {
  const response = await apiClient.get<CurfewStats>('/curfew/stats');
  return response.data;
};

/**
 * Get active curfew alert for a specific district.
 */
export const getCurfewByDistrict = async (district: string): Promise<CurfewAlert> => {
  const response = await apiClient.get<CurfewAlert>(`/curfew/district/${encodeURIComponent(district)}`);
  return response.data;
};

/**
 * Get curfew alerts for a province.
 */
export const getCurfewsByProvince = async (province: string): Promise<{
  province: string;
  count: number;
  districts: string[];
  alerts: CurfewAlert[];
}> => {
  const response = await apiClient.get(`/curfew/province/${encodeURIComponent(province)}`);
  return response.data;
};

/**
 * Get curfew history for a district.
 */
export const getCurfewHistory = async (district: string, limit: number = 10): Promise<{
  district: string;
  total: number;
  history: CurfewAlert[];
}> => {
  const params = new URLSearchParams({ limit: limit.toString() });
  const response = await apiClient.get(`/curfew/history/${encodeURIComponent(district)}?${params.toString()}`);
  return response.data;
};

/**
 * Get most recent curfew alerts (active or expired).
 */
export const getRecentCurfews = async (limit: number = 10): Promise<{
  count: number;
  alerts: CurfewAlert[];
}> => {
  const params = new URLSearchParams({ limit: limit.toString() });
  const response = await apiClient.get(`/curfew/recent?${params.toString()}`);
  return response.data;
};

/**
 * Deactivate a curfew alert (admin only).
 */
export const deactivateCurfew = async (alertId: string): Promise<{
  status: string;
  id: string;
  message: string;
}> => {
  const response = await apiClient.post(`/curfew/${alertId}/deactivate`);
  return response.data;
};

/**
 * Extend a curfew alert's expiration (admin only).
 */
export const extendCurfew = async (alertId: string, hours: number = 24): Promise<{
  status: string;
  id: string;
  new_expires_at: string;
  hours_remaining: number;
}> => {
  const params = new URLSearchParams({ hours: hours.toString() });
  const response = await apiClient.post(`/curfew/${alertId}/extend?${params.toString()}`);
  return response.data;
};

/**
 * Confirm a curfew alert (admin only).
 */
export const confirmCurfew = async (alertId: string): Promise<{
  status: string;
  id: string;
  is_confirmed: boolean;
}> => {
  const response = await apiClient.post(`/curfew/${alertId}/confirm`);
  return response.data;
};
