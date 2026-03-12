// KPI API functions for Palantir-grade dashboard metrics
import apiClient from './client';
import type { KPISnapshot, AlertDetail, HourlyTrend } from '../types/kpi';

/**
 * Get complete KPI snapshot with all primary and secondary metrics.
 *
 * @param hours - Time window for KPI computation (1-168)
 * @param forceRefresh - Bypass cache and compute fresh
 * @param districts - Optional array of district names to filter by
 */
export const getKPISnapshot = async (
  hours: number = 24,
  forceRefresh: boolean = false,
  districts?: string[]
): Promise<KPISnapshot> => {
  const params: Record<string, unknown> = { hours, force_refresh: forceRefresh };

  // Only add districts param if there are districts to filter by
  if (districts && districts.length > 0) {
    params.districts = districts.join(',');
  }

  const response = await apiClient.get('/kpi/snapshot', { params });
  return response.data;
};

/**
 * Get detailed alert list for drill-down view.
 *
 * @param severity - Comma-separated severity filter (e.g., "critical,high")
 * @param hours - Time window in hours
 * @param limit - Max alerts to return
 * @param districts - Optional array of district names to filter by
 */
export const getAlertDetails = async (
  severity: string = 'critical,high',
  hours: number = 6,
  limit: number = 20,
  districts?: string[]
): Promise<AlertDetail[]> => {
  const params: Record<string, unknown> = { severity, hours, limit };

  if (districts && districts.length > 0) {
    params.districts = districts.join(',');
  }

  const response = await apiClient.get('/kpi/alerts/detail', { params });
  return response.data;
};

/**
 * Get hourly event breakdown for sparkline visualization.
 *
 * @param hours - Time window in hours
 * @param districts - Optional array of district names to filter by
 */
export const getHourlyTrends = async (
  hours: number = 24,
  districts?: string[]
): Promise<HourlyTrend[]> => {
  const params: Record<string, unknown> = { hours };

  if (districts && districts.length > 0) {
    params.districts = districts.join(',');
  }

  const response = await apiClient.get('/kpi/trends/hourly', { params });
  return response.data;
};

/**
 * Get KPI cache status (debugging).
 */
export const getKPICacheStatus = async (): Promise<{
  status: string;
  caches: Record<string, { ttl_seconds: number; cached: boolean }>;
}> => {
  const response = await apiClient.get('/kpi/cache/status');
  return response.data;
};

/**
 * Invalidate KPI cache (debugging/admin).
 *
 * @param hours - Specific time window to invalidate, or all if undefined
 */
export const invalidateKPICache = async (
  hours?: number
): Promise<{ status: string; keys_deleted: number }> => {
  const response = await apiClient.post('/kpi/cache/invalidate', null, {
    params: hours ? { hours } : {},
  });
  return response.data;
};
