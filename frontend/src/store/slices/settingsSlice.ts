import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DISTRICTS, PROVINCE_COLORS } from '../../data/districts'

// All provinces in Nepal
export const PROVINCES = [
  'Koshi',
  'Madhesh',
  'Bagmati',
  'Gandaki',
  'Lumbini',
  'Karnali',
  'Sudurpashchim',
] as const

export type Province = (typeof PROVINCES)[number]

// Get districts for a province
export function getDistrictsForProvince(province: Province): string[] {
  return DISTRICTS.filter((d) => d.province === province).map((d) => d.name)
}

// Get districts for multiple provinces
export function getDistrictsForProvinces(provinces: Province[]): string[] {
  return DISTRICTS.filter((d) => provinces.includes(d.province as Province)).map((d) => d.name)
}

interface SettingsState {
  // Province filter settings
  selectedProvinces: Province[]
  isProvinceFilterEnabled: boolean

  // Actions
  toggleProvince: (province: Province) => void
  setSelectedProvinces: (provinces: Province[]) => void
  selectAllProvinces: () => void
  clearAllProvinces: () => void
  toggleProvinceFilter: (enabled?: boolean) => void

  // Computed helpers (not stored, derived)
  getSelectedDistricts: () => string[]
  getFilterLabel: () => string
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Default: all provinces selected, filter disabled (show everything)
      selectedProvinces: [...PROVINCES],
      isProvinceFilterEnabled: false,

      toggleProvince: (province) => {
        const { selectedProvinces } = get()
        const isSelected = selectedProvinces.includes(province)

        if (isSelected) {
          // Don't allow deselecting the last province
          if (selectedProvinces.length === 1) return
          set({
            selectedProvinces: selectedProvinces.filter((p) => p !== province),
            isProvinceFilterEnabled: true, // Auto-enable filter when changing selection
          })
        } else {
          const newProvinces = [...selectedProvinces, province]
          set({
            selectedProvinces: newProvinces,
            // Auto-disable filter if all provinces selected
            isProvinceFilterEnabled: newProvinces.length < PROVINCES.length,
          })
        }
      },

      setSelectedProvinces: (provinces) => {
        if (provinces.length === 0) return // Don't allow empty selection
        set({
          selectedProvinces: provinces,
          isProvinceFilterEnabled: provinces.length < PROVINCES.length,
        })
      },

      selectAllProvinces: () => {
        set({
          selectedProvinces: [...PROVINCES],
          isProvinceFilterEnabled: false,
        })
      },

      clearAllProvinces: () => {
        // Keep at least one province selected (first one)
        set({
          selectedProvinces: [PROVINCES[0]],
          isProvinceFilterEnabled: true,
        })
      },

      toggleProvinceFilter: (enabled) => {
        set((state) => ({
          isProvinceFilterEnabled: enabled ?? !state.isProvinceFilterEnabled,
        }))
      },

      // Derived helpers
      getSelectedDistricts: () => {
        const { selectedProvinces, isProvinceFilterEnabled } = get()
        if (!isProvinceFilterEnabled) return [] // Empty means no filter (show all)
        return getDistrictsForProvinces(selectedProvinces)
      },

      getFilterLabel: () => {
        const { selectedProvinces, isProvinceFilterEnabled } = get()
        if (!isProvinceFilterEnabled || selectedProvinces.length === PROVINCES.length) {
          return 'All Provinces'
        }
        if (selectedProvinces.length === 1) {
          return selectedProvinces[0]
        }
        return `${selectedProvinces.length} Provinces`
      },
    }),
    {
      name: 'nepal-osint-settings',
      partialize: (state) => ({
        selectedProvinces: state.selectedProvinces,
        isProvinceFilterEnabled: state.isProvinceFilterEnabled,
      }),
    }
  )
)

// Export province colors for UI
export { PROVINCE_COLORS }
