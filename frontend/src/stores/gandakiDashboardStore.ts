/**
 * Gandaki Dashboard Store
 *
 * State management for the Gandaki Province Dashboard using Zustand.
 * Handles view scope, district selection, and time range filtering.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { GANDAKI_DISTRICTS, type GandakiDistrict, type TimeRange } from '../data/gandaki'

export type ViewScope = 'gandaki' | 'all-nepal'

interface GandakiDashboardState {
  // View state
  viewScope: ViewScope
  selectedDistrict: GandakiDistrict | null
  timeRange: TimeRange

  // UI state
  isMapExpanded: boolean
  showDistrictDetails: boolean

  // Actions
  setViewScope: (scope: ViewScope) => void
  selectDistrict: (district: GandakiDistrict | null) => void
  setTimeRange: (range: TimeRange) => void
  toggleMapExpanded: () => void
  setShowDistrictDetails: (show: boolean) => void
  reset: () => void
}

const initialState = {
  viewScope: 'gandaki' as ViewScope,
  selectedDistrict: null,
  timeRange: '7d' as TimeRange,
  isMapExpanded: false,
  showDistrictDetails: false,
}

export const useGandakiDashboardStore = create<GandakiDashboardState>()(
  persist(
    (set) => ({
      ...initialState,

      setViewScope: (scope) =>
        set((state) => ({
          viewScope: scope,
          // Clear district selection when switching to all-nepal view
          selectedDistrict: scope === 'all-nepal' ? null : state.selectedDistrict,
        })),

      selectDistrict: (district) =>
        set({
          selectedDistrict: district,
          showDistrictDetails: district !== null,
        }),

      setTimeRange: (range) =>
        set({ timeRange: range }),

      toggleMapExpanded: () =>
        set((state) => ({ isMapExpanded: !state.isMapExpanded })),

      setShowDistrictDetails: (show) =>
        set({ showDistrictDetails: show }),

      reset: () => set(initialState),
    }),
    {
      name: 'gandaki-dashboard-v1',
    }
  )
)

// Helper function to get time range in hours
export function getTimeRangeHours(range: TimeRange): number {
  switch (range) {
    case '24h':
      return 24
    case '48h':
      return 48
    case '7d':
      return 168
    case '30d':
      return 720
    default:
      return 168
  }
}

// Helper function to check if a district is in Gandaki
export function isGandakiDistrict(district: string): district is GandakiDistrict {
  return (GANDAKI_DISTRICTS as readonly string[]).includes(district) ||
    (GANDAKI_DISTRICTS as readonly string[]).includes(normalizeDistrictName(district))
}

// Map GeoJSON district names to our display names
const GEOJSON_NAME_MAP: Record<string, GandakiDistrict> = {
  'Nawalpur': 'Nawalparasi East',
  'Tanahun': 'Tanahu',
}

// Reverse map for converting display names to GeoJSON names
const DISPLAY_NAME_MAP: Record<string, string> = {
  'Nawalparasi East': 'Nawalpur',
  'Tanahu': 'Tanahun',
}

// Normalize district name from GeoJSON format to display format
export function normalizeDistrictName(name: string): GandakiDistrict | string {
  return GEOJSON_NAME_MAP[name] || name
}

// Convert display name to GeoJSON name
export function toGeoJsonName(displayName: string): string {
  return DISPLAY_NAME_MAP[displayName] || displayName
}

// Get all Gandaki district names including GeoJSON variants
export function getGandakiDistrictVariants(): string[] {
  const variants: string[] = [...GANDAKI_DISTRICTS]
  Object.keys(GEOJSON_NAME_MAP).forEach(geoName => {
    if (!variants.includes(geoName)) {
      variants.push(geoName)
    }
  })
  return variants
}
