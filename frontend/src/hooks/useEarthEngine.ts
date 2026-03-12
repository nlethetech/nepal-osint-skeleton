/**
 * React Query hooks for Earth Engine API
 *
 * Provides hooks for:
 * - GEE service status
 * - Environmental analysis (NDVI, precipitation, temperature)
 * - Disaster analysis (flood extent, landslide detection)
 * - Change detection alerts
 */

import { useQuery, useMutation, useQueryClient, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query'
import {
  getStatus,
  getNDVI,
  getPrecipitation,
  getTemperature,
  analyzeFloodExtent,
  detectLandslides,
  getBeforeAfter,
  getChangeAlerts,
  subscribeChangeDetection,
  unsubscribeChangeDetection,
  triggerChangeDetection,
  type GEEStatus,
  type NDVIParams,
  type NDVIResult,
  type PrecipitationParams,
  type PrecipitationResult,
  type TemperatureParams,
  type TemperatureResult,
  type FloodAnalysisParams,
  type FloodAnalysisResult,
  type LandslideAnalysisParams,
  type LandslideAnalysisResult,
  type BeforeAfterParams,
  type BeforeAfterResult,
  type ChangeAlertsParams,
  type ChangeAlertsResponse,
  type SubscribeParams,
  type ChangeSubscription,
} from '../api/earthEngine'

// =============================================================================
// QUERY KEYS
// =============================================================================

export const earthEngineKeys = {
  all: ['earth-engine'] as const,
  status: () => [...earthEngineKeys.all, 'status'] as const,

  // Environmental
  environmental: () => [...earthEngineKeys.all, 'environmental'] as const,
  ndvi: (params: NDVIParams) => [...earthEngineKeys.environmental(), 'ndvi', params] as const,
  precipitation: (params: PrecipitationParams) =>
    [...earthEngineKeys.environmental(), 'precipitation', params] as const,
  temperature: (params: TemperatureParams) =>
    [...earthEngineKeys.environmental(), 'temperature', params] as const,

  // Analysis
  analysis: () => [...earthEngineKeys.all, 'analysis'] as const,
  floodExtent: (params: FloodAnalysisParams) =>
    [...earthEngineKeys.analysis(), 'flood-extent', params] as const,
  landslide: (params: LandslideAnalysisParams) =>
    [...earthEngineKeys.analysis(), 'landslide', params] as const,
  beforeAfter: (params: BeforeAfterParams) =>
    [...earthEngineKeys.analysis(), 'before-after', params] as const,

  // Change Detection
  changeDetection: () => [...earthEngineKeys.all, 'change-detection'] as const,
  changeAlerts: (params: ChangeAlertsParams) =>
    [...earthEngineKeys.changeDetection(), 'alerts', params] as const,
}

// =============================================================================
// STATUS HOOK
// =============================================================================

/**
 * Hook to check GEE service status.
 */
export function useGEEStatus(
  options?: Omit<UseQueryOptions<GEEStatus, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: earthEngineKeys.status(),
    queryFn: getStatus,
    staleTime: 60_000, // 1 minute
    retry: 1,
    ...options,
  })
}

// =============================================================================
// ENVIRONMENTAL HOOKS
// =============================================================================

/**
 * Hook to fetch NDVI (vegetation) analysis.
 *
 * @param bbox - Bounding box string "minLng,minLat,maxLng,maxLat"
 * @param date - Optional analysis date (YYYY-MM-DD)
 */
export function useNDVI(
  bbox: string | null,
  date?: string | null,
  options?: Omit<UseQueryOptions<NDVIResult, Error>, 'queryKey' | 'queryFn'>
) {
  const params: NDVIParams = {
    bbox: bbox || '',
    date: date || undefined,
  }

  return useQuery({
    queryKey: earthEngineKeys.ndvi(params),
    queryFn: () => getNDVI(params),
    enabled: !!bbox,
    staleTime: 5 * 60_000, // 5 minutes
    ...options,
  })
}

/**
 * Hook to fetch precipitation analysis.
 *
 * @param bbox - Bounding box string
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 */
export function usePrecipitation(
  bbox: string | null,
  startDate: string | null,
  endDate: string | null,
  options?: Omit<UseQueryOptions<PrecipitationResult, Error>, 'queryKey' | 'queryFn'>
) {
  const params: PrecipitationParams = {
    bbox: bbox || '',
    start_date: startDate || '',
    end_date: endDate || '',
  }

  return useQuery({
    queryKey: earthEngineKeys.precipitation(params),
    queryFn: () => getPrecipitation(params),
    enabled: !!bbox && !!startDate && !!endDate,
    staleTime: 5 * 60_000, // 5 minutes
    ...options,
  })
}

/**
 * Hook to fetch temperature analysis.
 *
 * @param bbox - Bounding box string
 * @param date - Optional analysis date
 */
export function useTemperature(
  bbox: string | null,
  date?: string | null,
  options?: Omit<UseQueryOptions<TemperatureResult, Error>, 'queryKey' | 'queryFn'>
) {
  const params: TemperatureParams = {
    bbox: bbox || '',
    date: date || undefined,
  }

  return useQuery({
    queryKey: earthEngineKeys.temperature(params),
    queryFn: () => getTemperature(params),
    enabled: !!bbox,
    staleTime: 5 * 60_000, // 5 minutes
    ...options,
  })
}

// =============================================================================
// DISASTER ANALYSIS HOOKS
// =============================================================================

/**
 * Hook to analyze flood extent.
 * Uses mutation since it's a potentially expensive operation.
 */
export function useFloodAnalysis(
  options?: Omit<UseMutationOptions<FloodAnalysisResult, Error, FloodAnalysisParams>, 'mutationFn'>
) {
  return useMutation({
    mutationFn: analyzeFloodExtent,
    ...options,
  })
}

/**
 * Hook to detect landslides.
 * Uses mutation since it's a potentially expensive operation.
 */
export function useLandslideDetection(
  options?: Omit<UseMutationOptions<LandslideAnalysisResult, Error, LandslideAnalysisParams>, 'mutationFn'>
) {
  return useMutation({
    mutationFn: detectLandslides,
    ...options,
  })
}

/**
 * Hook to get before/after comparison imagery.
 */
export function useBeforeAfter(
  params: Partial<BeforeAfterParams>,
  options?: Omit<UseQueryOptions<BeforeAfterResult, Error>, 'queryKey' | 'queryFn'>
) {
  const { bbox, before_date, after_date } = params
  const isEnabled = !!bbox && !!before_date && !!after_date

  return useQuery({
    queryKey: earthEngineKeys.beforeAfter(params as BeforeAfterParams),
    queryFn: () => getBeforeAfter(params as BeforeAfterParams),
    enabled: isEnabled,
    staleTime: 10 * 60_000, // 10 minutes
    ...options,
  })
}

// =============================================================================
// CHANGE DETECTION HOOKS
// =============================================================================

/**
 * Hook to fetch change detection alerts.
 *
 * @param hours - Time window in hours (default 168 = 7 days)
 */
export function useChangeAlerts(
  params: ChangeAlertsParams = {},
  options?: Omit<UseQueryOptions<ChangeAlertsResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: earthEngineKeys.changeAlerts(params),
    queryFn: () => getChangeAlerts(params),
    staleTime: 60_000, // 1 minute
    refetchInterval: 5 * 60_000, // 5 minutes
    ...options,
  })
}

/**
 * Hook to subscribe to change detection.
 */
export function useSubscribeChangeDetection(
  options?: Omit<UseMutationOptions<ChangeSubscription, Error, SubscribeParams>, 'mutationFn'>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: subscribeChangeDetection,
    onSuccess: () => {
      // Invalidate alerts to refresh
      queryClient.invalidateQueries({ queryKey: earthEngineKeys.changeDetection() })
    },
    ...options,
  })
}

/**
 * Hook to unsubscribe from change detection.
 */
export function useUnsubscribeChangeDetection(
  options?: Omit<UseMutationOptions<void, Error, string>, 'mutationFn'>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: unsubscribeChangeDetection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: earthEngineKeys.changeDetection() })
    },
    ...options,
  })
}

/**
 * Hook to manually trigger change detection.
 */
export function useTriggerChangeDetection(
  options?: Omit<UseMutationOptions<{ status: string; message: string }, Error, void>, 'mutationFn'>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: triggerChangeDetection,
    onSuccess: () => {
      // The detection runs in background, but we can refresh alerts after a delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: earthEngineKeys.changeAlerts({}) })
      }, 30_000) // 30 seconds
    },
    ...options,
  })
}

// =============================================================================
// COMBINED ANALYSIS HOOK
// =============================================================================

/**
 * Combined hook for environmental analysis on a region.
 * Fetches NDVI, temperature, and optionally precipitation data.
 */
export function useEnvironmentalAnalysis(
  bbox: string | null,
  date?: string | null,
  precipRange?: { start: string; end: string } | null
) {
  const ndvi = useNDVI(bbox, date)
  const temperature = useTemperature(bbox, date)
  const precipitation = usePrecipitation(
    bbox,
    precipRange?.start || null,
    precipRange?.end || null
  )

  return {
    ndvi,
    temperature,
    precipitation,
    isLoading: ndvi.isLoading || temperature.isLoading || (precipRange ? precipitation.isLoading : false),
    isError: ndvi.isError || temperature.isError || (precipRange ? precipitation.isError : false),
  }
}
