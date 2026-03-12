import { create } from 'zustand'
import { getSubgraph, getCentrality, getGraphStats, type SubgraphOptions } from '../../api/graph'
import type { GraphNode, GraphEdge } from '../../types/api'

interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNode: GraphNode | null
  hoveredNode: GraphNode | null
  centralityScores: Map<string, number>
  loading: boolean
  error: string | null
  stats: {
    nodeCount: number
    edgeCount: number
  } | null

  // Filters
  visibleNodeTypes: Set<string>
  minConfidence: number
  maxNeighbors: number
  classifiedOnly: boolean

  // Actions
  setSelectedNode: (node: GraphNode | null) => void
  setHoveredNode: (node: GraphNode | null) => void
  fetchSubgraph: (nodeId: string, options?: SubgraphOptions) => Promise<void>
  expandNode: (nodeId: string) => Promise<void>
  fetchCentrality: () => Promise<void>
  fetchStats: () => Promise<void>
  toggleNodeType: (type: string) => void
  setMinConfidence: (confidence: number) => void
  setMaxNeighbors: (max: number) => void
  setClassifiedOnly: (value: boolean) => void
  clearGraph: () => void
  addNodes: (nodes: GraphNode[], edges: GraphEdge[]) => void
}

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  hoveredNode: null,
  centralityScores: new Map(),
  loading: false,
  error: null,
  stats: null,
  visibleNodeTypes: new Set(['PERSON', 'ORGANIZATION', 'ORG', 'LOCATION', 'DISTRICT', 'EVENT', 'Document', 'Entity', 'PARTY', 'CONSTITUENCY']),
  minConfidence: 0,
  maxNeighbors: 100,  // Limit to prevent hairball graphs
  classifiedOnly: false,  // Show classified relationships by default

  setSelectedNode: (node) => set({ selectedNode: node }),
  setHoveredNode: (node) => set({ hoveredNode: node }),

  fetchSubgraph: async (nodeId, options = {}) => {
    const { maxNeighbors, classifiedOnly } = get()
    set({ loading: true, error: null })
    try {
      const data = await getSubgraph(nodeId, {
        depth: options.depth ?? 1,
        maxNeighbors: options.maxNeighbors ?? maxNeighbors,
        classifiedOnly: options.classifiedOnly ?? classifiedOnly,
      })
      set({
        nodes: data.nodes,
        edges: data.edges,
        loading: false,
      })
    } catch (err) {
      set({ error: 'Failed to load graph data', loading: false })
      console.error(err)
    }
  },

  expandNode: async (nodeId) => {
    const { nodes, edges, maxNeighbors, classifiedOnly } = get()
    set({ loading: true, error: null })
    try {
      const data = await getSubgraph(nodeId, {
        depth: 1,
        maxNeighbors: Math.min(maxNeighbors, 50),  // Smaller limit when expanding
        classifiedOnly,
      })

      // Merge new nodes (avoid duplicates)
      const existingNodeIds = new Set(nodes.map(n => n.id))
      const newNodes = data.nodes.filter(n => !existingNodeIds.has(n.id))

      // Merge new edges (avoid duplicates)
      const existingEdgeKeys = new Set(edges.map(e => `${e.source}-${e.target}`))
      const newEdges = data.edges.filter(e => !existingEdgeKeys.has(`${e.source}-${e.target}`))

      set({
        nodes: [...nodes, ...newNodes],
        edges: [...edges, ...newEdges],
        loading: false,
      })
    } catch (err) {
      set({ error: 'Failed to expand node', loading: false })
      console.error(err)
    }
  },

  fetchCentrality: async () => {
    try {
      const data = await getCentrality(undefined, 100)
      const scores = new Map<string, number>()
      data.forEach(item => {
        scores.set(item.id, item.score)
      })
      set({ centralityScores: scores })
    } catch (err) {
      console.error('Failed to fetch centrality:', err)
    }
  },

  fetchStats: async () => {
    try {
      const data = await getGraphStats()
      set({
        stats: {
          nodeCount: data.node_count,
          edgeCount: data.edge_count,
        },
      })
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  },

  toggleNodeType: (type) => {
    const { visibleNodeTypes } = get()
    const newTypes = new Set(visibleNodeTypes)
    if (newTypes.has(type)) {
      newTypes.delete(type)
    } else {
      newTypes.add(type)
    }
    set({ visibleNodeTypes: newTypes })
  },

  setMinConfidence: (confidence) => set({ minConfidence: confidence }),
  setMaxNeighbors: (max) => set({ maxNeighbors: max }),
  setClassifiedOnly: (value) => set({ classifiedOnly: value }),

  clearGraph: () => set({
    nodes: [],
    edges: [],
    selectedNode: null,
    hoveredNode: null,
  }),

  addNodes: (newNodes, newEdges) => {
    const { nodes, edges } = get()
    const existingNodeIds = new Set(nodes.map(n => n.id))
    const existingEdgeKeys = new Set(edges.map(e => `${e.source}-${e.target}`))

    set({
      nodes: [...nodes, ...newNodes.filter(n => !existingNodeIds.has(n.id))],
      edges: [...edges, ...newEdges.filter(e => !existingEdgeKeys.has(`${e.source}-${e.target}`))],
    })
  },
}))
