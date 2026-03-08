/**
 * Earth Engine hooks — Stub for open-source skeleton
 */

export interface GEEStatus {
  initialized: boolean;
  available: boolean;
}

export interface ChangeAlert {
  id: string;
  district: string;
  severity: string;
  type: string;
  detection_type: string;
  description: string;
  detected_at: string;
}

export interface ChangeAlertsResponse {
  alerts: ChangeAlert[];
  total_count: number;
}

export function useGEEStatus() {
  return {
    data: null as GEEStatus | null,
    isLoading: false,
    error: null,
  };
}

export function useChangeAlerts(
  _params?: { hours?: number },
  _options?: { enabled?: boolean },
) {
  return {
    data: { alerts: [], total_count: 0 } as ChangeAlertsResponse,
    isLoading: false,
    error: null,
  };
}
