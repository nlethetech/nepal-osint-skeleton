import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GraphNode, GraphEdge } from '../api/unifiedGraph'

// ============================================================================
// Types
// ============================================================================

export type CytoscapeElement =
  | { group: 'nodes'; data: Record<string, unknown> }
  | { group: 'edges'; data: Record<string, unknown> }

// ============================================================================
// Store interface
// ============================================================================

interface InvestigationState {
  pinnedNodeIds: string[]
  expandedNodeIds: string[]
  elements: CytoscapeElement[]
  selectedNodeId: string | null
  hoveredNodeId: string | null
  pathHighlight: string[] | null
  communitiesVisible: boolean

  // Actions
  addEntity: (node: GraphNode, neighbors: GraphNode[], edges: GraphEdge[]) => void
  addSyntheticNode: (nodeData: Record<string, unknown>) => void
  expandNode: (nodeId: string, neighbors: GraphNode[], edges: GraphEdge[]) => void
  removeNode: (nodeId: string) => void
  clearInvestigation: () => void
  setSelectedNode: (nodeId: string | null) => void
  setHoveredNode: (nodeId: string | null) => void
  setPathHighlight: (nodeIds: string[] | null) => void
  toggleCommunities: () => void
  addPathNodes: (nodes: GraphNode[], edges: GraphEdge[], pathNodeIds: string[]) => void
  replaceElements: (elements: CytoscapeElement[]) => void
}

// ============================================================================
// Helpers
// ============================================================================

function graphNodeToCytoscape(node: GraphNode): CytoscapeElement {
  const nodeType = node.data.node_type || node.data.type || 'unknown'
  return {
    group: 'nodes',
    data: {
      ...node.data,
      id: node.data.id,
      label: node.data.label,
      node_type: nodeType,
      type: nodeType,
      pagerank: node.data.pagerank ?? 0,
      degree: node.data.degree ?? 0,
      isHub: node.data.is_hub ?? false,
      isBridge: node.data.is_bridge ?? false,
      cluster_id: node.data.properties?.cluster_id ?? null,
    },
  }
}

function graphEdgeToCytoscape(edge: GraphEdge): CytoscapeElement {
  return {
    group: 'edges',
    data: {
      ...edge.data,
      id: edge.data.id,
      source: edge.data.source,
      target: edge.data.target,
      edgeType: edge.data.predicate,
      weight: edge.data.weight,
      label: edge.data.predicate?.replace(/_/g, ' ').toLowerCase(),
    },
  }
}

function dedupeElements(existing: CytoscapeElement[], incoming: CytoscapeElement[]): CytoscapeElement[] {
  const ids = new Set(existing.map((el) => el.data.id as string))
  const newElements = incoming.filter((el) => !ids.has(el.data.id as string))
  return [...existing, ...newElements]
}

// ============================================================================
// Store
// ============================================================================

export const useInvestigationStore = create<InvestigationState>()(
  persist(
    (set) => ({
      pinnedNodeIds: [],
      expandedNodeIds: [],
      elements: [],
      selectedNodeId: null,
      hoveredNodeId: null,
      pathHighlight: null,
      communitiesVisible: false,

      addEntity: (node, neighbors, edges) =>
        set((state) => {
          const nodeId = node.data.id
          if (state.pinnedNodeIds.includes(nodeId)) return state

          const newNodeElements = [node, ...neighbors].map(graphNodeToCytoscape)
          const newEdgeElements = edges.map(graphEdgeToCytoscape)
          const allNew = [...newNodeElements, ...newEdgeElements]

          // Mark the pinned node
          const pinnedEl = newNodeElements.find((el) => el.data.id === nodeId)
          if (pinnedEl) {
            (pinnedEl.data as Record<string, unknown>).isPinned = true
          }

          return {
            pinnedNodeIds: [...state.pinnedNodeIds, nodeId],
            elements: dedupeElements(state.elements, allNew),
          }
        }),

      addSyntheticNode: (nodeData) =>
        set((state) => {
          const nodeId = nodeData.id as string
          if (state.pinnedNodeIds.includes(nodeId)) return state

          const syntheticEl: CytoscapeElement = {
            group: 'nodes',
            data: {
              ...nodeData,
              id: nodeId,
              label: nodeData.label as string,
              type: nodeData.node_type as string,
              isPinned: true,
            },
          }

          return {
            pinnedNodeIds: [...state.pinnedNodeIds, nodeId],
            elements: dedupeElements(state.elements, [syntheticEl]),
          }
        }),

      expandNode: (nodeId, neighbors, edges) =>
        set((state) => {
          const newNodeElements = neighbors.map(graphNodeToCytoscape)
          const newEdgeElements = edges.map(graphEdgeToCytoscape)
          const allNew = [...newNodeElements, ...newEdgeElements]

          // Mark the expanded node
          const existingNode = state.elements.find(
            (el) => el.group === 'nodes' && el.data.id === nodeId,
          )
          let updatedElements = state.elements
          if (existingNode) {
            updatedElements = state.elements.map((el) =>
              el.data.id === nodeId
                ? { ...el, data: { ...el.data, isExpanded: true } }
                : el,
            )
          }

          return {
            expandedNodeIds: Array.from(new Set([...state.expandedNodeIds, nodeId])),
            elements: dedupeElements(updatedElements, allNew),
          }
        }),

      removeNode: (nodeId) =>
        set((state) => {
          const remainingNodes = state.elements.filter(
            (el) => !(el.group === 'nodes' && el.data.id === nodeId),
          )
          // Remove edges connected to this node
          const remainingElements = remainingNodes.filter((el) => {
            if (el.group === 'edges') {
              return el.data.source !== nodeId && el.data.target !== nodeId
            }
            return true
          })

          // Remove orphaned nodes (not pinned, not expanded, no edges)
          const nodeIds = new Set<string>()
          for (const el of remainingElements) {
            if (el.group === 'edges') {
              nodeIds.add(el.data.source as string)
              nodeIds.add(el.data.target as string)
            }
          }
          const finalElements = remainingElements.filter((el) => {
            if (el.group === 'nodes') {
              const nid = el.data.id as string
              const isPinned = state.pinnedNodeIds.includes(nid)
              return isPinned || nodeIds.has(nid)
            }
            return true
          })

          return {
            pinnedNodeIds: state.pinnedNodeIds.filter((id) => id !== nodeId),
            expandedNodeIds: state.expandedNodeIds.filter((id) => id !== nodeId),
            elements: finalElements,
            selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
          }
        }),

      clearInvestigation: () =>
        set({
          pinnedNodeIds: [],
          expandedNodeIds: [],
          elements: [],
          selectedNodeId: null,
          hoveredNodeId: null,
          pathHighlight: null,
        }),

      setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
      setHoveredNode: (nodeId) => set({ hoveredNodeId: nodeId }),
      setPathHighlight: (nodeIds) => set({ pathHighlight: nodeIds }),
      toggleCommunities: () =>
        set((state) => ({ communitiesVisible: !state.communitiesVisible })),

      addPathNodes: (nodes, edges, pathNodeIds) =>
        set((state) => {
          const newNodeElements = nodes.map(graphNodeToCytoscape)
          const newEdgeElements = edges.map(graphEdgeToCytoscape)
          const allNew = [...newNodeElements, ...newEdgeElements]

          return {
            elements: dedupeElements(state.elements, allNew),
            pathHighlight: pathNodeIds,
          }
        }),

      replaceElements: (elements) =>
        set({
          elements,
          pinnedNodeIds: [],
          expandedNodeIds: [],
          selectedNodeId: null,
          hoveredNodeId: null,
          pathHighlight: null,
        }),
    }),
    {
      name: 'investigation-v1',
      partialize: (state) => ({
        pinnedNodeIds: state.pinnedNodeIds,
        expandedNodeIds: state.expandedNodeIds,
        elements: state.elements,
      }),
    },
  ),
)
