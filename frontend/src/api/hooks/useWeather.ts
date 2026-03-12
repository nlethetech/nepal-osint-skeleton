import { useQuery } from '@tanstack/react-query';
import { getCurrentWeather, getWeatherSummary, getWeatherHistory } from '../weather';
import type { WeatherForecast, WeatherSummary, WeatherHistory } from '../../types/weather';

// Query keys - centralized for cache invalidation
export const weatherKeys = {
  all: ['weather'] as const,
  current: () => [...weatherKeys.all, 'current'] as const,
  summary: () => [...weatherKeys.all, 'summary'] as const,
  history: (days: number) => [...weatherKeys.all, 'history', days] as const,
};

/**
 * Hook for current weather forecast.
 *
 * Returns the latest weather bulletin from DHM Nepal with
 * bilingual forecasts (English/Nepali).
 */
export function useCurrentWeather() {
  return useQuery<WeatherForecast>({
    queryKey: weatherKeys.current(),
    queryFn: getCurrentWeather,
    staleTime: 15 * 60 * 1000, // 15 minutes
    refetchInterval: 30 * 60 * 1000, // Auto-refresh every 30 minutes
  });
}

/**
 * Hook for weather summary (optimized for dashboard widget).
 *
 * Returns a simplified weather summary with derived condition,
 * icon code, and forecast text.
 */
export function useWeatherSummary() {
  return useQuery<WeatherSummary>({
    queryKey: weatherKeys.summary(),
    queryFn: getWeatherSummary,
    staleTime: 15 * 60 * 1000, // 15 minutes
    refetchInterval: 30 * 60 * 1000, // Auto-refresh every 30 minutes
  });
}

/**
 * Hook for weather history.
 *
 * @param days - Number of days of history (default: 7)
 */
export function useWeatherHistory(days: number = 7) {
  return useQuery<WeatherHistory>({
    queryKey: weatherKeys.history(days),
    queryFn: () => getWeatherHistory(days),
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}
