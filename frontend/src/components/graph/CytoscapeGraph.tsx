import { useEffect, useRef, useCallback, useMemo } from 'react'
import cytoscape, { Core, NodeSingular, LayoutOptions } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import cola from 'cytoscape-cola'
import type { GraphNode, GraphEdge } from '../../types/api'

// Register layout extensions
cytoscape.use(fcose)
cytoscape.use(cola)

// Entity type colors matching tailwind config
const NODE_COLORS: Record<string, string> = {
  PERSON: '#ef4444',
  ORGANIZATION: '#eab308',
  ORG: '#eab308',              // Same as ORGANIZATION
  LOCATION: '#22c55e',
  DISTRICT: '#14b8a6',
  CONSTITUENCY: '#14b8a6',  // Same as DISTRICT (constituencies are district-level)
  PARTY: '#a855f7',         // Purple for political parties
  EVENT: '#f97316',
  Document: '#6366f1',  // Indigo for documents/stories
  Entity: '#8b5cf6',    // Purple for generic entities
}

// Edge colors by type - Palantir-grade relationship intelligence
const EDGE_COLORS: Record<string, string> = {
  // Document-entity relationships
  MENTIONS: '#94a3b8',        // Slate (subdued for doc links)

  // Unclassified entity-entity co-occurrence
  CO_OCCURS_WITH: '#f59e0b',  // Amber for unclassified

  // Classified relationship types (Palantir-grade)
  MEMBER_OF: '#8b5cf6',       // Purple for membership
  LEADS: '#ef4444',           // Red for leadership
  AFFILIATED_WITH: '#ec4899', // Pink for affiliation
  ALLIED_WITH: '#22c55e',     // Green for alliance
  OPPOSES: '#f97316',         // Orange for opposition
  WORKS_FOR: '#3b82f6',       // Blue for employment
  COLLEAGUE_OF: '#06b6d4',    // Cyan for colleagues
  LOCATED_IN: '#14b8a6',      // Teal for location
  FAMILY_OF: '#d946ef',       // Fuchsia for family
  RELATED_TO: '#6b7280',      // Gray for general/fallback

  // Election intelligence relationships
  RUNNING_IN: '#14b8a6',          // Teal (constituency)
  COMPETED_AGAINST: '#dc2626',    // Dark red for opponents
  SAME_PARTY_DISTRICT: '#7c3aed', // Violet for party allies
  SWITCHED_PARTY: '#f59e0b',      // Amber for party switches

  DEFAULT: '#6b7280',         // Gray for unknown
}

// Human-readable labels for relationship types
const EDGE_LABELS: Record<string, string> = {
  MEMBER_OF: 'Member',
  LEADS: 'Leads',
  AFFILIATED_WITH: 'Affiliated',
  ALLIED_WITH: 'Allied',
  OPPOSES: 'Opposes',
  WORKS_FOR: 'Works For',
  COLLEAGUE_OF: 'Colleague',
  LOCATED_IN: 'Located',
  FAMILY_OF: 'Family',
  RELATED_TO: 'Related',
  RUNNING_IN: 'Ran In',
  COMPETED_AGAINST: 'Opponent',
  SAME_PARTY_DISTRICT: 'Ally',
  SWITCHED_PARTY: 'Switched',
  CO_OCCURS_WITH: '',  // No label for unclassified
  MENTIONS: '',  // No label for document links
}
const EDGE_COLOR_HOVER = '#60a5fa'
const BACKGROUND_COLOR = '#0d0d12'

// Layout configurations for different scenarios
const LAYOUT_CONFIGS: Record<string, LayoutOptions> = {
  fcose: {
    name: 'fcose',
    quality: 'proof',
    randomize: true,
    animate: true,
    animationDuration: 500,
    fit: true,
    padding: 50,
    nodeDimensionsIncludeLabels: true,
    // Separation forces
    nodeRepulsion: () => 15000,
    idealEdgeLength: () => 150,
    edgeElasticity: () => 0.45,
    // Nesting
    nestingFactor: 0.1,
    // Gravity
    gravity: 0.4,
    gravityRange: 3.8,
    gravityCompound: 1.0,
    gravityRangeCompound: 1.5,
    // Initial layout
    numIter: 2500,
    tile: true,
    tilingPaddingVertical: 30,
    tilingPaddingHorizontal: 30,
  } as LayoutOptions,

  cola: {
    name: 'cola',
    animate: true,
    refresh: 1,
    maxSimulationTime: 4000,
    ungrabifyWhileSimulating: false,
    fit: true,
    padding: 50,
    nodeDimensionsIncludeLabels: true,
    // Forces
    nodeSpacing: () => 80,
    edgeLength: undefined,
    edgeSymDiffLength: undefined,
    edgeJaccardLength: undefined,
    // Constraints
    avoidOverlap: true,
    handleDisconnected: true,
    convergenceThreshold: 0.01,
    flow: undefined,
    alignment: undefined,
    gapInequalities: undefined,
  } as LayoutOptions,

  concentric: {
    name: 'concentric',
    fit: true,
    padding: 50,
    animate: true,
    animationDuration: 500,
    startAngle: (3 / 2) * Math.PI,
    sweep: undefined,
    clockwise: true,
    equidistant: false,
    minNodeSpacing: 60,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    concentric: (node: NodeSingular) => {
      // Place by degree centrality - more connections = center
      return node.degree(false)
    },
    levelWidth: () => 2,
  } as LayoutOptions,

  circle: {
    name: 'circle',
    fit: true,
    padding: 50,
    animate: true,
    animationDuration: 500,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    startAngle: (3 / 2) * Math.PI,
    sweep: undefined,
    clockwise: true,
    sort: (a: NodeSingular, b: NodeSingular) => {
      // Sort by type then by degree
      const typeOrder: Record<string, number> = { PERSON: 0, ORGANIZATION: 1, LOCATION: 2, DISTRICT: 3, EVENT: 4 }
      const typeA = typeOrder[a.data('type')] || 5
      const typeB = typeOrder[b.data('type')] || 5
      if (typeA !== typeB) return typeA - typeB
      return b.degree(false) - a.degree(false)
    },
  } as LayoutOptions,

  grid: {
    name: 'grid',
    fit: true,
    padding: 50,
    animate: true,
    animationDuration: 500,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    condense: false,
    rows: undefined,
    cols: undefined,
    sort: (a: NodeSingular, b: NodeSingular) => {
      // Group by type
      const typeOrder: Record<string, number> = { PERSON: 0, ORGANIZATION: 1, LOCATION: 2, DISTRICT: 3, EVENT: 4 }
      const typeA = typeOrder[a.data('type')] || 5
      const typeB = typeOrder[b.data('type')] || 5
      return typeA - typeB
    },
  } as LayoutOptions,

  cose: {
    name: 'cose',
    animate: true,
    animationDuration: 500,
    fit: true,
    padding: 50,
    nodeDimensionsIncludeLabels: true,
    randomize: true,
    componentSpacing: 150,
    nodeRepulsion: () => 10000,
    idealEdgeLength: () => 120,
    edgeElasticity: () => 100,
    gravity: 0.3,
    numIter: 200,
  } as LayoutOptions,
}

interface CytoscapeGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  centralityScores?: Map<string, number>
  visibleNodeTypes: Set<string>
  minConfidence: number
  selectedNodeId?: string | null
  layout?: string
  onNodeClick: (node: GraphNode) => void
  onNodeDoubleClick: (node: GraphNode) => void
  onNodeHover: (node: GraphNode | null) => void
  onBackgroundClick: () => void
}

export function CytoscapeGraph({
  nodes,
  edges,
  centralityScores,
  visibleNodeTypes,
  minConfidence,
  selectedNodeId,
  layout = 'fcose',
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  onBackgroundClick,
}: CytoscapeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<string>(layout)

  // Filter nodes and edges based on visibility settings
  const filteredNodes = useMemo(() => {
    return nodes.filter(n => visibleNodeTypes.has(n.type))
  }, [nodes, visibleNodeTypes])

  const filteredNodeIds = useMemo(() => {
    return new Set(filteredNodes.map(n => n.id))
  }, [filteredNodes])

  const filteredEdges = useMemo(() => {
    return edges.filter(
      e => filteredNodeIds.has(e.source) &&
           filteredNodeIds.has(e.target) &&
           e.confidence >= minConfidence
    )
  }, [edges, filteredNodeIds, minConfidence])

  // Calculate node degrees for hub detection
  const nodeDegrees = useMemo(() => {
    const degrees = new Map<string, number>()
    filteredEdges.forEach(edge => {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1)
    })
    return degrees
  }, [filteredEdges])

  // Identify hub nodes (nodes with very high connectivity)
  const hubNodes = useMemo(() => {
    const threshold = Math.max(50, filteredNodes.length * 0.1) // Top 10% or 50+ connections
    const hubs = new Set<string>()
    nodeDegrees.forEach((degree, nodeId) => {
      if (degree >= threshold) {
        hubs.add(nodeId)
      }
    })
    return hubs
  }, [nodeDegrees, filteredNodes.length])

  // Calculate node size based on centrality and degree
  const getNodeSize = useCallback((nodeId: string): number => {
    const baseSize = 25
    const maxSize = 70

    // Use degree as primary sizing metric
    const degree = nodeDegrees.get(nodeId) || 0
    const maxDegree = Math.max(...Array.from(nodeDegrees.values()), 1)

    // If we have centrality scores, blend them
    let score = degree / maxDegree
    if (centralityScores && centralityScores.has(nodeId)) {
      const centralityScore = centralityScores.get(nodeId) || 0
      const maxCentrality = Math.max(...Array.from(centralityScores.values()), 0.001)
      const normalizedCentrality = centralityScore / maxCentrality
      score = (score + normalizedCentrality) / 2
    }

    return baseSize + (maxSize - baseSize) * Math.pow(score, 0.6) // Power < 1 to compress range
  }, [centralityScores, nodeDegrees])

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return

    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 10,
            'font-size': 10,
            'font-family': 'Inter, system-ui, sans-serif',
            'font-weight': 500,
            'color': '#e4e4e7',
            'text-outline-color': BACKGROUND_COLOR,
            'text-outline-width': 2,
            'text-max-width': '100px',
            'text-wrap': 'ellipsis',
            'background-color': 'data(color)',
            'width': 'data(size)',
            'height': 'data(size)',
            'border-width': 2,
            'border-color': '#2a2a3a',
            'transition-property': 'width, height, border-color, border-width, opacity',
            'transition-duration': 200,
          },
        },
        {
          selector: 'node.hub',
          style: {
            'border-width': 3,
            'border-color': '#f59e0b',
            'border-style': 'double',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#3b82f6',
            'width': 'data(selectedSize)',
            'height': 'data(selectedSize)',
            'z-index': 999,
          },
        },
        {
          selector: 'node.hover',
          style: {
            'border-width': 3,
            'border-color': '#60a5fa',
            'z-index': 998,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.6,
            'transition-property': 'opacity, line-color, width',
            'transition-duration': 200,
          },
        },
        // Classified relationships (Palantir-grade) - show labels
        {
          selector: 'edge[rel_type]',
          style: {
            'label': 'data(label)',
            'font-size': 9,
            'font-weight': 600,
            'font-family': 'Inter, system-ui, sans-serif',
            'color': '#e4e4e7',
            'text-rotation': 'autorotate',
            'text-margin-y': -8,
            'text-outline-color': BACKGROUND_COLOR,
            'text-outline-width': 2,
            'opacity': 0.85,
            'line-style': 'solid',
          },
        },
        {
          selector: 'edge[type="CO_OCCURS_WITH"]',
          style: {
            'line-style': 'solid',
            'width': 'data(width)',
            'opacity': 0.7,
          },
        },
        {
          selector: 'edge[type="MENTIONS"]',
          style: {
            'line-style': 'dashed',
            'opacity': 0.3,
          },
        },
        {
          selector: 'edge.hover',
          style: {
            'line-color': EDGE_COLOR_HOVER,
            'target-arrow-color': EDGE_COLOR_HOVER,
            'opacity': 1,
            'width': 3,
          },
        },
        {
          selector: 'edge.connected',
          style: {
            'opacity': 1,
            'width': 3,
            'line-color': '#60a5fa',
            'target-arrow-color': '#60a5fa',
          },
        },
        {
          selector: '.faded',
          style: {
            'opacity': 0.1,
          },
        },
        {
          selector: '.highlighted',
          style: {
            'opacity': 1,
            'z-index': 900,
          },
        },
      ],
      layout: { name: 'preset' },
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 5,
      boxSelectionEnabled: true,
    })

    cyRef.current = cy

    // Event handlers
    cy.on('tap', 'node', (evt) => {
      const node = evt.target
      const nodeData = node.data() as GraphNode & { size: number }
      onNodeClick(nodeData)
    })

    cy.on('dbltap', 'node', (evt) => {
      const node = evt.target
      const nodeData = node.data() as GraphNode & { size: number }
      onNodeDoubleClick(nodeData)
    })

    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target as NodeSingular
      node.addClass('hover')

      // Highlight connected edges and neighbors
      const neighborhood = node.neighborhood()
      node.connectedEdges().addClass('connected')
      neighborhood.nodes().addClass('highlighted')

      // Fade non-connected elements
      cy.elements().not(node).not(neighborhood).addClass('faded')

      const nodeData = node.data() as GraphNode
      onNodeHover(nodeData)
    })

    cy.on('mouseout', 'node', (evt) => {
      const node = evt.target as NodeSingular
      node.removeClass('hover')
      cy.elements().removeClass('faded connected highlighted')
      onNodeHover(null)
    })

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        onBackgroundClick()
      }
    })

    return () => {
      cy.destroy()
    }
  }, [onNodeClick, onNodeDoubleClick, onNodeHover, onBackgroundClick])

  // Update graph data
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    // Clear existing elements
    cy.elements().remove()

    // Add nodes
    const cyNodes = filteredNodes.map(node => {
      const size = getNodeSize(node.id)
      const isHub = hubNodes.has(node.id)
      const degree = nodeDegrees.get(node.id) || 0

      return {
        data: {
          ...node,
          color: NODE_COLORS[node.type] || '#71717a',
          size,
          selectedSize: size * 1.3,
          degree,
          isHub,
        },
        classes: isHub ? 'hub' : '',
      }
    })

    // Add edges with color based on type/rel_type and width based on confidence
    const cyEdges = filteredEdges.map(edge => {
      // Use rel_type for color if classified, otherwise fall back to base type
      const colorKey = edge.rel_type || edge.type
      const edgeColor = EDGE_COLORS[colorKey] || EDGE_COLORS.DEFAULT

      // Get human-readable label with election context
      let edgeLabel = edge.rel_type ? (EDGE_LABELS[edge.rel_type] || '') : ''
      if (edge.properties) {
        const props = edge.properties as Record<string, unknown>
        if (edge.rel_type === 'RUNNING_IN' && props.is_winner) {
          edgeLabel = 'Won'
        } else if (edge.rel_type === 'COMPETED_AGAINST' && props.vote_margin) {
          edgeLabel = `Opp (+${Number(props.vote_margin).toLocaleString()})`
        } else if (edge.rel_type === 'SWITCHED_PARTY' && props.from_party_name) {
          edgeLabel = `${props.from_party_name} \u2192`
        } else if (edge.rel_type === 'SAME_PARTY_DISTRICT' && props.party_name) {
          edgeLabel = String(props.party_name).substring(0, 12)
        }
      }

      // Classified relationships should be more prominent
      const isClassified = !!edge.rel_type
      const isEntityEdge = edge.type === 'CO_OCCURS_WITH' || edge.type === 'RELATED_TO'
      const baseWidth = isClassified ? 2.5 : (isEntityEdge ? 2 : 1)

      return {
        data: {
          id: `${edge.source}-${edge.target}`,
          source: edge.source,
          target: edge.target,
          width: baseWidth + edge.confidence * 2,
          type: edge.type,
          rel_type: edge.rel_type || null,  // Classified relationship type
          label: edgeLabel,  // Human-readable label
          color: edgeColor,
          confidence: edge.confidence,
          llm_confidence: edge.llm_confidence || null,
          mention_count: edge.mention_count || null,
          properties: edge.properties,
        },
      }
    })

    cy.add([...cyNodes, ...cyEdges])

    // Run layout
    if (cyNodes.length > 0) {
      const layoutConfig = LAYOUT_CONFIGS[layoutRef.current] || LAYOUT_CONFIGS.fcose
      cy.layout(layoutConfig).run()
    }

    // Select node if specified
    if (selectedNodeId) {
      cy.getElementById(selectedNodeId).select()
    }
  }, [filteredNodes, filteredEdges, getNodeSize, selectedNodeId, hubNodes, nodeDegrees])

  // Expose methods for external control
  const zoomIn = useCallback(() => {
    const cy = cyRef.current
    if (cy) {
      cy.animate({
        zoom: cy.zoom() * 1.3,
        center: { eles: cy.elements() },
      } as any, { duration: 200 })
    }
  }, [])

  const zoomOut = useCallback(() => {
    const cy = cyRef.current
    if (cy) {
      cy.animate({
        zoom: cy.zoom() / 1.3,
        center: { eles: cy.elements() },
      } as any, { duration: 200 })
    }
  }, [])

  const fitToView = useCallback(() => {
    cyRef.current?.animate({
      fit: { eles: cyRef.current.elements(), padding: 50 },
    } as any, { duration: 300 })
  }, [])

  const runLayout = useCallback((layoutName: string = 'fcose') => {
    const cy = cyRef.current
    if (!cy) return

    layoutRef.current = layoutName
    const layoutConfig = LAYOUT_CONFIGS[layoutName] || LAYOUT_CONFIGS.fcose
    cy.layout(layoutConfig).run()
  }, [])

  const centerOnNode = useCallback((nodeId: string) => {
    const cy = cyRef.current
    if (!cy) return

    const node = cy.getElementById(nodeId)
    if (node.length > 0) {
      cy.animate({
        center: { eles: node },
        zoom: 1.5,
      }, { duration: 300 })
    }
  }, [])

  // Attach methods to ref for external access
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as any).cyMethods = {
        zoomIn,
        zoomOut,
        fitToView,
        runLayout,
        centerOnNode,
      }
    }
  }, [zoomIn, zoomOut, fitToView, runLayout, centerOnNode])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: BACKGROUND_COLOR }}
    />
  )
}
