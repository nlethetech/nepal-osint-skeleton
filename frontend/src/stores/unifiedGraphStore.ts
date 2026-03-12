import { create } from 'zustand'
import type { GraphNode, GraphEdge } from '../api/unifiedGraph'

// ============================================================================
// Types
// ============================================================================

export type GraphView = 'overview' | 'neighborhood' | 'path' | 'search'

interface PathMode {
  from: string | null
  to: string | null
}

interface UnifiedGraphState {
  // Graph elements
  nodes: GraphNode[]
  edges: GraphEdge[]

  // Metadata
  totalGraphNodes: number
  totalGraphEdges: number

  // Expansion tracking
  expandedNodes: Set<string>

  // Selection
  selectedNodeId: string | null
  hoveredNodeId: string | null
  pathMode: PathMode | null
  pathHighlightIds: string[]

  // Filters
  visibleNodeTypes: string[]
  visiblePredicates: string[]
  minConfidence: number
  searchQuery: string
  hideOrphans: boolean

  // View
  currentView: GraphView
  zoomLevel: number
  sidebarOpen: boolean

  // Actions
  setNodes: (nodes: GraphNode[]) => void
  setEdges: (edges: GraphEdge[]) => void
  addNodes: (nodes: GraphNode[]) => void
  addEdges: (edges: GraphEdge[]) => void
  removeNodesByParent: (parentId: string) => void
  setTotalCounts: (nodes: number, edges: number) => void
  selectNode: (id: string | null) => void
  hoverNode: (id: string | null) => void
  markExpanded: (id: string) => void
  collapseNode: (id: string) => void
  toggleNodeType: (type: string) => void
  togglePredicate: (predicate: string) => void
  setMinConfidence: (val: number) => void
  setSearchQuery: (q: string) => void
  setHideOrphans: (val: boolean) => void
  setCurrentView: (view: GraphView) => void
  setZoomLevel: (z: number) => void
  setSidebarOpen: (open: boolean) => void
  startPathMode: (fromId: string) => void
  setPathTarget: (toId: string) => void
  setPathHighlight: (ids: string[]) => void
  endPathMode: () => void
  reset: () => void
}

// ============================================================================
// Helpers
// ============================================================================

/** Merge new nodes into existing, deduplicating by ID */
function mergeNodes(existing: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const map = new Map<string, GraphNode>()
  for (const n of existing) {
    map.set(n.data.id, n)
  }
  for (const n of incoming) {
    map.set(n.data.id, n)
  }
  return Array.from(map.values())
}

/** Merge new edges into existing, deduplicating by ID */
function mergeEdges(existing: GraphEdge[], incoming: GraphEdge[]): GraphEdge[] {
  const map = new Map<string, GraphEdge>()
  for (const e of existing) {
    map.set(e.data.id, e)
  }
  for (const e of incoming) {
    map.set(e.data.id, e)
  }
  return Array.from(map.values())
}

// ============================================================================
// Initial state
// ============================================================================

const ALL_NODE_TYPES = [
  'person',
  'organization',
  'place',
  'event',
  'story',
  'commodity',
  'country',
  'document',
  'cluster',
  'assessment',
  'case',
  'hypothesis',
]

const ALL_PREDICATES = [
  'located_in',
  'parent_of',
  'within',
  'director_of',
  'registered_in',
  'shares_phone_with',
  'shares_address_with',
  'member_of',
  'elected_from',
  'minister_of',
  'candidate_in',
  'mentioned_in',
  'co_mentioned_with',
  'imports_from',
  'exports_to',
  'trades_commodity',
  'trades_through',
  'occurred_in',
  'affected_by',
  'won_contract',
  'sponsored_bill',
  'story_in_cluster',
  'about_event',
  'evidence_for',
  'hypothesis_about',
  'case_involves',
]

// ============================================================================
// Store
// ============================================================================

export const useUnifiedGraphStore = create<UnifiedGraphState>()((set, get) => ({
  // State
  nodes: [],
  edges: [],
  totalGraphNodes: 0,
  totalGraphEdges: 0,
  expandedNodes: new Set<string>(),
  selectedNodeId: null,
  hoveredNodeId: null,
  pathMode: null,
  pathHighlightIds: [],
  visibleNodeTypes: [...ALL_NODE_TYPES],
  visiblePredicates: [...ALL_PREDICATES],
  minConfidence: 0,
  searchQuery: '',
  hideOrphans: false,
  currentView: 'overview',
  zoomLevel: 1,
  sidebarOpen: false,

  // Actions
  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),

  addNodes: (incoming) =>
    set((state) => ({
      nodes: mergeNodes(state.nodes, incoming),
    })),

  addEdges: (incoming) =>
    set((state) => ({
      edges: mergeEdges(state.edges, incoming),
    })),

  removeNodesByParent: (parentId) =>
    set((state) => {
      const childIds = new Set<string>()
      for (const n of state.nodes) {
        if (n.data.parent === parentId) {
          childIds.add(n.data.id)
        }
      }
      if (childIds.size === 0) return state
      return {
        nodes: state.nodes.filter((n) => !childIds.has(n.data.id)),
        edges: state.edges.filter(
          (e) => !childIds.has(e.data.source) && !childIds.has(e.data.target)
        ),
      }
    }),

  setTotalCounts: (totalGraphNodes, totalGraphEdges) =>
    set({ totalGraphNodes, totalGraphEdges }),

  selectNode: (id) =>
    set({
      selectedNodeId: id,
      sidebarOpen: id !== null,
    }),

  hoverNode: (id) => set({ hoveredNodeId: id }),

  markExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedNodes)
      next.add(id)
      return { expandedNodes: next }
    }),

  collapseNode: (id) =>
    set((state) => {
      const next = new Set(state.expandedNodes)
      next.delete(id)
      // Remove children that were loaded for this node
      const childIds = new Set<string>()
      for (const n of state.nodes) {
        if (n.data.parent === id) {
          childIds.add(n.data.id)
        }
      }
      return {
        expandedNodes: next,
        nodes: childIds.size > 0
          ? state.nodes.filter((n) => !childIds.has(n.data.id))
          : state.nodes,
        edges: childIds.size > 0
          ? state.edges.filter(
              (e) => !childIds.has(e.data.source) && !childIds.has(e.data.target)
            )
          : state.edges,
      }
    }),

  toggleNodeType: (type) =>
    set((state) => {
      const current = state.visibleNodeTypes
      const next = current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type]
      return { visibleNodeTypes: next }
    }),

  togglePredicate: (predicate) =>
    set((state) => {
      const current = state.visiblePredicates
      const next = current.includes(predicate)
        ? current.filter((p) => p !== predicate)
        : [...current, predicate]
      return { visiblePredicates: next }
    }),

  setMinConfidence: (val) => set({ minConfidence: val }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setHideOrphans: (val) => set({ hideOrphans: val }),

  setCurrentView: (view) => set({ currentView: view }),

  setZoomLevel: (z) => set({ zoomLevel: z }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  startPathMode: (fromId) =>
    set({
      pathMode: { from: fromId, to: null },
      pathHighlightIds: [],
    }),

  setPathTarget: (toId) =>
    set((state) => {
      if (!state.pathMode) return state
      return {
        pathMode: { ...state.pathMode, to: toId },
      }
    }),

  setPathHighlight: (ids) => set({ pathHighlightIds: ids }),

  endPathMode: () =>
    set({
      pathMode: null,
      pathHighlightIds: [],
    }),

  reset: () =>
    set({
      nodes: [],
      edges: [],
      totalGraphNodes: 0,
      totalGraphEdges: 0,
      expandedNodes: new Set<string>(),
      selectedNodeId: null,
      hoveredNodeId: null,
      pathMode: null,
      pathHighlightIds: [],
      visibleNodeTypes: [...ALL_NODE_TYPES],
      visiblePredicates: [...ALL_PREDICATES],
      minConfidence: 0,
      searchQuery: '',
      hideOrphans: false,
      currentView: 'overview',
      zoomLevel: 1,
      sidebarOpen: false,
    }),
}))
