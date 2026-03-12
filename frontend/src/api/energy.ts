// Energy data API functions for NEA power grid data
import apiClient from './client';

/**
 * Single energy indicator data
 */
export interface EnergyIndicator {
  value: number;
  unit: string;
  change: number;
  change_amount: number;
  source: string;
  data_date: string | null;
}

/**
 * Total supply data
 */
export interface TotalSupply {
  value: number;
  unit: string;
}

/**
 * Energy summary response from API
 */
export interface EnergySummary {
  nea_subsidiary: EnergyIndicator | null;
  ipp: EnergyIndicator | null;
  import_: EnergyIndicator | null;  // Note: renamed from 'import' (reserved keyword)
  interruption: EnergyIndicator | null;
  total_demand: EnergyIndicator | null;
  total_supply: TotalSupply | null;
  grid_status: string;  // STABLE, SURPLUS, STRAINED, CRITICAL, UNKNOWN
  updated_at: string | null;
}

/**
 * Ingest response
 */
export interface EnergyIngestResponse {
  status: string;
  details: {
    fetched: boolean;
    saved: number;
    error: string | null;
    data_types: string[];
  };
}

/**
 * Get energy summary for dashboard Power Grid widget.
 *
 * Returns current values for:
 * - NEA Subsidiary Companies (MWh)
 * - IPP (Independent Power Producers) (MWh)
 * - Import from India (MWh)
 * - Interruption/Outages (MWh)
 * - Total Energy Demand (MWh)
 * - Total Supply (calculated)
 * - Grid Status
 */
export const getEnergySummary = async (): Promise<EnergySummary> => {
  const response = await apiClient.get('/energy/summary');
  return response.data;
};

/**
 * Manually refresh energy data from NEA.
 *
 * Admin/debugging endpoint.
 */
export const refreshEnergyData = async (): Promise<EnergyIngestResponse> => {
  const response = await apiClient.post('/energy/refresh');
  return response.data;
};
