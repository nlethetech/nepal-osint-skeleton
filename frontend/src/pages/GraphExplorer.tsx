import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useGraphStore } from '../store/slices/graphSlice'
import { listKBEntities, searchKBEntities, getKBEntity } from '../api/kbEntities'
import { CytoscapeGraph } from '../components/graph/CytoscapeGraph'
import { NodeDetailPanel } from '../components/graph/NodeDetailPanel'
import { GraphFilterPanel } from '../components/graph/GraphFilterPanel'
import { GraphToolbar } from '../components/graph/GraphToolbar'
import { GraphLegend } from '../components/graph/GraphLegend'
import { EmptyState } from '../components/common/EmptyState'
import type { GraphNode } from '../types/api'

export default function GraphExplorer() {
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')

  const {
    nodes,
    edges,
    selectedNode,
    centralityScores,
    visibleNodeTypes,
    minConfidence,
    maxNeighbors,
    classifiedOnly,
    loading,
    stats,
    setSelectedNode,
    setHoveredNode,
    fetchSubgraph,
    expandNode,
    fetchCentrality,
    fetchStats,
    toggleNodeType,
    setMinConfidence,
    setMaxNeighbors,
    setClassifiedOnly,
    clearGraph,
  } = useGraphStore()

  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [currentLayout, setCurrentLayout] = useState('fcose')
  const [searchResults, setSearchResults] = useState<GraphNode[]>([])
  const graphRef = useRef<HTMLDivElement>(null)
  const initialLoadRef = useRef(false)
  const lastFocusRef = useRef<string | null>(null)

  // Initial data load - auto-load a manageable PERSON entity (not the highly connected locations)
  useEffect(() => {
    if (initialLoadRef.current) return
    initialLoadRef.current = true

    const initializeGraph = async () => {
      await fetchStats()
      await fetchCentrality()

      // If a focus node is provided, prioritize loading it
      if (focusId) {
        await fetchSubgraph(focusId, { depth: 1 })
        const { nodes: currentNodes, addNodes, setSelectedNode: setSelected } = useGraphStore.getState()
        const focusNode = currentNodes.find((n) => n.id === focusId) || null
        if (focusNode) {
          setSelected(focusNode)
          return
        }
        // Neo4j might not have this node yet; try to fetch from KB and show it standalone
        try {
          const kb = await getKBEntity(focusId)
          const fallbackNode: GraphNode = {
            id: kb.id,
            label: kb.canonical_name,
            type: kb.entity_type,
            properties: { label_ne: kb.canonical_name_ne, mentions: kb.total_mentions },
          }
          addNodes([fallbackNode], [])
          setSelected(fallbackNode)
        } catch {
          // Ignore if not a KB entity (e.g., Document/Event IDs)
        }
        return
      }

      // Use centrality scores (from Neo4j) to pick a node guaranteed to exist
      const { centralityScores: scores } = useGraphStore.getState()
      if (scores.size > 0) {
        let bestId = ''
        let bestScore = -1
        scores.forEach((score, id) => {
          if (score > bestScore) {
            bestScore = score
            bestId = id
          }
        })
        if (bestId) {
          await fetchSubgraph(bestId, { depth: 1 })
          return
        }
      }

      // Fallback: fetch from PostgreSQL KB entities
      try {
        const response = await listKBEntities({ entity_type: 'PERSON', limit: 1 })
        if (response.entities.length > 0) {
          const topPerson = response.entities[0]
          await fetchSubgraph(topPerson.id, { depth: 1 })
        }
      } catch (error) {
        console.error('Failed to auto-load graph:', error)
      }
    }
    initializeGraph()
  }, [fetchStats, fetchCentrality, fetchSubgraph, focusId])

  // React to focus parameter changes (e.g., navigating from a dossier)
  useEffect(() => {
    if (!focusId) return
    if (lastFocusRef.current === focusId) return
    lastFocusRef.current = focusId

    const run = async () => {
      await fetchSubgraph(focusId, { depth: 1 })
      const { nodes: currentNodes, addNodes, setSelectedNode: setSelected } = useGraphStore.getState()
      const focusNode = currentNodes.find((n) => n.id === focusId) || null
      if (focusNode) {
        setSelected(focusNode)
        return
      }
      try {
        const kb = await getKBEntity(focusId)
        const fallbackNode: GraphNode = {
          id: kb.id,
          label: kb.canonical_name,
          type: kb.entity_type,
          properties: { label_ne: kb.canonical_name_ne, mentions: kb.total_mentions },
        }
        addNodes([fallbackNode], [])
        setSelected(fallbackNode)
      } catch {
        // Ignore if not a KB entity
      }
    }

    run().catch((e) => console.error('Failed to focus graph node:', e))
  }, [focusId, fetchSubgraph])

  // Calculate node type counts
  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    nodes.forEach(node => {
      counts[node.type] = (counts[node.type] || 0) + 1
    })
    return counts
  }, [nodes])

  // Get connected nodes for selected node
  const connectedNodes = useMemo(() => {
    if (!selectedNode) return []
    const connectedIds = new Set<string>()
    edges.forEach(edge => {
      if (edge.source === selectedNode.id) connectedIds.add(edge.target)
      if (edge.target === selectedNode.id) connectedIds.add(edge.source)
    })
    return nodes.filter(n => connectedIds.has(n.id))
  }, [selectedNode, nodes, edges])

  // Connection count for selected node
  const connectionCount = useMemo(() => {
    if (!selectedNode) return 0
    return edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).length
  }, [selectedNode, edges])

  // Search handler
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    try {
      const entities = await searchKBEntities(query, undefined, 10)
      // Convert KB entities to GraphNode format
      const results: GraphNode[] = entities.map(entity => ({
        id: entity.id,
        label: entity.canonical_name,
        type: entity.entity_type as GraphNode['type'],
        properties: {
          label_ne: entity.canonical_name_ne,
          mentions: entity.total_mentions,
        },
      }))
      setSearchResults(results)
    } catch (error) {
      console.error('Search failed:', error)
    }
  }, [])

  // Handle search result click - fetch subgraph for that node
  // Use depth=1 and limited neighbors to avoid hairball effect
  const handleSearchResultClick = useCallback(async (node: GraphNode) => {
    await fetchSubgraph(node.id, { depth: 1 })
    // If subgraph returned empty (node not in Neo4j), add the node manually
    // so the graph canvas shows something rather than "No Graph Data"
    const { nodes: currentNodes, addNodes } = useGraphStore.getState()
    if (currentNodes.length === 0) {
      addNodes([node], [])
    }
    setSelectedNode(node)
  }, [fetchSubgraph, setSelectedNode])

  // Handle node click in graph
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
  }, [setSelectedNode])

  // Handle node double-click - expand
  const handleNodeDoubleClick = useCallback(async (node: GraphNode) => {
    await expandNode(node.id)
  }, [expandNode])

  // Handle background click
  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null)
  }, [setSelectedNode])

  // Zoom controls via cytoscape methods
  const handleZoomIn = useCallback(() => {
    const container = graphRef.current
    if (container && (container as any).cyMethods) {
      (container as any).cyMethods.zoomIn()
    }
  }, [])

  const handleZoomOut = useCallback(() => {
    const container = graphRef.current
    if (container && (container as any).cyMethods) {
      (container as any).cyMethods.zoomOut()
    }
  }, [])

  const handleFitToView = useCallback(() => {
    const container = graphRef.current
    if (container && (container as any).cyMethods) {
      (container as any).cyMethods.fitToView()
    }
  }, [])

  const handleLayoutChange = useCallback((layout: string) => {
    setCurrentLayout(layout)
    const container = graphRef.current
    if (container && (container as any).cyMethods) {
      (container as any).cyMethods.runLayout(layout)
    }
  }, [])

  const handleResetGraph = useCallback(() => {
    clearGraph()
    setSelectedNode(null)
  }, [clearGraph, setSelectedNode])

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <GraphToolbar
        onSearch={handleSearch}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToView={handleFitToView}
        onResetGraph={handleResetGraph}
        onLayoutChange={handleLayoutChange}
        searchResults={searchResults}
        onSearchResultClick={handleSearchResultClick}
        loading={loading}
        currentLayout={currentLayout}
        stats={stats || undefined}
      />

      {/* Graph Canvas */}
      <div className="flex-1 relative overflow-hidden">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-osint-card border border-osint-border rounded-xl m-4">
            <EmptyState
              title="No Graph Data"
              description="Search for an entity above to explore its relationship network"
            />
          </div>
        ) : (
          <div ref={graphRef} className="absolute inset-0 m-4 rounded-xl overflow-hidden border border-osint-border">
            <CytoscapeGraph
              nodes={nodes}
              edges={edges}
              centralityScores={centralityScores}
              visibleNodeTypes={visibleNodeTypes}
              minConfidence={minConfidence}
              selectedNodeId={selectedNode?.id}
              layout={currentLayout}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
              onNodeHover={setHoveredNode}
              onBackgroundClick={handleBackgroundClick}
            />
          </div>
        )}

        {/* Filter Panel */}
        <GraphFilterPanel
          visibleNodeTypes={visibleNodeTypes}
          minConfidence={minConfidence}
          maxNeighbors={maxNeighbors}
          classifiedOnly={classifiedOnly}
          nodeTypeCounts={nodeTypeCounts}
          onToggleType={toggleNodeType}
          onConfidenceChange={setMinConfidence}
          onMaxNeighborsChange={setMaxNeighbors}
          onClassifiedOnlyChange={setClassifiedOnly}
          isOpen={filterPanelOpen}
          onToggle={() => setFilterPanelOpen(!filterPanelOpen)}
        />

        {/* Legend */}
        {nodes.length > 0 && <GraphLegend showCentrality={centralityScores.size > 0} />}

        {/* Node Detail Panel */}
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={expandNode}
          connectedNodes={connectedNodes}
          connectionCount={connectionCount}
        />
      </div>
    </div>
  )
}
