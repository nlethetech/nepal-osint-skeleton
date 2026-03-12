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

// Workspace mode presets
export type WorkspaceMode = 'situational' | 'investigation' | 'geospatial' | 'entities' | 'custom'

// Panel content types
export type PanelContentType =
  | 'story-feed'
  | 'intel-map'
  | 'case-board'
  | 'evidence-timeline'
  | 'verification-queue'
  | 'activity-stream'
  | 'leaderboard'
  | 'damage-assessment'
  | 'spatial-analysis'
  | 'pwtt-viewer'
  | 'entity-network'
  | 'mentions-feed'
  | 'entity-profile'
  | 'layer-control'

// Quick action definitions
export interface QuickAction {
  key: string
  label: string
  shortcut: string
  icon: string
}

export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'new-case', label: 'New Case', shortcut: 'N', icon: 'FolderPlus' },
  { key: 'verify', label: 'Verify', shortcut: 'V', icon: 'CheckCircle' },
  { key: 'correlate', label: 'Correlate', shortcut: 'L', icon: 'GitBranch' },
  { key: 'damage-check', label: 'Damage Check', shortcut: 'D', icon: 'Target' },
  { key: 'export', label: 'Export', shortcut: 'E', icon: 'Download' },
]

// Mode presets
export const MODE_PRESETS: Record<WorkspaceMode, { panel1: PanelContentType; panel2: PanelContentType }> = {
  situational: { panel1: 'story-feed', panel2: 'intel-map' },
  investigation: { panel1: 'case-board', panel2: 'evidence-timeline' },
  geospatial: { panel1: 'pwtt-viewer', panel2: 'spatial-analysis' },
  entities: { panel1: 'entity-network', panel2: 'mentions-feed' },
  custom: { panel1: 'story-feed', panel2: 'intel-map' },
}

// Intel Fusion correlation
export interface IntelCorrelation {
  id: string
  type: 'entity_spike' | 'geographic_cluster' | 'temporal_pattern' | 'cross_category'
  title: string
  description: string
  confidence: number
  relatedStoryIds: string[]
  detectedAt: string
}

// Filter state
export interface FilterState {
  hours: number
  categories: string[]
  severities: string[]
  districts: string[]
}

// Executive summary type
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

// Panel state
export interface PanelState {
  content: PanelContentType
  title: string
  isCollapsed: boolean
}

// PWTT Analysis state (shared between viewer and analysis panels)
export interface PWTTParams {
  centerLat: number
  centerLng: number
  radiusKm: number
  eventDate: string
}

export interface PWTTState {
  params: PWTTParams | null
  imageUrl: string | null
  isGenerating: boolean
  error: string | null
}

interface CommandCenterState {
  // Layout state
  workspaceMode: WorkspaceMode
  panel1: PanelState
  panel2: PanelState
  splitRatio: number // 0-1, position of divider
  isSinglePanelMode: boolean
  showNewCaseModal: boolean
  newCaseLinkedClusterId: string | null

  // Filter state (affects all panels)
  filters: FilterState

  // Selection state
  selectedStoryId: string | null
  selectedEntityId: string | null
  selectedCaseId: string | null

  // Intel Fusion state
  threatLevel: 'CRITICAL' | 'ELEVATED' | 'GUARDED' | 'LOW'
  correlations: IntelCorrelation[]
  activeHotspots: string[]

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
  isLoading: boolean
  error: string | null
  lastUpdated: string | null
  isCommandBarExpanded: boolean
  showShortcutsModal: boolean

  // PWTT state (shared between panels)
  pwtt: PWTTState

  // Actions
  setWorkspaceMode: (mode: WorkspaceMode) => void
  setPanel1Content: (content: PanelContentType) => void
  setPanel2Content: (content: PanelContentType) => void
  setSplitRatio: (ratio: number) => void
  toggleSinglePanelMode: () => void
  setShowNewCaseModal: (show: boolean) => void
  setNewCaseLinkedClusterId: (clusterId: string | null) => void
  setFilters: (filters: Partial<FilterState>) => void
  clearFilters: () => void
  selectStory: (id: string | null) => void
  selectEntity: (id: string | null) => void
  selectCase: (id: string | null) => void
  setPage: (page: number) => void
  refreshAll: () => Promise<void>
  executeQuickAction: (actionKey: string) => void
  toggleCommandBarExpanded: () => void
  setShowShortcutsModal: (show: boolean) => void

  // PWTT actions
  setPwttParams: (params: PWTTParams) => void
  setPwttImageUrl: (url: string | null) => void
  setPwttGenerating: (isGenerating: boolean) => void
  setPwttError: (error: string | null) => void
  clearPwtt: () => void
}

const DEFAULT_FILTERS: FilterState = {
  hours: 24,
  categories: [],
  severities: [],
  districts: [],
}

const getPanelTitle = (content: PanelContentType): string => {
  switch (content) {
    case 'story-feed': return 'Story Feed'
    case 'intel-map': return 'Intel Map'
    case 'case-board': return 'Case Board'
    case 'evidence-timeline': return 'Evidence Timeline'
    case 'verification-queue': return 'Verification Queue'
    case 'activity-stream': return 'Activity Stream'
    case 'leaderboard': return 'Leaderboard'
    case 'damage-assessment': return 'Damage Assessment'
    case 'spatial-analysis': return 'PWTT Spatial Analysis'
    case 'pwtt-viewer': return 'PWTT Three-Panel'
    case 'entity-network': return 'Entity Network'
    case 'mentions-feed': return 'Mentions Feed'
    case 'entity-profile': return 'Entity Profile'
    case 'layer-control': return 'Layer Control'
    default: return 'Panel'
  }
}

export const useCommandCenterStore = create<CommandCenterState>()(
  persist(
    (set, get) => ({
      // Initial state
      workspaceMode: 'situational',
      panel1: { content: 'story-feed', title: 'Story Feed', isCollapsed: false },
      panel2: { content: 'intel-map', title: 'Intel Map', isCollapsed: false },
      splitRatio: 0.5,
      isSinglePanelMode: false,
      showNewCaseModal: false,
      newCaseLinkedClusterId: null,

      filters: DEFAULT_FILTERS,

      selectedStoryId: null,
      selectedEntityId: null,
      selectedCaseId: null,

      threatLevel: 'GUARDED',
      correlations: [],
      activeHotspots: [],

      executiveSummary: null,
      categoryMatrix: [],
      stories: [],
      keyActors: [],
      hourlyTrends: [],

      currentPage: 1,
      pageSize: 25,
      totalStories: 0,

      isLoading: false,
      error: null,
      lastUpdated: null,
      isCommandBarExpanded: true,
      showShortcutsModal: false,

      // PWTT shared state
      pwtt: {
        params: null,
        imageUrl: null,
        isGenerating: false,
        error: null,
      },

      // Actions
      setWorkspaceMode: (mode) => {
        const preset = MODE_PRESETS[mode]
        set({
          workspaceMode: mode,
          panel1: { content: preset.panel1, title: getPanelTitle(preset.panel1), isCollapsed: false },
          panel2: { content: preset.panel2, title: getPanelTitle(preset.panel2), isCollapsed: false },
          showNewCaseModal: false,
          newCaseLinkedClusterId: null,
        })
      },

      setPanel1Content: (content) => {
        set((state) => ({
          panel1: { ...state.panel1, content, title: getPanelTitle(content) },
          workspaceMode: 'custom',
        }))
      },

      setPanel2Content: (content) => {
        set((state) => ({
          panel2: { ...state.panel2, content, title: getPanelTitle(content) },
          workspaceMode: 'custom',
        }))
      },

      setSplitRatio: (ratio) => {
        set({ splitRatio: Math.max(0.2, Math.min(0.8, ratio)) })
      },

      toggleSinglePanelMode: () => {
        set((state) => ({ isSinglePanelMode: !state.isSinglePanelMode }))
      },

      setShowNewCaseModal: (show) => {
        set((state) => ({
          showNewCaseModal: show,
          newCaseLinkedClusterId: show ? state.newCaseLinkedClusterId : null,
        }))
      },

      setNewCaseLinkedClusterId: (clusterId) => {
        set({ newCaseLinkedClusterId: clusterId })
      },

      setFilters: (newFilters) => {
        set((state) => ({
          filters: { ...state.filters, ...newFilters },
          currentPage: 1,
        }))
        get().refreshAll()
      },

      clearFilters: () => {
        set({ filters: DEFAULT_FILTERS, currentPage: 1 })
        get().refreshAll()
      },

      selectStory: (id) => {
        set({ selectedStoryId: id })
      },

      selectEntity: (id) => {
        set({ selectedEntityId: id })
      },

      selectCase: (id) => {
        set({ selectedCaseId: id })
        if (id) {
          get().setWorkspaceMode('investigation')
        }
      },

      setPage: (page) => {
        set({ currentPage: page })
      },

      refreshAll: async () => {
        const { filters } = get()
        set({ isLoading: true, error: null })

        try {
          const categoryFilter = filters.categories.length === 1 ? filters.categories[0] : undefined
          const severityFilter = filters.severities.length === 1 ? filters.severities[0] : undefined
          const districtsFilter = filters.districts.length > 0 ? filters.districts : undefined

          const [summary, matrix, storiesData, actors, trends] = await Promise.all([
            getExecutiveSummary(filters.hours).catch(() => null),
            getThreatMatrixAI(filters.hours).catch(() => ({
              matrix: [],
              overall_threat_level: 'LOW',
              last_updated: new Date().toISOString(),
              overall_assessment: '',
              category_insights: {},
              priority_watch_items: [],
              escalation_risk: 'LOW' as const,
              ai_generated: false,
            })),
            getConsolidatedStories(
              filters.hours,
              categoryFilter,
              severityFilter,
              200,
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

          // Determine overall threat level
          const threatLevel = summary?.threat_level ||
            (matrix.overall_threat_level === 'CRITICAL' ? 'CRITICAL' :
             matrix.overall_threat_level === 'HIGH' ? 'ELEVATED' :
             matrix.overall_threat_level === 'MEDIUM' ? 'GUARDED' : 'LOW') as CommandCenterState['threatLevel']

          set({
            executiveSummary: summary,
            categoryMatrix: matrix.matrix || [],
            stories: filteredStories,
            totalStories: filteredStories.length,
            keyActors: actors,
            hourlyTrends: trends,
            threatLevel,
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

      executeQuickAction: (actionKey) => {
        const { setWorkspaceMode, setShowNewCaseModal, setNewCaseLinkedClusterId } = get()
        switch (actionKey) {
          case 'new-case':
            // Switch to investigation mode for case creation
            setWorkspaceMode('investigation')
            {
              const { selectedStoryId, stories } = get()
              const linkedClusterId =
                selectedStoryId ? (stories.find((s) => s.id === selectedStoryId)?.cluster_id || null) : null
              setNewCaseLinkedClusterId(linkedClusterId)
            }
            setShowNewCaseModal(true)
            break
          case 'verify':
            // Switch to situational mode for verification queue
            setWorkspaceMode('situational')
            set({
              panel2: {
                content: 'verification-queue',
                title: getPanelTitle('verification-queue'),
                isCollapsed: false,
              },
            })
            break
          case 'correlate':
            // Switch to entities mode for correlation analysis
            setWorkspaceMode('entities')
            break
          case 'damage-check':
            // Switch to geospatial mode for damage assessment
            setWorkspaceMode('geospatial')
            break
          case 'export':
            // TODO: Open export dialog/modal
            break
        }
      },

      toggleCommandBarExpanded: () => {
        set((state) => ({ isCommandBarExpanded: !state.isCommandBarExpanded }))
      },

      setShowShortcutsModal: (show) => {
        set({ showShortcutsModal: show })
      },

      // PWTT actions
      setPwttParams: (params) => {
        set((state) => ({
          pwtt: { ...state.pwtt, params, error: null }
        }))
      },

      setPwttImageUrl: (url) => {
        set((state) => ({
          pwtt: { ...state.pwtt, imageUrl: url, isGenerating: false }
        }))
      },

      setPwttGenerating: (isGenerating) => {
        set((state) => ({
          pwtt: {
            ...state.pwtt,
            isGenerating,
            // Only clear errors when starting a new run; don't wipe them on completion.
            error: isGenerating ? null : state.pwtt.error,
          }
        }))
      },

      setPwttError: (error) => {
        set((state) => ({
          pwtt: { ...state.pwtt, error, isGenerating: false }
        }))
      },

      clearPwtt: () => {
        set({
          pwtt: { params: null, imageUrl: null, isGenerating: false, error: null }
        })
      },
    }),
    {
      name: 'command-center-v1',
      partialize: (state) => ({
        workspaceMode: state.workspaceMode,
        filters: state.filters,
        splitRatio: state.splitRatio,
        isSinglePanelMode: state.isSinglePanelMode,
      }),
    }
  )
)
