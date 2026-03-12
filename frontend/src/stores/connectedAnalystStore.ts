import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GraphLayer } from '../api/multiLayerGraph'

export type RightPanelMode = 'profile' | 'satellite' | 'hypothesis' | 'trade' | 'procurement' | 'corrections'
export type GraphFilter = 'all' | 'entities' | 'kb'
export type { GraphLayer }

// ============================================================================
// Multi-layer graph config interfaces
// ============================================================================

interface TradeLayerConfig {
  fiscal_year_bs: string | null
  direction: string | null
  top_countries: number
  top_hs_chapters: number
  min_value_npr_thousands: number
  include_customs: boolean
  top_customs: number
}

interface EntityLayerConfig {
  window: string
  min_strength: number
  limit_nodes: number
  include_parties: boolean
  include_constituencies: boolean
  include_ministerial: boolean
  include_opponents: boolean
  include_geographic: boolean
  election_year_bs: number | null
}

interface NewsLayerConfig {
  hours: number
  min_co_mentions: number
  limit_entities: number
  include_story_nodes: boolean
  category: string | null
  include_districts: boolean
  include_entity_connections: boolean
}

interface DisasterLayerConfig {
  days: number
  min_severity: string | null
  hazard_type: string | null
  limit_incidents: number
}

interface GeographicLayerConfig {
  expand_province_id: number | null
  expand_district: string | null
}

interface LayerConfigs {
  trade: TradeLayerConfig
  entity: EntityLayerConfig
  news: NewsLayerConfig
  disaster: DisasterLayerConfig
  geographic: GeographicLayerConfig
}

// ============================================================================
// Store interface
// ============================================================================

interface ConnectedAnalystState {
  // Selection state
  selectedEntityId: string | null
  selectedRunId: string | null
  selectedObjectId: string | null
  rightPanelMode: RightPanelMode
  graphFilter: GraphFilter
  activeTradeFilter: { dimension: string; key: string } | null
  timeRange: [Date, Date] | null

  // Multi-layer graph state
  activeLayers: GraphLayer[]
  layerConfigs: LayerConfigs
  expandedCountry: string | null
  expandedHsChapter: string | null
  visibleEdgeTypes: string[]
  visibleNodeTypes: string[]
  graphFilterOpen: boolean
  graphSearchQuery: string
  hideOrphans: boolean

  // Actions
  selectEntity: (entityId: string | null) => void
  selectRun: (runId: string | null) => void
  selectObject: (objectId: string | null) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  setGraphFilter: (filter: GraphFilter) => void
  setActiveTradeFilter: (filter: { dimension: string; key: string } | null) => void
  setTimeRange: (range: [Date, Date] | null) => void

  // Multi-layer graph actions
  toggleLayer: (layer: GraphLayer) => void
  setLayerConfig: <K extends keyof LayerConfigs>(layer: K, config: Partial<LayerConfigs[K]>) => void
  setExpandedCountry: (country: string | null) => void
  setExpandedHsChapter: (chapter: string | null) => void
  setVisibleEdgeTypes: (types: string[]) => void
  setVisibleNodeTypes: (types: string[]) => void
  toggleGraphFilter: () => void
  setGraphSearchQuery: (query: string) => void
  setHideOrphans: (hide: boolean) => void
}

// ============================================================================
// Default layer configs
// ============================================================================

const DEFAULT_LAYER_CONFIGS: LayerConfigs = {
  trade: {
    fiscal_year_bs: null,
    direction: null,
    top_countries: 20,
    top_hs_chapters: 15,
    min_value_npr_thousands: 0,
    include_customs: true,
    top_customs: 20,
  },
  entity: {
    window: '7d',
    min_strength: 0.1,
    limit_nodes: 100,
    include_parties: true,
    include_constituencies: false,
    include_ministerial: true,
    include_opponents: false,
    include_geographic: true,
    election_year_bs: null,
  },
  news: {
    hours: 168,
    min_co_mentions: 2,
    limit_entities: 50,
    include_story_nodes: true,
    category: null,
    include_districts: true,
    include_entity_connections: true,
  },
  disaster: {
    days: 90,
    min_severity: null,
    hazard_type: null,
    limit_incidents: 50,
  },
  geographic: {
    expand_province_id: null,
    expand_district: null,
  },
}

// ============================================================================
// Store
// ============================================================================

export const useConnectedAnalystStore = create<ConnectedAnalystState>()(
  persist(
    (set) => ({
      selectedEntityId: null,
      selectedRunId: null,
      selectedObjectId: null,
      rightPanelMode: 'profile',
      graphFilter: 'all',
      activeTradeFilter: null,
      timeRange: null,

      // Multi-layer graph defaults
      activeLayers: ['entity'],
      layerConfigs: DEFAULT_LAYER_CONFIGS,
      expandedCountry: null,
      expandedHsChapter: null,
      visibleEdgeTypes: [],
      visibleNodeTypes: [],
      graphFilterOpen: false,
      graphSearchQuery: '',
      hideOrphans: true,

      // Existing actions
      selectEntity: (entityId) =>
        set((state) => ({
          selectedEntityId: entityId,
          rightPanelMode: entityId ? 'profile' : state.rightPanelMode,
        })),

      selectRun: (runId) =>
        set((state) => ({
          selectedRunId: runId,
          rightPanelMode: runId ? 'satellite' : state.rightPanelMode,
        })),

      selectObject: (objectId) =>
        set((state) => ({
          selectedObjectId: objectId,
          rightPanelMode: objectId ? 'trade' : state.rightPanelMode,
        })),

      setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
      setGraphFilter: (filter) => set({ graphFilter: filter }),
      setActiveTradeFilter: (filter) => set({ activeTradeFilter: filter }),
      setTimeRange: (range) => set({ timeRange: range }),

      // Multi-layer graph actions
      toggleLayer: (layer) =>
        set((state) => ({
          activeLayers: state.activeLayers.includes(layer)
            ? state.activeLayers.filter((l) => l !== layer)
            : [...state.activeLayers, layer],
        })),

      setLayerConfig: (layer, config) =>
        set((state) => ({
          layerConfigs: {
            ...state.layerConfigs,
            [layer]: {
              ...state.layerConfigs[layer],
              ...config,
            },
          },
        })),

      setExpandedCountry: (country) => set({ expandedCountry: country }),
      setExpandedHsChapter: (chapter) => set({ expandedHsChapter: chapter }),
      setVisibleEdgeTypes: (types) => set({ visibleEdgeTypes: types }),
      setVisibleNodeTypes: (types) => set({ visibleNodeTypes: types }),
      toggleGraphFilter: () =>
        set((state) => ({ graphFilterOpen: !state.graphFilterOpen })),
      setGraphSearchQuery: (query) => set({ graphSearchQuery: query }),
      setHideOrphans: (hide) => set({ hideOrphans: hide }),
    }),
    {
      name: 'connected-analyst-v1',
      partialize: (state) => ({
        rightPanelMode: state.rightPanelMode,
        graphFilter: state.graphFilter,
        activeLayers: state.activeLayers,
      }),
    }
  )
)
