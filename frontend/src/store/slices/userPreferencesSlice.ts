import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DISTRICTS, type DistrictInfo } from '../../data/districts'
import { PROVINCES, type Province } from './settingsSlice'

// Topic categories for civilian users
export const TOPICS = [
  { id: 'disasters', label: 'Disasters & Emergencies', icon: 'alert-triangle', description: 'Earthquakes, floods, landslides' },
  { id: 'elections', label: 'Elections & Politics', icon: 'vote', description: 'Election results, political news' },
  { id: 'economy', label: 'Economy & Business', icon: 'trending-up', description: 'Markets, trade, business news' },
  { id: 'crime', label: 'Crime & Safety', icon: 'shield', description: 'Crime reports, safety alerts' },
  { id: 'health', label: 'Health', icon: 'heart', description: 'Health news, disease outbreaks' },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'building', description: 'Roads, power, water supply' },
  { id: 'education', label: 'Education', icon: 'book', description: 'Schools, universities, exams' },
  { id: 'environment', label: 'Environment', icon: 'leaf', description: 'Climate, pollution, conservation' },
] as const

export type TopicId = typeof TOPICS[number]['id']

// App modes
export type AppMode = 'civilian' | 'professional'

export interface DashboardOnboardingState {
  version: number
  welcomeDismissed: boolean
  tourCompleted: boolean
  tourSkipped: boolean
  lastSeenUserKey: string | null
  lastCompletedAt: string | null
}

const DASHBOARD_ONBOARDING_VERSION = 1

const defaultDashboardOnboardingState = (): DashboardOnboardingState => ({
  version: DASHBOARD_ONBOARDING_VERSION,
  welcomeDismissed: false,
  tourCompleted: false,
  tourSkipped: false,
  lastSeenUserKey: null,
  lastCompletedAt: null,
})

interface UserPreferencesState {
  // Onboarding
  hasCompletedOnboarding: boolean
  onboardingStep: number
  dashboardOnboarding: DashboardOnboardingState
  tourReplayRequested: boolean

  // App mode
  appMode: AppMode

  // Location preferences
  selectedDistricts: string[]
  homeDistrict: string | null

  // Topic preferences
  selectedTopics: TopicId[]

  // Notification preferences
  pushNotificationsEnabled: boolean
  emailAlertsEnabled: boolean
  alertSeverityThreshold: 'all' | 'high' | 'critical'

  // Actions - Onboarding
  setOnboardingStep: (step: number) => void
  completeOnboarding: () => void
  resetOnboarding: () => void
  shouldShowDashboardOnboarding: (userKey: string, isGuest: boolean) => boolean
  startDashboardTour: () => void
  completeDashboardTour: (userKey: string) => void
  skipDashboardTour: (userKey: string) => void
  dismissWelcome: (userKey: string) => void
  requestTourReplay: () => void
  clearTourReplay: () => void
  resetDashboardOnboarding: () => void

  // Actions - Mode
  setAppMode: (mode: AppMode) => void

  // Actions - Districts
  setSelectedDistricts: (districts: string[]) => void
  toggleDistrict: (district: string) => void
  selectProvince: (province: Province) => void
  deselectProvince: (province: Province) => void
  setHomeDistrict: (district: string | null) => void
  selectAllDistricts: () => void
  clearAllDistricts: () => void

  // Actions - Topics
  setSelectedTopics: (topics: TopicId[]) => void
  toggleTopic: (topic: TopicId) => void

  // Actions - Notifications
  setPushNotifications: (enabled: boolean) => void
  setEmailAlerts: (enabled: boolean) => void
  setAlertThreshold: (threshold: 'all' | 'high' | 'critical') => void

  // Helpers
  getDistrictsByProvince: () => Record<Province, DistrictInfo[]>
  isDistrictSelected: (district: string) => boolean
  isProvinceFullySelected: (province: Province) => boolean
  isProvincePartiallySelected: (province: Province) => boolean
}

export const useUserPreferencesStore = create<UserPreferencesState>()(
  persist(
    (set, get) => ({
      // Initial state
      hasCompletedOnboarding: false,
      onboardingStep: 0,
      dashboardOnboarding: defaultDashboardOnboardingState(),
      tourReplayRequested: false,

      appMode: 'civilian',

      selectedDistricts: [],
      homeDistrict: null,

      selectedTopics: ['disasters', 'elections'], // Default topics

      pushNotificationsEnabled: true,
      emailAlertsEnabled: false,
      alertSeverityThreshold: 'high',

      // Onboarding actions
      setOnboardingStep: (step) => set({ onboardingStep: step }),

      completeOnboarding: () => set({
        hasCompletedOnboarding: true,
        onboardingStep: 0
      }),

      resetOnboarding: () => set({
        hasCompletedOnboarding: false,
        onboardingStep: 0,
        selectedDistricts: [],
        homeDistrict: null,
        selectedTopics: ['disasters', 'elections'],
      }),

      shouldShowDashboardOnboarding: (userKey) => {
        const { dashboardOnboarding, tourReplayRequested } = get()
        if (tourReplayRequested) return true
        if (!userKey) return false
        if (dashboardOnboarding.version !== DASHBOARD_ONBOARDING_VERSION) return true
        if (dashboardOnboarding.lastSeenUserKey !== userKey) return true
        return !dashboardOnboarding.tourCompleted && !dashboardOnboarding.tourSkipped
      },

      startDashboardTour: () => set({
        dashboardOnboarding: {
          ...get().dashboardOnboarding,
          welcomeDismissed: true,
        },
      }),

      completeDashboardTour: (userKey) => set({
        dashboardOnboarding: {
          version: DASHBOARD_ONBOARDING_VERSION,
          welcomeDismissed: true,
          tourCompleted: true,
          tourSkipped: false,
          lastSeenUserKey: userKey,
          lastCompletedAt: new Date().toISOString(),
        },
        tourReplayRequested: false,
      }),

      skipDashboardTour: (userKey) => set({
        dashboardOnboarding: {
          version: DASHBOARD_ONBOARDING_VERSION,
          welcomeDismissed: true,
          tourCompleted: false,
          tourSkipped: true,
          lastSeenUserKey: userKey,
          lastCompletedAt: get().dashboardOnboarding.lastCompletedAt,
        },
        tourReplayRequested: false,
      }),

      dismissWelcome: (userKey) => set({
        dashboardOnboarding: {
          ...get().dashboardOnboarding,
          version: DASHBOARD_ONBOARDING_VERSION,
          welcomeDismissed: true,
          lastSeenUserKey: userKey,
        },
      }),

      requestTourReplay: () => set({
        tourReplayRequested: true,
        dashboardOnboarding: {
          ...get().dashboardOnboarding,
          welcomeDismissed: false,
        },
      }),

      clearTourReplay: () => set({ tourReplayRequested: false }),

      resetDashboardOnboarding: () => set({
        dashboardOnboarding: defaultDashboardOnboardingState(),
        tourReplayRequested: false,
      }),

      // Mode actions
      setAppMode: (mode) => set({ appMode: mode }),

      // District actions
      setSelectedDistricts: (districts) => set({ selectedDistricts: districts }),

      toggleDistrict: (district) => {
        const { selectedDistricts } = get()
        const isSelected = selectedDistricts.includes(district)

        if (isSelected) {
          set({ selectedDistricts: selectedDistricts.filter(d => d !== district) })
        } else {
          set({ selectedDistricts: [...selectedDistricts, district] })
        }
      },

      selectProvince: (province) => {
        const { selectedDistricts } = get()
        const provinceDistricts = DISTRICTS
          .filter(d => d.province === province)
          .map(d => d.name)

        const newDistricts = [...new Set([...selectedDistricts, ...provinceDistricts])]
        set({ selectedDistricts: newDistricts })
      },

      deselectProvince: (province) => {
        const { selectedDistricts } = get()
        const provinceDistricts = DISTRICTS
          .filter(d => d.province === province)
          .map(d => d.name)

        set({
          selectedDistricts: selectedDistricts.filter(d => !provinceDistricts.includes(d))
        })
      },

      setHomeDistrict: (district) => {
        set({ homeDistrict: district })
        // Also add to selected districts if not already
        if (district) {
          const { selectedDistricts } = get()
          if (!selectedDistricts.includes(district)) {
            set({ selectedDistricts: [...selectedDistricts, district] })
          }
        }
      },

      selectAllDistricts: () => {
        set({ selectedDistricts: DISTRICTS.map(d => d.name) })
      },

      clearAllDistricts: () => {
        set({ selectedDistricts: [], homeDistrict: null })
      },

      // Topic actions
      setSelectedTopics: (topics) => set({ selectedTopics: topics }),

      toggleTopic: (topic) => {
        const { selectedTopics } = get()
        const isSelected = selectedTopics.includes(topic)

        if (isSelected) {
          // Keep at least one topic
          if (selectedTopics.length > 1) {
            set({ selectedTopics: selectedTopics.filter(t => t !== topic) })
          }
        } else {
          set({ selectedTopics: [...selectedTopics, topic] })
        }
      },

      // Notification actions
      setPushNotifications: (enabled) => set({ pushNotificationsEnabled: enabled }),
      setEmailAlerts: (enabled) => set({ emailAlertsEnabled: enabled }),
      setAlertThreshold: (threshold) => set({ alertSeverityThreshold: threshold }),

      // Helpers
      getDistrictsByProvince: () => {
        const grouped: Record<Province, DistrictInfo[]> = {} as Record<Province, DistrictInfo[]>
        for (const province of PROVINCES) {
          grouped[province] = DISTRICTS.filter(d => d.province === province)
        }
        return grouped
      },

      isDistrictSelected: (district) => {
        return get().selectedDistricts.includes(district)
      },

      isProvinceFullySelected: (province) => {
        const { selectedDistricts } = get()
        const provinceDistricts = DISTRICTS.filter(d => d.province === province)
        return provinceDistricts.every(d => selectedDistricts.includes(d.name))
      },

      isProvincePartiallySelected: (province) => {
        const { selectedDistricts } = get()
        const provinceDistricts = DISTRICTS.filter(d => d.province === province)
        const selectedCount = provinceDistricts.filter(d => selectedDistricts.includes(d.name)).length
        return selectedCount > 0 && selectedCount < provinceDistricts.length
      },
    }),
    {
      name: 'nepal-osint-user-preferences',
      partialize: (state) => ({
        hasCompletedOnboarding: state.hasCompletedOnboarding,
        appMode: state.appMode,
        dashboardOnboarding: state.dashboardOnboarding,
        selectedDistricts: state.selectedDistricts,
        homeDistrict: state.homeDistrict,
        selectedTopics: state.selectedTopics,
        pushNotificationsEnabled: state.pushNotificationsEnabled,
        emailAlertsEnabled: state.emailAlertsEnabled,
        alertSeverityThreshold: state.alertSeverityThreshold,
      }),
    }
  )
)
