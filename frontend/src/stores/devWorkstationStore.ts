import { create } from 'zustand'

export type DevTab = 'health' | 'pipelines' | 'users' | 'api' | 'corrections' | 'operations' | 'promises'

interface DevWorkstationState {
  activeTab: DevTab
  setActiveTab: (tab: DevTab) => void

  // Correction stats
  pendingCount: number
  setPendingCount: (count: number) => void
}

export const useDevWorkstationStore = create<DevWorkstationState>((set) => ({
  activeTab: 'health',
  setActiveTab: (tab) => set({ activeTab: tab }),

  pendingCount: 0,
  setPendingCount: (count) => set({ pendingCount: count }),
}))
