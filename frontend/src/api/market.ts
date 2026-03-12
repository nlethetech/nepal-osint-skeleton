// Market data API functions for NEPSE, forex, gold/silver, and fuel prices
import apiClient from './client';

/**
 * Single market indicator data
 */
export interface MarketIndicator {
  value: number;
  unit: string;
  change: number;
  change_amount: number;
  source: string;
  data_date: string | null;
}

/**
 * Market summary response from API
 */
export interface MarketSummary {
  nepse: MarketIndicator | null;
  usd_npr: MarketIndicator | null;
  gold: MarketIndicator | null;
  silver: MarketIndicator | null;
  petrol: MarketIndicator | null;
  diesel: MarketIndicator | null;
  updated_at: string | null;
}

/**
 * Ingest response
 */
export interface MarketIngestResponse {
  status: string;
  details: Record<string, unknown>;
}

/**
 * Get market summary for dashboard widget.
 *
 * Returns current values for:
 * - NEPSE index
 * - USD/NPR exchange rate
 * - Gold price per tola
 * - Silver price per tola
 * - Petrol price per litre
 * - Diesel price per litre
 */
export const getMarketSummary = async (): Promise<MarketSummary> => {
  const response = await apiClient.get('/market/summary');
  return response.data;
};

/**
 * Manually refresh all market data from sources.
 *
 * Admin/debugging endpoint.
 */
export const refreshMarketData = async (): Promise<MarketIngestResponse> => {
  const response = await apiClient.post('/market/refresh');
  return response.data;
};

/**
 * Refresh forex data only.
 */
export const refreshForex = async () => {
  const response = await apiClient.post('/market/refresh/forex');
  return response.data;
};

/**
 * Refresh gold/silver data only.
 */
export const refreshGoldSilver = async () => {
  const response = await apiClient.post('/market/refresh/gold-silver');
  return response.data;
};

/**
 * Refresh fuel prices only.
 */
export const refreshFuel = async () => {
  const response = await apiClient.post('/market/refresh/fuel');
  return response.data;
};

/**
 * Refresh NEPSE index only.
 */
export const refreshNepse = async () => {
  const response = await apiClient.post('/market/refresh/nepse');
  return response.data;
};
