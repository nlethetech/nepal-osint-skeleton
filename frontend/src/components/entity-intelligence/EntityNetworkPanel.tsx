import { useEffect, useRef, useState, useCallback } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import { ZoomIn, ZoomOut, Maximize2, RefreshCw, Filter, Download } from 'lucide-react'
import {
  getFullNetworkGraph,
  getEntityNetwork,
  triggerNetworkComputation,
  triggerRelationshipDiscovery,
  type NetworkGraph,
} from '../../api/entityIntelligence'

interface EntityNetworkPanelProps {
  entityId?: string // If provided, show ego network centered on entity
  window?: string
  minStrength?: number
  limitNodes?: number
  onNodeClick?: (nodeId: string) => void
  className?: string
}

// Cytoscape stylesheet
const CYTOSCAPE_STYLE = [
  {
    selector: 'node',
    style: {
      'background-color': '#4f46e5',
      label: 'data(label)',
      'font-size': '10px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 5,
      color: '#a1a1aa',
      width: 'mapData(pagerank, 0, 0.1, 20, 60)',
      height: 'mapData(pagerank, 0, 0.1, 20, 60)',
    },
  },
  {
    selector: 'node[type = "person"]',
    style: {
      'background-color': '#4f46e5',
    },
  },
  {
    selector: 'node[type = "party"]',
    style: {
      'background-color': '#22c55e',
      shape: 'hexagon',
    },
  },
  {
    selector: 'node[type = "organization"]',
    style: {
      'background-color': '#f97316',
      shape: 'rectangle',
    },
  },
  {
    selector: 'node[type = "institution"]',
    style: {
      'background-color': '#06b6d4',
      shape: 'diamond',
    },
  },
  {
    selector: 'node[?isHub]',
    style: {
      'border-width': 3,
      'border-color': '#a855f7',
    },
  },
  {
    selector: 'node[?isBridge]',
    style: {
      'border-width': 3,
      'border-color': '#06b6d4',
    },
  },
  {
    selector: 'node[?isCenter]',
    style: {
      'border-width': 4,
      'border-color': '#fbbf24',
      'background-color': '#fbbf24',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#ef4444',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 'mapData(weight, 0, 1, 1, 6)',
      'line-color': '#52525b',
      'curve-style': 'bezier',
      opacity: 0.6,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#ef4444',
      opacity: 1,
    },
  },
] as any

export function EntityNetworkPanel({
  entityId,
  window = '7d',
  minStrength = 0.1,
  limitNodes = 100,
  onNodeClick,
  className = '',
}: EntityNetworkPanelProps) {
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [graphData, setGraphData] = useState<NetworkGraph | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [isComputing, setIsComputing] = useState(false)
  const [filters, setFilters] = useState({
    window,
    minStrength,
    limitNodes,
  })

  useEffect(() => {
    loadGraph()
  }, [entityId, filters])

  const loadGraph = async () => {
    setIsLoading(true)
    setError(null)

    try {
      let data: NetworkGraph

      if (entityId) {
        data = await getEntityNetwork(entityId, {
          window: filters.window,
          minStrength: filters.minStrength,
          limit: filters.limitNodes,
        })
      } else {
        data = await getFullNetworkGraph({
          window: filters.window,
          minStrength: filters.minStrength,
          limitNodes: filters.limitNodes,
        })
      }

      setGraphData(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load network')
    } finally {
      setIsLoading(false)
    }
  }

  const handleComputeGraph = async () => {
    setIsComputing(true)
    setError(null)
    try {
      await triggerRelationshipDiscovery(720, 0.5)
      await triggerNetworkComputation(filters.window)
      await loadGraph()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to compute network')
    } finally {
      setIsComputing(false)
    }
  }

  const handleCyInit = useCallback((cy: cytoscape.Core) => {
    cyRef.current = cy

    // Run layout
    cy.layout({
      name: 'fcose',
      animate: true,
      randomize: true,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: 100,
      nodeRepulsion: 4500,
      gravity: 0.25,
    } as any).run()

    // Node click handler
    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      const nodeId = node.id()
      setSelectedNode(nodeId)
      onNodeClick?.(nodeId)
    })

    // Background click to deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null)
      }
    })
  }, [onNodeClick])

  const handleZoomIn = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * 1.2)
  }

  const handleZoomOut = () => {
    cyRef.current?.zoom(cyRef.current.zoom() / 1.2)
  }

  const handleFit = () => {
    cyRef.current?.fit(undefined, 50)
  }

  const handleExport = () => {
    if (!cyRef.current) return

    const png = cyRef.current.png({
      full: true,
      scale: 2,
      bg: '#18181b',
    })

    const link = document.createElement('a')
    link.href = png
    link.download = `entity-network-${filters.window}.png`
    link.click()
  }

  // Convert graph data to Cytoscape elements format
  const elements = graphData
    ? [
        ...graphData.elements.nodes,
        ...graphData.elements.edges,
      ]
    : []

  return (
    <div className={`flex flex-col h-full bg-[var(--pro-bg-base)] ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--pro-border-subtle)]">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-[var(--pro-text-primary)]">
            Entity Network
          </h3>
          {graphData?.stats && (
            <span className="text-[10px] text-[var(--pro-text-muted)]">
              {graphData.stats.nodeCount} nodes · {graphData.stats.edgeCount} edges
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded transition-colors ${
              showFilters
                ? 'bg-[var(--pro-accent)] text-white'
                : 'text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)]'
            }`}
            title="Filters"
          >
            <Filter size={12} />
          </button>
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={12} />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={12} />
          </button>
          <button
            onClick={handleFit}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            title="Fit to view"
          >
            <Maximize2 size={12} />
          </button>
          <button
            onClick={handleExport}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            title="Export PNG"
          >
            <Download size={12} />
          </button>
          <button
            onClick={loadGraph}
            disabled={isLoading}
            className="p-1.5 text-[var(--pro-text-muted)] hover:text-[var(--pro-text-secondary)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="flex items-center gap-4 px-3 py-2 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-bg-secondary)]">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-[var(--pro-text-muted)]">Window:</label>
            <select
              value={filters.window}
              onChange={(e) => setFilters((f) => ({ ...f, window: e.target.value }))}
              className="text-[10px] bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded px-2 py-1 text-[var(--pro-text-secondary)]"
            >
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-[var(--pro-text-muted)]">Min Strength:</label>
            <input
              type="range"
              min="0"
              max="0.5"
              step="0.05"
              value={filters.minStrength}
              onChange={(e) => setFilters((f) => ({ ...f, minStrength: parseFloat(e.target.value) }))}
              className="w-20"
            />
            <span className="text-[10px] text-[var(--pro-text-secondary)] w-8">
              {filters.minStrength.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-[var(--pro-text-muted)]">Max Nodes:</label>
            <input
              type="number"
              min="10"
              max="500"
              value={filters.limitNodes}
              onChange={(e) => setFilters((f) => ({ ...f, limitNodes: parseInt(e.target.value) || 100 }))}
              className="w-16 text-[10px] bg-[var(--pro-bg-elevated)] border border-[var(--pro-border-subtle)] rounded px-2 py-1 text-[var(--pro-text-secondary)]"
            />
          </div>
        </div>
      )}

      {/* Graph Container */}
      <div className="flex-1 min-h-0 relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw size={24} className="text-[var(--pro-accent)] animate-spin" />
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-red-400 mb-2">{error}</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={loadGraph}
                  className="text-xs text-[var(--pro-accent)] hover:underline"
                >
                  Try again
                </button>
                <button
                  onClick={handleComputeGraph}
                  disabled={isComputing}
                  className="text-xs text-blue-300 hover:underline disabled:opacity-50"
                >
                  {isComputing ? 'Computing…' : 'Compute graph'}
                </button>
              </div>
            </div>
          </div>
        ) : elements.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-[var(--pro-text-muted)] mb-2">No network data available</p>
              <button
                onClick={handleComputeGraph}
                disabled={isComputing}
                className="text-xs px-3 py-1.5 rounded bg-blue-500/15 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 transition-colors disabled:opacity-50"
              >
                {isComputing ? 'Computing…' : 'Compute graph'}
              </button>
              <div className="text-[10px] text-[var(--pro-text-disabled)] mt-2">
                Builds co-mention relationships and computes centrality metrics for the selected window.
              </div>
            </div>
          </div>
        ) : (
          <CytoscapeComponent
            elements={elements}
            stylesheet={CYTOSCAPE_STYLE}
            style={{ width: '100%', height: '100%' }}
            cy={handleCyInit}
            wheelSensitivity={0.2}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-t border-[var(--pro-border-subtle)] text-[9px]">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          <span className="text-[var(--pro-text-muted)]">Person</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500" style={{ clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' }} />
          <span className="text-[var(--pro-text-muted)]">Party</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-orange-500" />
          <span className="text-[var(--pro-text-muted)]">Org</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-cyan-500 rotate-45" />
          <span className="text-[var(--pro-text-muted)]">Institution</span>
        </div>
        <div className="w-px h-3 bg-[var(--pro-border-subtle)]" />
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border-2 border-purple-500" />
          <span className="text-[var(--pro-text-muted)]">Hub</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border-2 border-cyan-500" />
          <span className="text-[var(--pro-text-muted)]">Bridge</span>
        </div>
      </div>
    </div>
  )
}
