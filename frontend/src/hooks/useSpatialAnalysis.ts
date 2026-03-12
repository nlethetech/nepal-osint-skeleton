/**
 * React Query hooks for Spatial Analysis API
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query'
import {
  getHotspots,
  getProximity,
  getTemporalSpatial,
  type HotspotParams,
  type HotspotResponse,
  type ProximityParams,
  type ProximityResponse,
  type TemporalSpatialParams,
  type TemporalSpatialResponse,
} from '../api/spatial'

// Query keys
export const spatialKeys = {
  all: ['spatial'] as const,
  hotspots: (params: HotspotParams) => [...spatialKeys.all, 'hotspots', params] as const,
  proximity: (params: ProximityParams) => [...spatialKeys.all, 'proximity', params] as const,
  temporal: (params: TemporalSpatialParams) => [...spatialKeys.all, 'temporal', params] as const,
}

/**
 * Hook to fetch hotspot clusters.
 */
export function useHotspots(
  params: HotspotParams = {},
  options?: Omit<UseQueryOptions<HotspotResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: spatialKeys.hotspots(params),
    queryFn: () => getHotspots(params),
    staleTime: 60_000, // 1 minute
    refetchInterval: 120_000, // 2 minutes
    ...options,
  })
}

/**
 * Hook to fetch events within a radius.
 *
 * Only fetches when center coordinates are provided.
 */
export function useProximity(
  params: Partial<ProximityParams>,
  options?: Omit<UseQueryOptions<ProximityResponse, Error>, 'queryKey' | 'queryFn'>
) {
  const hasCenter = params.lat !== undefined && params.lng !== undefined

  return useQuery({
    queryKey: spatialKeys.proximity(params as ProximityParams),
    queryFn: () => getProximity(params as ProximityParams),
    enabled: hasCenter,
    staleTime: 30_000, // 30 seconds
    ...options,
  })
}

/**
 * Hook to fetch temporal-spatial animation data.
 */
export function useTemporalSpatial(
  params: TemporalSpatialParams = {},
  options?: Omit<UseQueryOptions<TemporalSpatialResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: spatialKeys.temporal(params),
    queryFn: () => getTemporalSpatial(params),
    staleTime: 60_000, // 1 minute
    ...options,
  })
}
