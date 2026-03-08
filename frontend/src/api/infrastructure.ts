// Infrastructure API functions - derives infrastructure status from disaster data
import apiClient from './client';

/**
 * Infrastructure status response from the API.
 */
export interface InfrastructureStatus {
  roads: {
    status: 'OPEN' | 'PARTIAL' | 'CLOSED';
    blocked: number;
    total: number;
    affected_districts: string[];
    label_blocked: string;
    label_total: string;
  };
  bridges: {
    status: 'OPEN' | 'PARTIAL' | 'CLOSED';
    blocked: number;
    total: number;
    affected_districts: string[];
    label_blocked: string;
    label_total: string;
  };
  airports: {
    status: 'OPEN' | 'PARTIAL' | 'CLOSED';
    blocked: number;
    total: number;
    label_blocked: string;
    label_total: string;
  };
  hospitals: {
    status: 'ACTIVE' | 'STRAINED';
    capacity_pct: number;
    active: number;
    casualties_treated: number;
    label_blocked: string;
    label_total: string;
  };
  updated_at: string;
  lookback_days: number;
}

export interface BorderCrossingStatusItem {
  id: string;
  name: string;
  route: string;
  customs_offices: string[];
  status: 'OPERATIONAL' | 'NOT_OPERATIONAL' | 'NO_DATA';
  current_month_value_npr_thousands: number;
  previous_month_value_npr_thousands: number;
  is_operational: boolean;
}

export interface BorderCrossingStatusResponse {
  period: {
    fiscal_year_bs: string;
    month_ordinal: number;
    upto_month: string;
  } | null;
  previous_period: {
    fiscal_year_bs: string;
    month_ordinal: number;
    upto_month: string;
  } | null;
  items: BorderCrossingStatusItem[];
  updated_at: string;
}

/**
 * Get infrastructure status derived from active disaster incidents.
 *
 * - Roads: Affected by floods, landslides, avalanches, earthquakes
 * - Bridges: Affected by floods
 * - Airports: Incidents in airport districts
 * - Hospitals: High-severity incidents impacting capacity
 *
 * @param days - Number of days to look back for incidents (1-30)
 */
export const getInfrastructureStatus = async (days: number = 7): Promise<InfrastructureStatus> => {
  const response = await apiClient.get('/infrastructure/status', {
    params: { days },
  });
  return response.data;
};

/**
 * Get border crossing operational status from monthly customs trade data.
 */
export const getBorderCrossingStatus = async (): Promise<BorderCrossingStatusResponse> => {
  const response = await apiClient.get('/infrastructure/border-crossings');
  return response.data;
};
