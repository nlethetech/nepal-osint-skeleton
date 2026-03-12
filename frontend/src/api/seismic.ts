/**
 * Seismic Activity API - earthquake data from BIPAD
 */
import { apiClient } from './client';

export interface SeismicEvent {
  id: string;
  magnitude: number | null;
  depth_km: number | null;
  location: string | null;
  district: string | null;
  alert_level: string;
  issued_at: string | null;
  coordinates: [number, number] | null;
}

export interface SeismicStats {
  status: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL' | 'QUIET';
  events_count: number;
  max_magnitude: number;
  avg_magnitude: number;
  avg_depth_km: number;
  recent_events: SeismicEvent[];
  lookback_hours: number;
  updated_at: string;
}

export interface SeismicEventsResponse {
  events: (SeismicEvent & {
    bipad_id: number;
    title: string;
    province: number | null;
    is_active: boolean;
  })[];
  total: number;
  lookback_hours: number;
}

export interface SeismicMapData {
  features: SeismicEvent[];
  total: number;
}

/**
 * Get seismic activity statistics for widget display.
 *
 * @param hours - Hours to look back (default: 24)
 * @param minMagnitude - Minimum magnitude filter (default: 0)
 */
export const getSeismicStats = async (
  hours: number = 24,
  minMagnitude: number = 0
): Promise<SeismicStats> => {
  const params = new URLSearchParams();
  params.append('hours', hours.toString());
  if (minMagnitude > 0) {
    params.append('min_magnitude', minMagnitude.toString());
  }

  const response = await apiClient.get<SeismicStats>(
    `/seismic/stats?${params.toString()}`
  );
  return response.data;
};

/**
 * Get detailed list of seismic events.
 *
 * @param hours - Hours to look back (default: 72)
 * @param minMagnitude - Minimum magnitude filter (default: 0)
 * @param limit - Max events to return (default: 50)
 */
export const getSeismicEvents = async (
  hours: number = 72,
  minMagnitude: number = 0,
  limit: number = 50
): Promise<SeismicEventsResponse> => {
  const params = new URLSearchParams();
  params.append('hours', hours.toString());
  params.append('limit', limit.toString());
  if (minMagnitude > 0) {
    params.append('min_magnitude', minMagnitude.toString());
  }

  const response = await apiClient.get<SeismicEventsResponse>(
    `/seismic/events?${params.toString()}`
  );
  return response.data;
};

/**
 * Get seismic events for map visualization.
 *
 * @param hours - Hours to look back (default: 72)
 * @param minMagnitude - Minimum magnitude for map display (default: 3.0)
 */
export const getSeismicMapData = async (
  hours: number = 72,
  minMagnitude: number = 3.0
): Promise<SeismicMapData> => {
  const params = new URLSearchParams();
  params.append('hours', hours.toString());
  params.append('min_magnitude', minMagnitude.toString());

  const response = await apiClient.get<SeismicMapData>(
    `/seismic/map?${params.toString()}`
  );
  return response.data;
};
