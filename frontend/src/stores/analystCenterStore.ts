import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  getExecutiveSummary,
  getThreatMatrixAI,
  getConsolidatedStories,
  getKeyActors,
  type ThreatMatrixCell,
  type ConsolidatedStory,
  type KeyActor,
} from '../api/analytics'
import { getHourlyTrends } from '../api/kpi'
import type { HourlyTrend } from '../types/kpi'

// Tab types
export type AnalystTab = 'situational' | 'collaboration' | 'investigation'

// Executive summary type (matches backend response)
export interface ExecutiveSummary {
  key_judgment: string
  situation_overview: string
  priority_developments: Array<{
    headline: string
    significance: string
    districts: string[]
  }>
  geographic_focus: string[]
  threat_level: 'CRITICAL' | 'ELEVATED' | 'GUARDED' | 'LOW'
  threat_trajectory: 'ESCALATING' | 'STABLE' | 'DE-ESCALATING'
  watch_items: string[]
  story_count: number
  time_range_hours: number
  generated_at: string
}

export interface FilterState {
  hours: number
  categories: string[]
  severities: string[]
  districts: string[]
}

interface AnalystCenterState {
  // Tab state
  activeTab: AnalystTab
  selectedCaseId: string | null

  // Filter state (affects all panels)
  filters: FilterState

  // Data
  executiveSummary: ExecutiveSummary | null
  categoryMatrix: ThreatMatrixCell[]
  stories: ConsolidatedStory[]
  keyActors: KeyActor[]
  hourlyTrends: HourlyTrend[]

  // Pagination
  currentPage: number
  pageSize: number
  totalStories: number

  // UI state
  selectedStoryId: string | null
  isLoading: boolean
  error: string | null
  lastUpdated: string | null

  // Actions
  setActiveTab: (tab: AnalystTab) => void
  setSelectedCase: (caseId: string | null) => void
  setFilters: (filters: Partial<FilterState>) => void
  clearFilters: () => void
  refreshAll: () => Promise<void>
  selectStory: (id: string | null) => void
  setPage: (page: number) => void
}

const DEFAULT_FILTERS: FilterState = {
  hours: 24,
  categories: [],
  severities: [],
  districts: [],
}

export const useAnalystCenterStore = create<AnalystCenterState>()(
  persist(
    (set, get) => ({
      // Initial state
      activeTab: 'situational' as AnalystTab,
      selectedCaseId: null,
      filters: DEFAULT_FILTERS,
      executiveSummary: null,
      categoryMatrix: [],
      stories: [],
      keyActors: [],
      hourlyTrends: [],
      currentPage: 1,
      pageSize: 25,
      totalStories: 0,
      selectedStoryId: null,
      isLoading: false,
      error: null,
      lastUpdated: null,

      // Actions
      setActiveTab: (tab) => {
        set({ activeTab: tab })
        // When switching to investigation, case should be selected first
        if (tab !== 'investigation') {
          set({ selectedCaseId: null })
        }
      },

      setSelectedCase: (caseId) => {
        set({ selectedCaseId: caseId })
        // Auto-switch to investigation tab when case is selected
        if (caseId) {
          set({ activeTab: 'investigation' })
        }
      },

      setFilters: (newFilters) => {
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
          currentPage: 1, // Reset to first page on filter change
        }))
        // Optionally trigger refresh when filters change
        get().refreshAll()
      },

      clearFilters: () => {
        set({ filters: DEFAULT_FILTERS, currentPage: 1 })
        get().refreshAll()
      },

      setPage: (page) => {
        set({ currentPage: page })
      },

      refreshAll: async () => {
        const { filters } = get()
        set({ isLoading: true, error: null })

        try {
          // Determine category filter for API
          const categoryFilter = filters.categories.length === 1 ? filters.categories[0] : undefined
          const severityFilter = filters.severities.length === 1 ? filters.severities[0] : undefined
          const districtsFilter = filters.districts.length > 0 ? filters.districts : undefined

          // Fetch all data in parallel
          const [summary, matrix, storiesData, actors, trends] = await Promise.all([
            getExecutiveSummary(filters.hours).catch(() => null),
            getThreatMatrixAI(filters.hours).catch(() => ({ matrix: [], overall_threat_level: 'LOW', last_updated: new Date().toISOString(), overall_assessment: '', category_insights: {}, priority_watch_items: [], escalation_risk: 'LOW' as const, ai_generated: false })),
            // API: getConsolidatedStories(hours, storyType, severity, limit, districts)
            getConsolidatedStories(
              filters.hours,
              categoryFilter,
              severityFilter,
              200, // Get more stories for client-side pagination
              districtsFilter
            ).catch(() => []),
            getKeyActors(filters.hours, undefined, 15).catch(() => []),
            getHourlyTrends(filters.hours).catch(() => []),
          ])

          // Apply client-side filtering if multiple categories/severities selected
          let filteredStories = storiesData
          if (filters.categories.length > 1) {
            filteredStories = filteredStories.filter(
              (s) => s.story_type && filters.categories.includes(s.story_type.toLowerCase())
            )
          }
          if (filters.severities.length > 1) {
            filteredStories = filteredStories.filter(
              (s) => s.severity && filters.severities.includes(s.severity.toLowerCase())
            )
          }

          set({
            executiveSummary: summary,
            categoryMatrix: matrix.matrix || [],
            stories: filteredStories,
            totalStories: filteredStories.length,
            keyActors: actors,
            hourlyTrends: trends,
            lastUpdated: new Date().toISOString(),
            isLoading: false,
          })
        } catch (e) {
          set({
            error: e instanceof Error ? e.message : 'Failed to load data',
            isLoading: false,
          })
        }
      },

      selectStory: (id) => {
        set({ selectedStoryId: id })
      },
    }),
    {
      name: 'analyst-center-v2',
      partialize: (state) => ({
        filters: state.filters,
        activeTab: state.activeTab,
      }),
    }
  )
)
