import { useQuery } from '@tanstack/react-query';
import { getKPISnapshot, getAlertDetails, getHourlyTrends } from '../kpi';
import type { KPISnapshot, AlertDetail, HourlyTrend } from '../../types/kpi';

// Query keys - centralized for cache invalidation
export const kpiKeys = {
  all: ['kpi'] as const,
  snapshot: (hours: number, districts?: string[]) =>
    [...kpiKeys.all, 'snapshot', hours, districts?.join(',') ?? 'all'] as const,
  alerts: (severity: string, hours: number, districts?: string[]) =>
    [...kpiKeys.all, 'alerts', severity, hours, districts?.join(',') ?? 'all'] as const,
  hourlyTrends: (hours: number, districts?: string[]) =>
    [...kpiKeys.all, 'hourly-trends', hours, districts?.join(',') ?? 'all'] as const,
};

/**
 * Hook for KPI snapshot (Palantir-grade metrics).
 *
 * Returns all primary and secondary KPIs with:
 * - Traceability metadata
 * - Confidence scores
 * - Trend indicators
 * - Anomaly detection flags
 *
 * @param hours - Time window in hours
 * @param districts - Optional array of district names to filter by
 */
export function useKPISnapshot(hours: number = 24, districts?: string[]) {
  return useQuery<KPISnapshot>({
    queryKey: kpiKeys.snapshot(hours, districts),
    queryFn: () => getKPISnapshot(hours, false, districts),
    staleTime: 15 * 1000, // 15 seconds
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds
  });
}

/**
 * Hook for detailed alert list (drill-down view).
 *
 * @param severity - Comma-separated severity filter
 * @param hours - Time window in hours
 * @param limit - Max alerts to return
 * @param districts - Optional array of district names to filter by
 */
export function useAlertDetails(
  severity: string = 'critical,high',
  hours: number = 6,
  limit: number = 20,
  districts?: string[]
) {
  return useQuery<AlertDetail[]>({
    queryKey: kpiKeys.alerts(severity, hours, districts),
    queryFn: () => getAlertDetails(severity, hours, limit, districts),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook for hourly trends (sparkline data).
 *
 * @param hours - Time window in hours
 * @param districts - Optional array of district names to filter by
 */
export function useHourlyTrends(hours: number = 24, districts?: string[]) {
  return useQuery<HourlyTrend[]>({
    queryKey: kpiKeys.hourlyTrends(hours, districts),
    queryFn: () => getHourlyTrends(hours, districts),
    staleTime: 60 * 1000, // 1 minute
  });
}
