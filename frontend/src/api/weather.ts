// Weather API functions for DHM Nepal data
import apiClient from './client';
import type { WeatherForecast, WeatherSummary, WeatherHistory } from '../types/weather';

/**
 * Get the current weather forecast for Nepal.
 *
 * Returns the latest weather bulletin from DHM (Department of Hydrology
 * and Meteorology) Nepal with bilingual forecasts.
 */
export const getCurrentWeather = async (): Promise<WeatherForecast> => {
  const response = await apiClient.get('/weather/current');
  return response.data;
};

/**
 * Get weather summary for dashboard widget.
 *
 * Returns a simplified weather summary with derived condition,
 * icon code, and forecast text optimized for display.
 */
export const getWeatherSummary = async (): Promise<WeatherSummary> => {
  const response = await apiClient.get('/weather/summary');
  return response.data;
};

/**
 * Get historical weather forecasts.
 *
 * @param days - Number of days of history (1-30)
 */
export const getWeatherHistory = async (days: number = 7): Promise<WeatherHistory> => {
  const response = await apiClient.get('/weather/history', {
    params: { days },
  });
  return response.data;
};

/**
 * Manually refresh weather data from DHM API.
 *
 * Admin/debugging endpoint.
 */
export const refreshWeather = async (): Promise<{
  status: string;
  created: boolean;
  updated: boolean;
  error: string | null;
}> => {
  const response = await apiClient.post('/weather/refresh');
  return response.data;
};
