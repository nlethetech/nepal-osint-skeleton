import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import { Button, Spinner, Intent } from '@blueprintjs/core'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Search,
  Hexagon,
  Eye,
  TrendingUp,
  Plus,
  SlidersHorizontal,
  Crosshair,
  Link2,
} from 'lucide-react'
import {
  expandNode as expandGraphNode,
  getNodeDetail,
  getGraphHealth,
} from '../../api/unifiedGraph'
import { getCombinedGraph } from '../../api/multiLayerGraph'
import { getTrendingEntities } from '../../api/entityIntelligence'
import { useInvestigationStore } from '../../stores/investigationStore'
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore'
import { PathFinderModal } from './PathFinderModal'

const FILTERS_PRO_ENABLED = import.meta.env.VITE_FEATURE_GRAPH_FILTERS_PRO !== 'false'
const GRAPH_CORRECTIONS_ENABLED = import.meta.env.VITE_FEATURE_GRAPH_CORRECTIONS !== 'false'

// Register fcose layout
try { cytoscape.use(fcose) } catch { /* already registered */ }

// ============================================================================
// Cytoscape Stylesheet — carries over styles from UnifiedGraphPanel
// ============================================================================

const CYTOSCAPE_STYLE: cytoscape.StylesheetCSS[] = [
  // ===== NODES =====
  {
    selector: 'node',
    style: {
      'background-color': '#16243a',
      label: 'data(label)',
      'font-size': '9px',
      'font-family': '"Inter", system-ui, sans-serif',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 5,
      color: '#b7c7e3',
      'text-max-width': '90px',
      'text-wrap': 'ellipsis',
      width: 'mapData(degree, 0, 80, 18, 42)',
      height: 'mapData(degree, 0, 80, 18, 42)',
      'background-opacity': 0.95,
      'border-width': 1.5,
      'border-color': '#2e4a72',
      'overlay-opacity': 0,
    },
  },
  {
    selector: 'node[type="person"]',
    style: {
      'background-color': '#1f5f96',
      'border-color': '#6ec6ff',
      shape: 'ellipse',
    },
  },
  {
    selector: 'node[type="organization"]',
    style: {
      'background-color': '#714a20',
      'border-color': '#f2b66f',
      shape: 'round-rectangle',
      width: 'mapData(degree, 0, 80, 20, 46)',
      height: 'mapData(degree, 0, 80, 16, 34)',
    },
  },
  {
    selector: 'node[type="party"]',
    style: {
      'background-color': '#1f553f',
      'border-color': '#62d8a7',
      shape: 'hexagon',
      width: 34,
      height: 34,
      'font-weight': 700,
      color: '#e8fff2',
    },
  },
  {
    selector: 'node[type="institution"], node[type="government"]',
    style: {
      'background-color': '#253043',
      'border-color': '#9bb3d9',
      shape: 'diamond',
    },
  },
  {
    selector: 'node[type="place"]',
    style: {
      'background-color': '#353a45',
      'border-color': '#8d98ad',
      shape: 'round-rectangle',
      width: 22,
      height: 22,
    },
  },
  {
    selector: 'node[type="event"]',
    style: {
      'background-color': '#733036',
      'border-color': '#ff8a8a',
      shape: 'vee',
      width: 26,
      height: 26,
    },
  },
  {
    selector: 'node[type="story"]',
    style: {
      'background-color': '#243753',
      'border-color': '#7aa9ef',
      shape: 'ellipse',
      width: 13,
      height: 13,
      label: '',
    },
  },
  {
    selector: 'node[?isPinned]',
    style: {
      'border-width': 3,
      'border-color': '#2D72D2',
      'shadow-color': '#2D72D2',
      'shadow-blur': 8,
      'shadow-opacity': 0.25,
    },
  },
  {
    selector: 'node[?isExpanded]',
    style: {
      'border-width': 3,
      'border-color': '#ffbc5b',
      'border-style': 'dashed',
    },
  },
  {
    selector: 'node[?isHub]',
    style: { 'border-width': 3.5, 'border-color': '#9f7aea' },
  },
  {
    selector: 'node[?isBridge]',
    style: { 'border-width': 3.5, 'border-color': '#20d1c2' },
  },
  {
    selector: '.faded',
    style: { opacity: 0.1 },
  },
  {
    selector: '.path-highlight',
    style: {
      'border-width': 4,
      'border-color': '#ffd36c',
      'shadow-color': '#ffd36c',
      'shadow-blur': 12,
      'shadow-opacity': 0.4,
      'background-opacity': 1,
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 4,
      'border-color': '#4C90F0',
      'background-blacken': -0.15,
    },
  },
  // ===== EDGES =====
  {
    selector: 'edge',
    style: {
      width: 'mapData(confidence, 0, 1, 0.8, 2.8)',
      'line-color': '#36537d',
      'curve-style': 'bezier',
      opacity: 0.62,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#36537d',
      'arrow-scale': 0.8,
      label: '',
      color: '#7f96bb',
      'font-size': '7px',
      'text-background-color': '#07101d',
      'text-background-opacity': 0.78,
      'text-background-padding': '2px',
    },
  },
  {
    selector: 'edge[predicate="member_of"], edge[predicate="candidate_in"]',
    style: { 'line-color': '#3ba66f', 'target-arrow-color': '#3ba66f' },
  },
  {
    selector: 'edge[predicate="director_of"], edge[predicate="identity_of_candidacy"]',
    style: { 'line-color': '#f1ad4f', 'target-arrow-color': '#f1ad4f' },
  },
  {
    selector: 'edge[predicate="shares_address_with"], edge[predicate="shares_phone_with"]',
    style: { 'line-color': '#9c86ff', 'target-arrow-color': '#9c86ff', 'line-style': 'dashed' },
  },
  {
    selector: 'edge[predicate="located_in"], edge[predicate="within"], edge[predicate="damaged_area_in"]',
    style: { 'line-color': '#4bc2d6', 'target-arrow-color': '#4bc2d6' },
  },
  {
    selector: 'edge[predicate="affected_by"], edge[predicate="occurred_in"]',
    style: { 'line-color': '#ff7f7f', 'target-arrow-color': '#ff7f7f' },
  },
  {
    selector: 'edge.path-highlight',
    style: {
      'line-color': '#ffd36c',
      'target-arrow-color': '#ffd36c',
      width: 3.5,
      opacity: 1,
    },
  },
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#4C90F0',
      'target-arrow-color': '#4C90F0',
      width: 3.2,
      opacity: 1,
      label: 'data(label)',
    },
  },
] as any

// ============================================================================
// Context Menu
// ============================================================================

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  nodeId: string
  nodeLabel: string
  nodeType: string
  isPinned: boolean
  isExpanded: boolean
  hasMore: boolean
}

function ContextMenu({
  state,
  onExpand,
  onFindPath,
  onRemove,
  onViewProfile,
  onSuggestCorrection,
  onClose,
}: {
  state: ContextMenuState
  onExpand: () => void
  onFindPath: () => void
  onRemove: () => void
  onViewProfile: () => void
  onSuggestCorrection?: () => void
  onClose: () => void
}) {
  if (!state.visible) return null

  const items = [
    {
      label: state.isExpanded
        ? (state.hasMore ? 'Load more neighbors' : 'Refresh neighbors')
        : 'Expand neighborhood',
      action: onExpand,
      icon: '+ ',
    },
    { label: 'Find path to...', action: onFindPath, icon: '/' },
    { label: 'View profile', action: onViewProfile, icon: 'i ' },
    {
      label: state.isPinned ? 'Remove from graph' : 'Remove',
      action: onRemove,
      icon: 'x ',
      danger: true,
    },
    ...(onSuggestCorrection ? [{ label: 'Suggest correction', action: onSuggestCorrection, icon: '! ' }] : []),
  ]

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Menu */}
      <div
        className="absolute z-50 rounded-md bg-bp-card border border-bp-border shadow-lg py-1 min-w-[180px]"
        style={{ left: state.x, top: state.y }}
      >
        <div className="px-3 py-1.5 border-b border-bp-border">
          <div className="text-xs text-bp-text font-medium truncate">{state.nodeLabel}</div>
          <div className="text-[10px] text-bp-text-secondary capitalize">{state.nodeType}</div>
        </div>
        {items.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              item.action()
              onClose()
            }}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-bp-hover transition-colors ${
              item.danger ? 'text-severity-critical' : 'text-bp-text'
            }`}
          >
            <span className="text-bp-text-secondary font-mono text-[10px]">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}

// ============================================================================
// Community Hulls — Canvas overlay
// ============================================================================

function drawHulls(
  canvas: HTMLCanvasElement,
  cy: cytoscape.Core,
  elements: Array<{ group: string; data: Record<string, unknown> }>,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { width, height } = canvas.getBoundingClientRect()
  canvas.width = width * 2
  canvas.height = height * 2
  ctx.scale(2, 2)
  ctx.clearRect(0, 0, width, height)

  // Group nodes by cluster_id
  const clusters = new Map<number, Array<{ x: number; y: number }>>()
  for (const el of elements) {
    if (el.group !== 'nodes') continue
    const clusterId = el.data.cluster_id as number | null
    if (clusterId == null) continue

    const cyNode = cy.$(`#${CSS.escape(String(el.data.id))}`)
    if (cyNode.length === 0) continue

    const pos = cyNode.renderedPosition()
    if (!clusters.has(clusterId)) clusters.set(clusterId, [])
    clusters.get(clusterId)!.push({ x: pos.x, y: pos.y })
  }

  // Draw convex hull for clusters with 3+ nodes
  const hullColors = [
    'rgba(45, 114, 210, 0.08)',
    'rgba(34, 197, 94, 0.08)',
    'rgba(249, 115, 22, 0.08)',
    'rgba(168, 85, 247, 0.08)',
    'rgba(236, 72, 153, 0.08)',
    'rgba(6, 182, 212, 0.08)',
  ]
  const borderColors = [
    'rgba(45, 114, 210, 0.25)',
    'rgba(34, 197, 94, 0.25)',
    'rgba(249, 115, 22, 0.25)',
    'rgba(168, 85, 247, 0.25)',
    'rgba(236, 72, 153, 0.25)',
    'rgba(6, 182, 212, 0.25)',
  ]

  let colorIdx = 0
  for (const [, points] of clusters) {
    if (points.length < 3) continue

    const hull = convexHull(points)
    if (hull.length < 3) continue

    const padding = 20
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
    const cy_ = hull.reduce((s, p) => s + p.y, 0) / hull.length
    const expanded = hull.map((p) => ({
      x: p.x + (p.x - cx) / Math.max(Math.hypot(p.x - cx, p.y - cy_), 1) * padding,
      y: p.y + (p.y - cy_) / Math.max(Math.hypot(p.x - cx, p.y - cy_), 1) * padding,
    }))

    ctx.beginPath()
    ctx.moveTo(expanded[0].x, expanded[0].y)
    for (let i = 1; i < expanded.length; i++) {
      ctx.lineTo(expanded[i].x, expanded[i].y)
    }
    ctx.closePath()
    ctx.fillStyle = hullColors[colorIdx % hullColors.length]
    ctx.fill()
    ctx.strokeStyle = borderColors[colorIdx % borderColors.length]
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])

    colorIdx++
  }
}

/** Graham scan convex hull */
function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return [...points]
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (O: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }) =>
    (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x)

  const lower: Array<{ x: number; y: number }> = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Array<{ x: number; y: number }> = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0)
      upper.pop()
    upper.push(sorted[i])
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

type TemporalWindow = '24h' | '7d' | '30d' | 'all_time'

function inferNodeTypeFromFallback(rawType: string): string {
  if (['person', 'organization', 'party', 'institution', 'government', 'story', 'country', 'commodity'].includes(rawType)) {
    return rawType
  }
  if (rawType === 'partner_country') return 'country'
  if (rawType === 'hs_chapter') return 'commodity'
  if (rawType === 'disaster_incident') return 'event'
  if (['province', 'district', 'constituency', 'nepal', 'customs_office'].includes(rawType)) {
    return 'place'
  }
  return 'organization'
}

function mapCombinedGraphToElements(fallbackGraph: Awaited<ReturnType<typeof getCombinedGraph>>) {
  return [
    ...fallbackGraph.elements.nodes.map((node) => ({
      group: 'nodes' as const,
      data: {
        ...node.data,
        id: String(node.data.id),
        label: String(node.data.label ?? node.data.id),
        node_type: inferNodeTypeFromFallback(String(node.data.type ?? 'organization')),
        type: inferNodeTypeFromFallback(String(node.data.type ?? 'organization')),
        source_table: `fallback_${String(node.data.layer ?? 'combined')}`,
        confidence: Number(node.data.confidence ?? 0.75),
      },
    })),
    ...fallbackGraph.elements.edges.map((edge) => ({
      group: 'edges' as const,
      data: {
        ...edge.data,
        id: String(edge.data.id),
        source: String(edge.data.source),
        target: String(edge.data.target),
        predicate: String(edge.data.edgeType ?? edge.data.label ?? 'related_to').toLowerCase(),
        confidence: Number(edge.data.confidence ?? 0.75),
        weight: Number(edge.data.weight ?? edge.data.value ?? 1),
      },
    })),
  ]
}

// ============================================================================
// Main Component
// ============================================================================

interface InvestigationGraphPanelProps {
  className?: string
}

export function InvestigationGraphPanel({ className = '' }: InvestigationGraphPanelProps) {
  const cyRef = useRef<cytoscape.Core | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const prevElementCountRef = useRef(0)

  const {
    elements,
    pinnedNodeIds,
    expandedNodeIds,
    pathHighlight,
    communitiesVisible,
    selectedNodeId,
    setSelectedNode,
    setHoveredNode,
    expandNode,
    removeNode,
    addEntity,
    replaceElements,
    toggleCommunities,
    setPathHighlight,
  } = useInvestigationStore()

  const { selectEntity, setRightPanelMode } = useConnectedAnalystStore()
  const navigate = useNavigate()

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: '',
    nodeLabel: '',
    nodeType: '',
      isPinned: false,
      isExpanded: false,
      hasMore: true,
    })

  // Path finder modal
  const [pathFinderOpen, setPathFinderOpen] = useState(false)
  const [pathFinderFrom, setPathFinderFrom] = useState({ id: '', label: '' })

  // Expanding indicator
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null)
  const [masterLoading, setMasterLoading] = useState(false)
  const [expandState, setExpandState] = useState<Record<string, { offset: number; hasMore: boolean }>>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [engineMode, setEngineMode] = useState<'unified' | 'fallback'>('unified')
  const [timeWindow, setTimeWindow] = useState<TemporalWindow>('7d')
  const [timeHorizonHours, setTimeHorizonHours] = useState(168)
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<string[]>([])
  const [selectedPredicates, setSelectedPredicates] = useState<string[]>([])
  const [selectedSourceTables, setSelectedSourceTables] = useState<string[]>([])
  const [minConfidence, setMinConfidence] = useState(0)
  const [minCompleteness, setMinCompleteness] = useState(0)

  // Trending for empty state
  const [trending, setTrending] = useState<
    Array<{ id: string; name_en: string; entity_type: string }>
  >([])

  const temporalParams = useMemo(() => {
    if (timeWindow === 'all_time') {
      return { window: 'all_time' as const }
    }
    const toTs = new Date().toISOString()
    const fromTs = new Date(Date.now() - timeHorizonHours * 60 * 60 * 1000).toISOString()
    return {
      window: timeWindow,
      from_ts: fromTs,
      to_ts: toTs,
    }
  }, [timeWindow, timeHorizonHours])

  // Load trending for empty state
  useEffect(() => {
    if (elements.length > 0) return
    let cancelled = false
    async function load() {
      try {
        const data = await getTrendingEntities({ limit: 5 })
        if (!cancelled) setTrending(data)
      } catch { /* ignore */ }
    }
    void load()
    return () => { cancelled = true }
  }, [elements.length])

  useEffect(() => {
    let cancelled = false
    async function detectEngineAndFallback() {
      try {
        const health = await getGraphHealth().then((r) => r.data)
        if (cancelled) return
        const degraded = health.status !== 'healthy'
        setEngineMode(degraded ? 'fallback' : 'unified')
        if (!degraded || elements.length > 0) return

        const fallbackGraph = await getCombinedGraph({
          layers: ['entity', 'geographic', 'news', 'disaster', 'trade'],
          window: '7d',
          limit_nodes: 220,
          top_countries: 12,
          include_constituencies: true,
          include_geographic: true,
          include_parties: true,
          include_ministerial: true,
          include_opponents: false,
          news_hours: 72,
          disaster_days: 30,
          min_co_mentions: 2,
          min_strength: 2,
        })
        if (cancelled) return

        const fallbackElements = mapCombinedGraphToElements(fallbackGraph)
        replaceElements(fallbackElements)
      } catch {
        if (!cancelled) setEngineMode('unified')
      }
    }
    void detectEngineAndFallback()
    return () => { cancelled = true }
  }, [elements.length, replaceElements])

  // --------------------------------------------------------------------------
  // Cytoscape element conversion (memoized)
  // --------------------------------------------------------------------------

  const filterFacets = useMemo(() => {
    const nodeTypes = new Set<string>()
    const predicates = new Set<string>()
    const sourceTables = new Set<string>()
    for (const el of elements) {
      if (el.group === 'nodes') {
        const type = (el.data.node_type || el.data.type) as string | undefined
        if (type) nodeTypes.add(type)
        const sourceTable = el.data.source_table as string | undefined
        if (sourceTable) sourceTables.add(sourceTable)
      } else {
        const predicate = el.data.predicate as string | undefined
        if (predicate) predicates.add(predicate)
      }
    }
    return {
      nodeTypes: Array.from(nodeTypes).sort(),
      predicates: Array.from(predicates).sort(),
      sourceTables: Array.from(sourceTables).sort(),
    }
  }, [elements])

  const filteredElements = useMemo(() => {
    const visibleNodeIds = new Set<string>()
    const filteredNodes = elements.filter((el) => {
      if (el.group !== 'nodes') return false
      const nodeType = (el.data.node_type || el.data.type) as string | undefined
      const sourceTable = el.data.source_table as string | undefined
      const confidence = Number(el.data.confidence ?? 1)
      const completenessChecks = [
        Boolean(el.data.label),
        Boolean(nodeType),
        Boolean(sourceTable),
        Boolean(el.data.district || el.data.province),
        confidence >= 0,
      ]
      const completeness = completenessChecks.filter(Boolean).length / completenessChecks.length

      const nodeTypePass = selectedNodeTypes.length === 0 || (nodeType ? selectedNodeTypes.includes(nodeType) : false)
      const sourceTablePass = selectedSourceTables.length === 0 || (sourceTable ? selectedSourceTables.includes(sourceTable) : false)
      const confidencePass = confidence >= minConfidence
      const completenessPass = completeness >= minCompleteness
      const pass = nodeTypePass && sourceTablePass && confidencePass && completenessPass
      if (pass) visibleNodeIds.add(el.data.id as string)
      return pass
    })

    const filteredEdges = elements.filter((el) => {
      if (el.group !== 'edges') return false
      const predicate = el.data.predicate as string | undefined
      const confidence = Number(el.data.confidence ?? 1)
      const src = el.data.source as string
      const tgt = el.data.target as string

      const predicatePass = selectedPredicates.length === 0 || (predicate ? selectedPredicates.includes(predicate) : false)
      const confidencePass = confidence >= minConfidence
      const nodePass = visibleNodeIds.has(src) && visibleNodeIds.has(tgt)
      return predicatePass && confidencePass && nodePass
    })
    return [...filteredNodes, ...filteredEdges]
  }, [elements, selectedNodeTypes, selectedPredicates, selectedSourceTables, minConfidence, minCompleteness])

  const cyElements = useMemo(
    () =>
      filteredElements.map((el) => ({
        ...el,
        data: { ...el.data },
      })),
    [filteredElements],
  )

  // --------------------------------------------------------------------------
  // Graph initialization and event handlers
  // --------------------------------------------------------------------------

  const handleCyInit = useCallback(
    (cy: cytoscape.Core) => {
      cyRef.current = cy

      // Initial layout
      if (cy.nodes().length > 0) {
        cy.layout({
          name: 'fcose',
          animate: true,
          animationDuration: 600,
          randomize: true,
          nodeDimensionsIncludeLabels: false,
          idealEdgeLength: 140,
          nodeRepulsion: 12000,
          edgeElasticity: 0.1,
          gravity: 0.2,
          numIter: 3000,
        } as any).run()
      }

      // Click node -> select for right panel
      cy.on('tap', 'node', (evt) => {
        const node = evt.target
        const nodeId = node.data('id')
        setSelectedNode(nodeId)

        // Try to open entity profile for person/org/institution types
        const nodeType = node.data('type')
        if (isUuid(nodeId) && ['person', 'organization', 'institution', 'party', 'government'].includes(nodeType)) {
          selectEntity(nodeId)
        }
      })

      // Right-click -> context menu
      cy.on('cxttap', 'node', (evt) => {
        evt.originalEvent.preventDefault()
        const node = evt.target
        const renderedPos = node.renderedPosition()

        setCtxMenu({
          visible: true,
          x: renderedPos.x,
          y: renderedPos.y,
          nodeId: node.data('id'),
          nodeLabel: node.data('label') || node.data('id'),
          nodeType: node.data('type') || 'unknown',
          isPinned: pinnedNodeIds.includes(node.data('id')),
          isExpanded: expandedNodeIds.includes(node.data('id')),
          hasMore: isUuid(node.data('id')) && (expandState[node.data('id')]?.hasMore ?? true),
        })
      })

      // Background click -> deselect
      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          setSelectedNode(null)
          setCtxMenu((s) => ({ ...s, visible: false }))
        }
      })

      // Hover highlighting
      let hoverTimer: ReturnType<typeof setTimeout> | null = null

      cy.on('mouseover', 'node', (evt) => {
        if (hoverTimer) clearTimeout(hoverTimer)
        hoverTimer = setTimeout(() => {
          const node = evt.target
          setHoveredNode(node.data('id'))

          // Fade everything, keep hovered neighborhood visible
          cy.elements().addClass('faded')
          node.removeClass('faded')
          node.connectedEdges().removeClass('faded')
          node.connectedEdges().connectedNodes().removeClass('faded')
        }, 80)
      })

      cy.on('mouseout', 'node', () => {
        if (hoverTimer) clearTimeout(hoverTimer)
        hoverTimer = setTimeout(() => {
          setHoveredNode(null)
          cy.elements().removeClass('faded')
        }, 80)
      })

      prevElementCountRef.current = cy.elements().length
    },
    [pinnedNodeIds, expandedNodeIds, expandState, selectEntity, setSelectedNode, setHoveredNode],
  )

  // --------------------------------------------------------------------------
  // Incremental layout: when new elements are added, layout only new nodes
  // --------------------------------------------------------------------------

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    const currentCount = elements.length
    const prevCount = prevElementCountRef.current

    if (currentCount > prevCount && prevCount > 0) {
      // Lock existing node positions, layout only new ones
      const existingIds = new Set<string>()
      cy.nodes().forEach((n) => { existingIds.add(n.id()) })

      // After Cytoscape re-renders with new elements, run incremental layout
      requestAnimationFrame(() => {
        const newNodes = cy.nodes().filter((n) => !existingIds.has(n.id()))
        if (newNodes.length === 0) return

        const fixedConstraints: Array<{ nodeId: string; position: { x: number; y: number } }> = []
        cy.nodes().filter((n) => existingIds.has(n.id())).forEach((n) => {
          fixedConstraints.push({ nodeId: n.id(), position: n.position() })
        })

        cy.layout({
          name: 'fcose',
          animate: true,
          animationDuration: 400,
          randomize: false,
          fixedNodeConstraint: fixedConstraints,
          idealEdgeLength: 120,
          nodeRepulsion: 10000,
          edgeElasticity: 0.1,
          gravity: 0.15,
          numIter: 2000,
        } as any).run()
      })
    }

    prevElementCountRef.current = currentCount
  }, [elements])

  // --------------------------------------------------------------------------
  // Path highlighting
  // --------------------------------------------------------------------------

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.elements().removeClass('path-highlight')

    if (pathHighlight && pathHighlight.length > 0) {
      for (const nodeId of pathHighlight) {
        cy.$(`#${CSS.escape(nodeId)}`).addClass('path-highlight')
      }
      // Highlight edges between consecutive path nodes
      for (let i = 0; i < pathHighlight.length - 1; i++) {
        const src = pathHighlight[i]
        const tgt = pathHighlight[i + 1]
        cy.edges().filter(
          (e) =>
            (e.data('source') === src && e.data('target') === tgt) ||
            (e.data('source') === tgt && e.data('target') === src),
        ).addClass('path-highlight')
      }

      // Fit to path
      const pathElements = cy.collection()
      for (const nid of pathHighlight) {
        pathElements.merge(cy.$(`#${CSS.escape(nid)}`))
      }
      if (pathElements.length > 0) {
        cy.animate({ fit: { eles: pathElements, padding: 60 } } as any, { duration: 400 })
      }
    }
  }, [pathHighlight])

  // --------------------------------------------------------------------------
  // Community hulls redraw
  // --------------------------------------------------------------------------

  useEffect(() => {
    const cy = cyRef.current
    const canvas = canvasRef.current
    if (!cy || !canvas || !communitiesVisible) return

    const redraw = () => drawHulls(canvas, cy, elements)
    redraw()

    cy.on('pan zoom layoutstop', redraw)
    return () => {
      cy.off('pan zoom layoutstop', redraw)
    }
  }, [communitiesVisible, elements])

  // --------------------------------------------------------------------------
  // Context menu handlers
  // --------------------------------------------------------------------------

  const handleExpand = useCallback(async () => {
    const nodeId = ctxMenu.nodeId
    if (engineMode === 'fallback' || !isUuid(nodeId)) return
    const current = expandState[nodeId] ?? { offset: 0, hasMore: true }
    const nextOffset = current.hasMore ? current.offset : 0
    setExpandingNodeId(nodeId)

    try {
      const expansion = await expandGraphNode(nodeId, {
        limit: 50,
        offset: nextOffset,
        min_confidence: minConfidence,
        ...temporalParams,
      }).then((r) => r.data)
      expandNode(nodeId, expansion.nodes, expansion.edges)
      setExpandState((prev) => ({
        ...prev,
        [nodeId]: {
          offset: (nextOffset + expansion.edges.length),
          hasMore: expansion.has_more,
        },
      }))
    } catch (err) {
      console.error('Expand failed:', err)
    } finally {
      setExpandingNodeId(null)
    }
  }, [ctxMenu.nodeId, engineMode, expandState, expandNode, minConfidence, temporalParams])

  const handleFindPath = useCallback(() => {
    if (!isUuid(ctxMenu.nodeId)) return
    setPathFinderFrom({ id: ctxMenu.nodeId, label: ctxMenu.nodeLabel })
    setPathFinderOpen(true)
  }, [ctxMenu.nodeId, ctxMenu.nodeLabel])

  const handleRemove = useCallback(() => {
    removeNode(ctxMenu.nodeId)
  }, [ctxMenu.nodeId, removeNode])

  const handleViewProfile = useCallback(() => {
    if (!isUuid(ctxMenu.nodeId)) return
    selectEntity(ctxMenu.nodeId)
  }, [ctxMenu.nodeId, selectEntity])

  const handleSuggestCorrection = useCallback(() => {
    if (!isUuid(ctxMenu.nodeId)) return
    selectEntity(ctxMenu.nodeId)
    setRightPanelMode('corrections')
  }, [ctxMenu.nodeId, selectEntity, setRightPanelMode])

  // --------------------------------------------------------------------------
  // Toolbar handlers
  // --------------------------------------------------------------------------

  const handleZoomIn = () => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)
  const handleZoomOut = () => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)
  const handleFit = () => cyRef.current?.fit(undefined, 50)
  const handleExport = () => {
    if (!cyRef.current) return
    const jpg = cyRef.current.jpg({ full: true, scale: 3, bg: '#111418', quality: 1 })
    const link = document.createElement('a')
    link.href = jpg
    link.download = `narada-graph-${new Date().toISOString().slice(0, 10)}.jpg`
    link.click()
  }

  const handleLoadMasterGraph = useCallback(async () => {
    setMasterLoading(true)
    try {
      const combined = await getCombinedGraph({
        layers: ['entity', 'geographic', 'news', 'disaster', 'trade'],
        window: '30d',
        limit_nodes: 500,
        top_countries: 25,
        include_constituencies: true,
        include_geographic: true,
        include_parties: true,
        include_ministerial: true,
        include_opponents: true,
        news_hours: 168,
        disaster_days: 180,
        min_co_mentions: 1,
        min_strength: 1,
      })
      replaceElements(mapCombinedGraphToElements(combined))
      setEngineMode('fallback')
    } finally {
      setMasterLoading(false)
    }
  }, [replaceElements])

  // --------------------------------------------------------------------------
  // Add trending entity (for empty state)
  // --------------------------------------------------------------------------

  const [addingTrending, setAddingTrending] = useState<string | null>(null)

  const handleAddTrending = useCallback(
    async (entityId: string) => {
      setAddingTrending(entityId)
      try {
        const [nodeDetail, expansion] = await Promise.all([
          getNodeDetail(entityId, temporalParams).then((r) => r.data),
          expandGraphNode(entityId, { limit: 20, ...temporalParams }).then((r) => r.data),
        ])

        const primaryNode = {
          data: {
            id: nodeDetail.id,
            label: nodeDetail.title,
            node_type: nodeDetail.node_type,
            canonical_key: nodeDetail.canonical_key ?? '',
            district: nodeDetail.district,
            province: nodeDetail.province,
            confidence: nodeDetail.confidence,
            properties: nodeDetail.properties,
            degree: nodeDetail.total_outgoing + nodeDetail.total_incoming,
            pagerank: (nodeDetail.metrics?.[0] as Record<string, unknown>)?.pagerank as number ?? 0,
            is_hub: false,
            is_bridge: false,
          },
        }
        addEntity(primaryNode, expansion.nodes, expansion.edges)
      } catch { /* ignore */ }
      finally { setAddingTrending(null) }
    },
    [addEntity, temporalParams],
  )

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const nodeCount = filteredElements.filter((el) => el.group === 'nodes').length
  const edgeCount = filteredElements.filter((el) => el.group === 'edges').length
  const totalNodeCount = elements.filter((el) => el.group === 'nodes').length
  const totalEdgeCount = elements.filter((el) => el.group === 'edges').length
  const handleWindowChange = (nextWindow: TemporalWindow) => {
    setTimeWindow(nextWindow)
    if (nextWindow === '24h') setTimeHorizonHours(24)
    if (nextWindow === '7d') setTimeHorizonHours(168)
    if (nextWindow === '30d') setTimeHorizonHours(720)
  }
  const selectedNodeData = useMemo(() => (
    elements.find((el) => el.group === 'nodes' && el.data.id === selectedNodeId)?.data
  ), [elements, selectedNodeId])

  return (
    <div
      className={`flex flex-col h-full investigation-panel-chrome investigation-graph-shell rounded-lg ${className}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bp-border bg-bp-card">
        <div className="flex items-center gap-2.5">
          <h3 className="investigation-rail-title flex items-center gap-1.5">
            <Crosshair size={12} className="text-bp-primary" />
            Graph Canvas
          </h3>
          <span className="investigation-metric-chip">
            {nodeCount}/{totalNodeCount} nodes &middot; {edgeCount}/{totalEdgeCount} edges
          </span>
          <span className={`investigation-metric-chip ${engineMode === 'fallback' ? 'text-bp-warning' : ''}`}>
            Engine <strong>{engineMode}</strong>
          </span>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-bp-border bg-bp-app">
            <select
              value={timeWindow}
              onChange={(e) => handleWindowChange(e.target.value as TemporalWindow)}
              className="bg-transparent text-[10px] text-bp-text-secondary outline-none"
              title="Temporal window"
            >
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
              <option value="all_time">all</option>
            </select>
            <input
              type="range"
              min={24}
              max={720}
              step={24}
              value={timeHorizonHours}
              disabled={timeWindow === 'all_time'}
              onChange={(e) => setTimeHorizonHours(Number(e.target.value))}
              className="w-20"
              title="Time horizon"
            />
            <span className="text-[10px] text-bp-text-secondary w-10 text-right">
              {timeWindow === 'all_time' ? 'all' : `${timeHorizonHours}h`}
            </span>
          </div>
          {expandingNodeId && (
            <Spinner size={12} intent={Intent.PRIMARY} />
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Community hulls toggle */}
          {FILTERS_PRO_ENABLED && (
            <Button
              minimal
              small
              icon={<SlidersHorizontal size={12} className={filtersOpen ? 'text-bp-primary' : 'text-bp-text-secondary'} />}
              onClick={() => setFiltersOpen((s) => !s)}
              title="Professional filters"
              className={filtersOpen ? 'text-bp-primary' : 'text-bp-text-secondary'}
            />
          )}
          <Button
            minimal
            small
            icon={<Hexagon size={12} className={communitiesVisible ? 'text-bp-primary' : 'text-bp-text-secondary'} />}
            onClick={toggleCommunities}
            active={communitiesVisible}
            title="Community hulls"
            className={communitiesVisible ? 'text-bp-primary' : 'text-bp-text-secondary'}
          />
          {/* Clear path highlight */}
          {pathHighlight && (
            <Button
              minimal
              small
              icon={<Eye size={12} className="text-bp-warning" />}
              onClick={() => setPathHighlight(null)}
              title="Clear path highlight"
            />
          )}
          <div className="w-px h-4 mx-1 bg-bp-border" />
          <Button minimal small icon={<ZoomIn size={12} className="text-bp-text-secondary" />} onClick={handleZoomIn} title="Zoom in" className="text-bp-text-secondary" />
          <Button minimal small icon={<ZoomOut size={12} className="text-bp-text-secondary" />} onClick={handleZoomOut} title="Zoom out" className="text-bp-text-secondary" />
          <Button minimal small icon={<Maximize2 size={12} className="text-bp-text-secondary" />} onClick={handleFit} title="Fit" className="text-bp-text-secondary" />
          <Button minimal small icon={<Download size={12} className="text-bp-text-secondary" />} onClick={handleExport} title="Export JPG (full graph)" className="text-bp-text-secondary" />
          <div className="w-px h-4 mx-1 bg-bp-border" />
          <Button
            minimal
            small
            loading={masterLoading}
            onClick={() => void handleLoadMasterGraph()}
            className="text-[10px] text-bp-primary"
            title="Load a large connected master graph snapshot"
          >
            Master Graph
          </Button>
          <Button
            minimal
            small
            onClick={() => navigate('/')}
            className="text-[10px] text-bp-text-secondary"
            title="Go to Analyst report desk"
          >
            Ops Home
          </Button>
        </div>
      </div>

      {FILTERS_PRO_ENABLED && filtersOpen && (
        <div className="px-3 py-2 border-b border-bp-border bg-bp-card space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <FilterGroup
              label="Node Type"
              values={filterFacets.nodeTypes}
              selected={selectedNodeTypes}
              onToggle={(value) => setSelectedNodeTypes((prev) => (
                prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
              ))}
            />
            <FilterGroup
              label="Edge Predicate"
              values={filterFacets.predicates}
              selected={selectedPredicates}
              onToggle={(value) => setSelectedPredicates((prev) => (
                prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
              ))}
            />
          </div>
          <FilterGroup
            label="Source Table"
            values={filterFacets.sourceTables}
            selected={selectedSourceTables}
            onToggle={(value) => setSelectedSourceTables((prev) => (
              prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
            ))}
          />
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-bp-text-secondary min-w-[90px]">Confidence</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-[10px] text-bp-text-secondary w-9 text-right">
              {minConfidence.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-bp-text-secondary min-w-[90px]">Completeness</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={minCompleteness}
              onChange={(e) => setMinCompleteness(Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-[10px] text-bp-text-secondary w-9 text-right">
              {minCompleteness.toFixed(1)}
            </span>
          </div>
        </div>
      )}

      {/* Graph container */}
      <div className="flex-1 min-h-0 relative">
        {elements.length > 0 && (
          <div className="absolute top-2 left-2 z-20 rounded border border-bp-border bg-bp-card px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-bp-text-secondary mb-1">Tactical Readout</div>
            <div className="flex items-center gap-3 text-[11px] text-bp-text-secondary">
              <span className="flex items-center gap-1"><Link2 size={11} className="text-bp-primary" /> links {edgeCount}</span>
              <span className="flex items-center gap-1"><Crosshair size={11} className="text-bp-warning" /> focus {selectedNodeId ? 'locked' : 'none'}</span>
            </div>
            {selectedNodeData && (
              <div className="mt-1 text-[11px] text-bp-text">
                {String(selectedNodeData.label || selectedNodeData.id)}{' '}
                <span className="text-bp-text-secondary">({String(selectedNodeData.type || selectedNodeData.node_type || 'unknown')})</span>
              </div>
            )}
          </div>
        )}
        {elements.length === 0 ? (
          /* Empty state */
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center max-w-sm rounded-lg border border-bp-border bg-bp-card px-6 py-5">
              <Search size={36} className="mx-auto mb-3 text-bp-text-secondary" />
              <h4 className="text-sm font-semibold text-bp-text mb-1 tracking-wide">
                Prime The Graph
              </h4>
              <p className="text-xs text-bp-text-secondary mb-4 leading-relaxed">
                Add a known actor to initialize the graph mesh, then expand neighborhoods
                to expose hidden corporate, candidate, and event pathways.
              </p>
              {trending.length > 0 && (
                <div>
                  <div className="flex items-center justify-center gap-1 mb-2">
                    <TrendingUp size={11} className="text-bp-text-secondary" />
                    <span className="text-[10px] uppercase font-semibold tracking-wide text-bp-text-secondary">
                      Trending
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1">
                    {trending.map((t) => (
                      <Button
                        key={t.id}
                        minimal
                        small
                        loading={addingTrending === t.id}
                        icon={<Plus size={10} />}
                        onClick={() => void handleAddTrending(t.id)}
                        className="text-xs text-bp-text-secondary"
                      >
                        {t.name_en}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Community hulls canvas overlay */}
            {communitiesVisible && (
              <canvas
                ref={canvasRef}
                className="absolute inset-0 z-0 pointer-events-none"
                style={{ width: '100%', height: '100%' }}
              />
            )}

            {/* Cytoscape graph */}
            <CytoscapeComponent
              elements={cyElements}
              stylesheet={CYTOSCAPE_STYLE}
              style={{ width: '100%', height: '100%' }}
              cy={handleCyInit}
              wheelSensitivity={0.2}
            />

            {/* Context Menu */}
            <ContextMenu
              state={ctxMenu}
              onExpand={() => void handleExpand()}
              onFindPath={handleFindPath}
              onRemove={handleRemove}
              onViewProfile={handleViewProfile}
              onSuggestCorrection={GRAPH_CORRECTIONS_ENABLED ? handleSuggestCorrection : undefined}
              onClose={() => setCtxMenu((s) => ({ ...s, visible: false }))}
            />
          </>
        )}
      </div>

      {/* Legend bar */}
      {elements.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] flex-wrap border-t border-bp-border bg-bp-card">
          <LegendItem color="bg-indigo-500" shape="rounded-full" label="Person" />
          <LegendItem color="bg-green-500" shape="rounded-full" label="Party" />
          <LegendItem color="bg-orange-500" shape="rounded-sm" label="Organization" />
          <LegendItem color="bg-cyan-500" shape="rotate-45" label="Institution" />
          {pinnedNodeIds.length > 0 && (
            <span className="ml-2 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full border-2 border-bp-primary bg-transparent" />
              <span className="text-bp-text-secondary">Pinned</span>
            </span>
          )}
          {expandedNodeIds.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full border-2 border-bp-warning border-dashed bg-transparent" />
              <span className="text-bp-text-secondary">Expanded</span>
            </span>
          )}
        </div>
      )}

      {/* Path Finder Modal */}
      <PathFinderModal
        isOpen={pathFinderOpen}
        onClose={() => setPathFinderOpen(false)}
        fromNodeId={pathFinderFrom.id}
        fromNodeLabel={pathFinderFrom.label}
      />
    </div>
  )
}

// ============================================================================
// Small helpers
// ============================================================================

function LegendItem({ color, shape, label }: { color: string; shape: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2 h-2 ${color} ${shape}`} />
      <span className="text-bp-text-secondary">{label}</span>
    </div>
  )
}

function FilterGroup({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string
  values: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  if (values.length === 0) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-wide text-bp-text-secondary mb-1">{label}</p>
        <p className="text-[10px] text-bp-text-secondary">No values available</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-bp-text-secondary mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.slice(0, 20).map((value) => {
          const active = selected.includes(value)
          return (
            <button
              key={value}
              onClick={() => onToggle(value)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                active
                  ? 'border-bp-primary text-bp-text bg-bp-primary/10'
                  : 'border-bp-border text-bp-text-secondary hover:text-bp-text hover:border-bp-border-strong'
              }`}
            >
              {value}
            </button>
          )
        })}
      </div>
    </div>
  )
}
