import {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  memo,
} from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Download,
  ChevronRight,
  ChevronLeft,
  X,
  Eye,
  EyeOff,
  Route,
  Expand,
  Shrink,
  Activity,
  MapPin,
  User,
  Building2,
  Newspaper,
  AlertTriangle,
  Package,
  Globe,
  Crosshair,
  ExternalLink,
} from 'lucide-react'
import {
  Button,
  InputGroup,
  Spinner,
  Intent,
  Tag,
  Switch,
  Slider,
} from '@blueprintjs/core'
import CountUp from 'react-countup'
import { motion, AnimatePresence } from 'framer-motion'

import {
  useGraphOverview,
  useGraphStats,
  expandNode as apiExpandNode,
  findPath as apiFindPath,
  searchGraph as apiSearchGraph,
  getNodeDetail as apiGetNodeDetail,
  type GraphNode,
  type GraphEdge,
  type GraphNodeData,
  type GraphExpandResponse,
  type GraphPathResponse,
  type GraphSearchResponse,
  type GraphNodeDetailResponse,
} from '../../api/unifiedGraph'
import { useUnifiedGraphStore } from '../../stores/unifiedGraphStore'

// Register layout extension once
try {
  cytoscape.use(fcose)
} catch {
  // Already registered
}

// ============================================================================
// Constants
// ============================================================================

const NODE_TYPE_CONFIG: Record<
  string,
  { color: string; shape: string; icon: typeof MapPin; label: string }
> = {
  place: { color: '#EC4899', shape: 'round-rectangle', icon: MapPin, label: 'Place' },
  person: { color: '#8B5CF6', shape: 'ellipse', icon: User, label: 'Person' },
  organization: { color: '#F59E0B', shape: 'round-rectangle', icon: Building2, label: 'Organization' },
  event: { color: '#EF4444', shape: 'vee', icon: AlertTriangle, label: 'Event' },
  story: { color: '#A855F7', shape: 'diamond', icon: Newspaper, label: 'Story' },
  commodity: { color: '#EAB308', shape: 'round-rectangle', icon: Package, label: 'Commodity' },
  country: { color: '#14B8A6', shape: 'octagon', icon: Globe, label: 'Country' },
  document: { color: '#6366F1', shape: 'round-rectangle', icon: Newspaper, label: 'Document' },
  cluster: { color: '#06B6D4', shape: 'round-rectangle', icon: Activity, label: 'Cluster' },
  assessment: { color: '#F97316', shape: 'diamond', icon: Crosshair, label: 'Assessment' },
}

const PREDICATE_COLORS: Record<string, string> = {
  located_in: '#EC4899',
  parent_of: '#6B7280',
  within: '#6B7280',
  director_of: '#F59E0B',
  member_of: '#22C55E',
  mentioned_in: '#A855F7',
  co_mentioned_with: '#6366F1',
  imports_from: '#EF4444',
  exports_to: '#22C55E',
  trades_commodity: '#EAB308',
  shares_phone_with: '#F97316',
  shares_address_with: '#F97316',
  occurred_in: '#EF4444',
  elected_from: '#3B82F6',
  candidate_in: '#8B5CF6',
  minister_of: '#DC2626',
  won_contract: '#F59E0B',
  story_in_cluster: '#A855F7',
  about_event: '#EF4444',
}

// ============================================================================
// Cytoscape Stylesheet
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CYTOSCAPE_STYLE: any[] = [
  // Base node
  {
    selector: 'node',
    style: {
      'background-color': '#4F46E5',
      label: 'data(label)',
      'font-size': '8px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 4,
      color: '#ABB3BF',
      'text-max-width': '80px',
      'text-wrap': 'ellipsis',
      width: 20,
      height: 20,
      'background-opacity': 0.9,
      'text-outline-color': '#111418',
      'text-outline-width': 1.5,
    },
  },

  // Node types
  {
    selector: 'node[node_type="place"]',
    style: {
      'background-color': '#EC4899',
      shape: 'round-rectangle',
      width: 'mapData(member_count, 0, 10000, 25, 65)',
      height: 'mapData(member_count, 0, 10000, 25, 65)',
      'font-size': '9px',
      'font-weight': 'bold' as const,
    },
  },
  {
    selector: 'node[node_type="person"]',
    style: {
      'background-color': '#8B5CF6',
      shape: 'ellipse',
      width: 'mapData(pagerank, 0, 1, 15, 55)',
      height: 'mapData(pagerank, 0, 1, 15, 55)',
    },
  },
  {
    selector: 'node[node_type="organization"]',
    style: {
      'background-color': '#F59E0B',
      shape: 'round-rectangle',
      width: 'mapData(degree, 0, 100, 18, 50)',
      height: 'mapData(degree, 0, 100, 18, 50)',
    },
  },
  {
    selector: 'node[node_type="event"]',
    style: {
      'background-color': '#EF4444',
      shape: 'vee',
      width: 30,
      height: 30,
    },
  },
  {
    selector: 'node[node_type="story"]',
    style: {
      'background-color': '#A855F7',
      shape: 'diamond',
      width: 14,
      height: 14,
      label: '',
    },
  },
  {
    selector: 'node[node_type="commodity"]',
    style: {
      'background-color': '#EAB308',
      shape: 'round-rectangle',
      width: 20,
      height: 20,
    },
  },
  {
    selector: 'node[node_type="country"]',
    style: {
      'background-color': '#14B8A6',
      shape: 'octagon',
      width: 'mapData(degree, 0, 50, 20, 55)',
      height: 'mapData(degree, 0, 50, 20, 55)',
    },
  },
  {
    selector: 'node[node_type="document"]',
    style: {
      'background-color': '#6366F1',
      shape: 'round-rectangle',
      width: 16,
      height: 16,
    },
  },
  {
    selector: 'node[node_type="cluster"]',
    style: {
      'background-color': '#06B6D4',
      shape: 'round-rectangle',
      width: 22,
      height: 22,
    },
  },

  // Hub/Bridge detection
  {
    selector: 'node[?is_hub]',
    style: {
      'border-width': 3,
      'border-color': '#A855F7',
    },
  },
  {
    selector: 'node[?is_bridge]',
    style: {
      'border-width': 3,
      'border-color': '#06B6D4',
    },
  },

  // Expanded node indicator
  {
    selector: 'node.expanded',
    style: {
      'border-width': 3,
      'border-color': '#FBBF24',
      'border-style': 'dashed' as const,
    },
  },

  // Selected node
  {
    selector: ':selected',
    style: {
      'border-width': 4,
      'border-color': '#2D72D2',
      'overlay-opacity': 0,
    },
  },

  // Base edge
  {
    selector: 'edge',
    style: {
      width: 1,
      'line-color': '#404854',
      'curve-style': 'bezier',
      opacity: 0.4,
      'target-arrow-shape': 'none',
    },
  },

  // Edge predicates
  {
    selector: 'edge[predicate="located_in"]',
    style: {
      'line-color': '#EC4899',
      width: 1,
      opacity: 0.4,
    },
  },
  {
    selector: 'edge[predicate="director_of"]',
    style: {
      'line-color': '#F59E0B',
      width: 2,
      opacity: 0.6,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#F59E0B',
    },
  },
  {
    selector: 'edge[predicate="member_of"]',
    style: {
      'line-color': '#22C55E',
      width: 1.5,
      opacity: 0.5,
    },
  },
  {
    selector: 'edge[predicate="mentioned_in"]',
    style: {
      'line-color': '#A855F7',
      'line-style': 'dashed',
      width: 1,
      opacity: 0.4,
    },
  },
  {
    selector: 'edge[predicate="imports_from"]',
    style: {
      'line-color': '#EF4444',
      width: 'mapData(weight, 0, 1000000, 1, 8)',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#EF4444',
      opacity: 0.7,
    },
  },
  {
    selector: 'edge[predicate="exports_to"]',
    style: {
      'line-color': '#22C55E',
      width: 'mapData(weight, 0, 1000000, 1, 8)',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#22C55E',
      opacity: 0.7,
    },
  },
  {
    selector: 'edge[predicate="shares_phone_with"]',
    style: {
      'line-color': '#F97316',
      width: 2,
      opacity: 0.8,
    },
  },
  {
    selector: 'edge[predicate="occurred_in"]',
    style: {
      'line-color': '#EF4444',
      width: 2,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#EF4444',
    },
  },
  {
    selector: 'edge[predicate="parent_of"]',
    style: {
      'line-color': '#6B7280',
      width: 1,
      opacity: 0.3,
    },
  },
  {
    selector: 'edge[predicate="elected_from"]',
    style: {
      'line-color': '#3B82F6',
      width: 1.5,
      opacity: 0.5,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#3B82F6',
    },
  },
  {
    selector: 'edge[predicate="candidate_in"]',
    style: {
      'line-color': '#8B5CF6',
      width: 1,
      opacity: 0.4,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#8B5CF6',
    },
  },
  {
    selector: 'edge[predicate="minister_of"]',
    style: {
      'line-color': '#DC2626',
      width: 2,
      opacity: 0.6,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#DC2626',
    },
  },
  {
    selector: 'edge[predicate="won_contract"]',
    style: {
      'line-color': '#F59E0B',
      width: 2,
      'line-style': 'dashed',
      opacity: 0.6,
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#F59E0B',
    },
  },
  {
    selector: 'edge[predicate="co_mentioned_with"]',
    style: {
      'line-color': '#6366F1',
      width: 'mapData(weight, 0, 100, 1, 4)',
      opacity: 0.5,
    },
  },

  // Path highlight
  {
    selector: '.path-highlight',
    style: {
      'line-color': '#FFD700',
      width: 4,
      opacity: 1,
      'z-index': 999,
    },
  },
  {
    selector: 'node.path-highlight',
    style: {
      'border-color': '#FFD700',
      'border-width': 4,
    },
  },

  // Dimmed state for hover/focus
  {
    selector: '.dimmed',
    style: {
      opacity: 0.15,
    },
  },
  {
    selector: '.highlighted',
    style: {
      opacity: 1,
      'z-index': 900,
    },
  },

  // Show labels when zoomed in on story/small nodes
  {
    selector: 'node.show-label',
    style: {
      label: 'data(label)',
    },
  },

  // Selected edge
  {
    selector: 'edge:selected',
    style: {
      'line-color': '#2D72D2',
      opacity: 1,
      width: 3,
    },
  },
]

// ============================================================================
// Layout
// ============================================================================

const LAYOUT_OPTIONS = {
  name: 'fcose',
  quality: 'proof',
  animate: true,
  animationDuration: 800,
  randomize: true,
  nodeDimensionsIncludeLabels: false,
  numIter: 3000,
  idealEdgeLength: 150,
  nodeRepulsion: 12000,
  edgeElasticity: 0.1,
  gravity: 0.2,
  gravityRange: 2.0,
  tile: true,
  tilingPaddingVertical: 20,
  tilingPaddingHorizontal: 20,
  fit: true,
  padding: 40,
}

// ============================================================================
// Sub-components
// ============================================================================

/** Debounce hook */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// ---------- GraphToolbar ----------

interface GraphToolbarProps {
  onSearch: (q: string) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onReset: () => void
  onExport: () => void
  isPathMode: boolean
  onTogglePathMode: () => void
}

const GraphToolbar = memo(function GraphToolbar({
  onSearch,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  onExport,
  isPathMode,
  onTogglePathMode,
}: GraphToolbarProps) {
  const {
    visibleNodeTypes,
    hideOrphans,
    minConfidence,
    searchQuery,
    toggleNodeType,
    setHideOrphans,
    setMinConfidence,
    setSearchQuery,
  } = useUnifiedGraphStore()

  const [localQuery, setLocalQuery] = useState(searchQuery)
  const debouncedQuery = useDebouncedValue(localQuery, 300)

  useEffect(() => {
    setSearchQuery(debouncedQuery)
    if (debouncedQuery.length >= 2) {
      onSearch(debouncedQuery)
    }
  }, [debouncedQuery, setSearchQuery, onSearch])

  const [showFilters, setShowFilters] = useState(false)

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-bp-border bg-bp-card flex-wrap">
      {/* Search */}
      <div className="relative flex-shrink-0" style={{ width: 220 }}>
        <InputGroup
          leftIcon={<Search size={14} className="text-bp-text-muted" />}
          placeholder="Search graph..."
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          small
          className="[&_input]:!bg-bp-surface [&_input]:!text-bp-text [&_input]:!border-bp-border"
          rightElement={
            localQuery ? (
              <Button
                minimal
                small
                icon={<X size={12} />}
                onClick={() => {
                  setLocalQuery('')
                  setSearchQuery('')
                }}
                aria-label="Clear search"
              />
            ) : undefined
          }
        />
      </div>

      {/* Filter toggle */}
      <Button
        minimal
        small
        icon={showFilters ? <EyeOff size={14} /> : <Eye size={14} />}
        onClick={() => setShowFilters(!showFilters)}
        active={showFilters}
        title="Toggle filters"
        aria-label="Toggle filters"
        className="text-bp-text-secondary"
      />

      {/* Path mode */}
      <Button
        minimal={!isPathMode}
        small
        intent={isPathMode ? Intent.WARNING : Intent.NONE}
        icon={<Route size={14} />}
        onClick={onTogglePathMode}
        title={isPathMode ? 'Cancel path finding' : 'Find shortest path'}
        aria-label={isPathMode ? 'Cancel path finding' : 'Find shortest path'}
      >
        {isPathMode ? 'Cancel Path' : 'Find Path'}
      </Button>

      {/* Orphan toggle */}
      <Switch
        checked={hideOrphans}
        onChange={() => setHideOrphans(!hideOrphans)}
        label="Hide orphans"
        className="!mb-0 text-bp-text-secondary text-xs"
        innerLabel="off"
        innerLabelChecked="on"
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5">
        <Button
          minimal
          small
          icon={<ZoomIn size={14} className="text-bp-text-secondary" />}
          onClick={onZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        />
        <Button
          minimal
          small
          icon={<ZoomOut size={14} className="text-bp-text-secondary" />}
          onClick={onZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        />
        <Button
          minimal
          small
          icon={<Maximize2 size={14} className="text-bp-text-secondary" />}
          onClick={onFit}
          title="Fit to view"
          aria-label="Fit to view"
        />
        <Button
          minimal
          small
          icon={<RotateCcw size={14} className="text-bp-text-secondary" />}
          onClick={onReset}
          title="Reset graph"
          aria-label="Reset graph"
        />
        <Button
          minimal
          small
          icon={<Download size={14} className="text-bp-text-secondary" />}
          onClick={onExport}
          title="Export PNG"
          aria-label="Export PNG"
        />
      </div>

      {/* Expanded filters row */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            className="w-full flex items-center gap-3 pt-2 border-t border-bp-border mt-1 flex-wrap"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Node type toggles */}
            <span className="text-[10px] uppercase tracking-wider text-bp-text-muted font-semibold">
              Types:
            </span>
            {Object.entries(NODE_TYPE_CONFIG).map(([type, config]) => {
              const isVisible = visibleNodeTypes.includes(type)
              return (
                <button
                  key={type}
                  onClick={() => toggleNodeType(type)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all ${
                    isVisible
                      ? 'bg-bp-surface text-bp-text border border-bp-border'
                      : 'text-bp-text-disabled opacity-50'
                  }`}
                  title={`Toggle ${config.label}`}
                  aria-label={`Toggle ${config.label} visibility`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: config.color }}
                  />
                  {config.label}
                </button>
              )
            })}

            {/* Confidence slider */}
            <div className="flex items-center gap-2 ml-4">
              <span className="text-[10px] uppercase tracking-wider text-bp-text-muted font-semibold">
                Min Confidence:
              </span>
              <Slider
                min={0}
                max={1}
                stepSize={0.05}
                value={minConfidence}
                onChange={setMinConfidence}
                labelRenderer={false}
                className="w-24"
              />
              <span className="text-xs text-bp-text-secondary tabular-nums w-8">
                {Math.round(minConfidence * 100)}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})

// ---------- GraphLegend ----------

const GraphLegend = memo(function GraphLegend() {
  const { visibleNodeTypes } = useUnifiedGraphStore()

  const items = useMemo(
    () =>
      Object.entries(NODE_TYPE_CONFIG).filter(([type]) =>
        visibleNodeTypes.includes(type)
      ),
    [visibleNodeTypes]
  )

  if (items.length === 0) return null

  return (
    <div className="absolute bottom-10 left-3 bg-bp-card/90 backdrop-blur-sm border border-bp-border rounded-lg px-3 py-2 z-10">
      <div className="flex items-center gap-3 flex-wrap">
        {items.map(([type, config]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: config.color }}
            />
            <span className="text-[10px] text-bp-text-secondary">{config.label}</span>
          </div>
        ))}
        {/* Hub/Bridge indicators */}
        <div className="flex items-center gap-1.5 border-l border-bp-border pl-3">
          <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: '#A855F7' }} />
          <span className="text-[10px] text-bp-text-secondary">Hub</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: '#06B6D4' }} />
          <span className="text-[10px] text-bp-text-secondary">Bridge</span>
        </div>
      </div>
    </div>
  )
})

// ---------- GraphStatusBar ----------

interface GraphStatusBarProps {
  visibleNodeCount: number
  visibleEdgeCount: number
}

const GraphStatusBar = memo(function GraphStatusBar({
  visibleNodeCount,
  visibleEdgeCount,
}: GraphStatusBarProps) {
  const { totalGraphNodes, totalGraphEdges, currentView, pathMode } = useUnifiedGraphStore()

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-t border-bp-border text-[10px] text-bp-text-secondary bg-bp-card">
      <div className="flex items-center gap-4">
        <span className="tabular-nums">
          <CountUp end={totalGraphNodes} duration={1.5} separator="," preserveValue /> entities
        </span>
        <span className="text-bp-border">|</span>
        <span className="tabular-nums">
          <CountUp end={totalGraphEdges} duration={1.5} separator="," preserveValue /> relationships
        </span>
        <span className="text-bp-border">|</span>
        <span>
          Showing <span className="text-bp-text font-medium">{visibleNodeCount}</span> nodes,{' '}
          <span className="text-bp-text font-medium">{visibleEdgeCount}</span> edges
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Tag minimal className="text-[10px]">
          {currentView}
        </Tag>
        {pathMode && (
          <Tag intent={Intent.WARNING} minimal className="text-[10px]">
            Path: {pathMode.from ? 'select target' : 'select source'}
          </Tag>
        )}
      </div>
    </div>
  )
})

// ---------- GraphSidebar ----------

interface GraphSidebarProps {
  onExpandNode: (id: string) => void
  onCollapseNode: (id: string) => void
  onStartPath: (id: string) => void
}

const GraphSidebar = memo(function GraphSidebar({
  onExpandNode,
  onCollapseNode,
  onStartPath,
}: GraphSidebarProps) {
  const {
    selectedNodeId,
    nodes,
    edges,
    expandedNodes,
    sidebarOpen,
    setSidebarOpen,
    selectNode,
  } = useUnifiedGraphStore()

  const [detail, setDetail] = useState<GraphNodeDetailResponse | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Fetch node detail when selected
  useEffect(() => {
    if (!selectedNodeId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoadingDetail(true)
    apiGetNodeDetail(selectedNodeId)
      .then((r) => {
        if (!cancelled) setDetail(r.data)
      })
      .catch(() => {
        // Fallback: build detail from local store data matching flat response shape
        if (!cancelled) {
          const localNode = nodes.find((n) => n.data.id === selectedNodeId)
          if (localNode) {
            const localEdges = edges.filter(
              (e) => e.data.source === selectedNodeId || e.data.target === selectedNodeId
            )
            const nd = localNode.data
            setDetail({
              id: nd.id,
              node_type: nd.node_type,
              title: nd.label,
              district: nd.district,
              province: nd.province,
              latitude: nd.latitude,
              longitude: nd.longitude,
              properties: nd.properties as Record<string, unknown> ?? {},
              confidence: nd.confidence,
              source_count: 1,
              is_canonical: true,
              edges: localEdges.map((e) => ({
                id: e.data.id,
                predicate: e.data.predicate,
                direction: e.data.source === selectedNodeId ? 'outgoing' as const : 'incoming' as const,
                peer_id: e.data.source === selectedNodeId ? e.data.target : e.data.source,
                weight: e.data.weight,
                confidence: e.data.confidence,
                properties: e.data.properties as Record<string, unknown> ?? {},
              })),
              total_outgoing: localEdges.filter((e) => e.data.source === selectedNodeId).length,
              total_incoming: localEdges.filter((e) => e.data.target === selectedNodeId).length,
              metrics: [],
              resolutions: [],
            })
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedNodeId, nodes, edges])

  if (!sidebarOpen || !selectedNodeId) return null

  // Build a GraphNode-like data object from either the flat detail response or the local store
  const localNode = nodes.find((n) => n.data.id === selectedNodeId)
  const nd: GraphNodeData = detail
    ? {
        id: detail.id,
        label: detail.title,
        node_type: detail.node_type,
        canonical_key: detail.canonical_key ?? '',
        district: detail.district,
        province: detail.province,
        latitude: detail.latitude,
        longitude: detail.longitude,
        confidence: detail.confidence,
        properties: detail.properties as Record<string, unknown>,
        member_count: localNode?.data.member_count,
      }
    : localNode?.data ?? { id: selectedNodeId, label: '', node_type: '', canonical_key: '', confidence: 0, properties: {} }
  if (!nd.id) return null
  const config = NODE_TYPE_CONFIG[nd.node_type]
  const isExpanded = expandedNodes.has(nd.id)

  // Group edges by predicate -- normalize from flat EdgeDetail or Cytoscape GraphEdge
  const edgesByPredicate = useMemo(() => {
    const groups: Record<string, Array<{ id: string; predicate: string; peer_id?: string; direction?: string }>>  = {}
    if (detail?.edges && detail.edges.length > 0) {
      // From flat EdgeDetail response
      for (const e of detail.edges) {
        if (!groups[e.predicate]) groups[e.predicate] = []
        groups[e.predicate].push({ id: e.id, predicate: e.predicate, peer_id: e.peer_id, direction: e.direction })
      }
    } else {
      // Fallback: from local store Cytoscape edges
      const localEdges = edges.filter(
        (e) => e.data.source === nd.id || e.data.target === nd.id
      )
      for (const e of localEdges) {
        const p = e.data.predicate
        if (!groups[p]) groups[p] = []
        groups[p].push({ id: e.data.id, predicate: p })
      }
    }
    return groups
  }, [detail, edges, nd.id])

  return (
    <motion.div
      className="absolute top-0 right-0 w-[300px] h-full bg-bp-card/95 backdrop-blur-sm border-l border-bp-border shadow-lg z-20 flex flex-col"
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      exit={{ x: 300 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bp-border">
        <div className="flex items-center gap-2 min-w-0">
          {config && (
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: config.color }}
            />
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-bp-text truncate">{nd.label}</h3>
            <span className="text-[10px] text-bp-text-muted uppercase">{nd.node_type}</span>
          </div>
        </div>
        <Button
          minimal
          small
          icon={<X size={14} />}
          onClick={() => {
            selectNode(null)
            setSidebarOpen(false)
          }}
          aria-label="Close sidebar"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {loadingDetail ? (
          <div className="flex justify-center py-8">
            <Spinner size={20} intent={Intent.PRIMARY} />
          </div>
        ) : (
          <>
            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag minimal className="text-[10px]">{nd.node_type}</Tag>
              {nd.district && (
                <Tag intent={Intent.PRIMARY} minimal className="text-[10px]">
                  {nd.district}
                </Tag>
              )}
              {nd.is_hub && (
                <Tag intent={Intent.WARNING} minimal className="text-[10px]">
                  Hub
                </Tag>
              )}
              {nd.is_bridge && (
                <Tag className="text-[10px]" style={{ backgroundColor: '#06B6D4', color: '#fff' }}>
                  Bridge
                </Tag>
              )}
              <Tag minimal className="text-[10px]">
                Conf: {Math.round(nd.confidence * 100)}%
              </Tag>
            </div>

            {/* Metrics */}
            {(nd.degree !== undefined || nd.pagerank !== undefined) && (
              <div className="grid grid-cols-2 gap-2">
                {nd.degree !== undefined && (
                  <div className="bg-bp-surface rounded p-2">
                    <span className="text-[10px] text-bp-text-muted uppercase block">Degree</span>
                    <span className="text-sm font-semibold text-bp-text">{nd.degree}</span>
                  </div>
                )}
                {nd.pagerank !== undefined && (
                  <div className="bg-bp-surface rounded p-2">
                    <span className="text-[10px] text-bp-text-muted uppercase block">PageRank</span>
                    <span className="text-sm font-semibold text-bp-text">
                      {nd.pagerank.toFixed(4)}
                    </span>
                  </div>
                )}
                {nd.member_count !== undefined && nd.member_count > 0 && (
                  <div className="bg-bp-surface rounded p-2">
                    <span className="text-[10px] text-bp-text-muted uppercase block">Members</span>
                    <span className="text-sm font-semibold text-bp-text">
                      {nd.member_count.toLocaleString()}
                    </span>
                  </div>
                )}
                {detail && (detail.total_outgoing + detail.total_incoming) > 0 && (
                  <div className="bg-bp-surface rounded p-2">
                    <span className="text-[10px] text-bp-text-muted uppercase block">Neighbors</span>
                    <span className="text-sm font-semibold text-bp-text">
                      {(detail.total_outgoing + detail.total_incoming).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Properties table */}
            {nd.properties && Object.keys(nd.properties).length > 0 && (
              <div>
                <h4 className="text-[10px] text-bp-text-muted uppercase tracking-wider font-semibold mb-2">
                  Properties
                </h4>
                <div className="space-y-1">
                  {Object.entries(nd.properties).slice(0, 12).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-start justify-between gap-2 text-xs py-1 border-b border-bp-border/50"
                    >
                      <span className="text-bp-text-muted flex-shrink-0">{key}</span>
                      <span className="text-bp-text text-right truncate max-w-[160px]">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connected edges grouped by predicate */}
            {Object.keys(edgesByPredicate).length > 0 && (
              <div>
                <h4 className="text-[10px] text-bp-text-muted uppercase tracking-wider font-semibold mb-2">
                  Connections
                </h4>
                <div className="space-y-2">
                  {Object.entries(edgesByPredicate).map(([predicate, predicateEdges]) => (
                    <div key={predicate} className="bg-bp-surface rounded p-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="w-2 h-1 rounded-full"
                          style={{
                            backgroundColor:
                              PREDICATE_COLORS[predicate] ?? '#6B7280',
                          }}
                        />
                        <span className="text-[10px] text-bp-text-muted uppercase font-semibold">
                          {predicate.replace(/_/g, ' ')}
                        </span>
                        <Tag minimal className="text-[10px] ml-auto">
                          {predicateEdges.length}
                        </Tag>
                      </div>
                      <div className="space-y-0.5 max-h-24 overflow-y-auto">
                        {predicateEdges.slice(0, 8).map((e) => {
                          // peer_id comes from flat EdgeDetail; fallback unavailable for local edges
                          const targetId = e.peer_id ?? ''
                          const targetNode = targetId ? nodes.find((n) => n.data.id === targetId) : null
                          return (
                            <button
                              key={e.id}
                              className="block w-full text-left text-xs text-bp-text-secondary hover:text-bp-text truncate py-0.5 transition-colors"
                              onClick={() => targetId && selectNode(targetId)}
                            >
                              {targetNode?.data.label ?? targetId ?? e.predicate}
                            </button>
                          )
                        })}
                        {predicateEdges.length > 8 && (
                          <span className="text-[10px] text-bp-text-muted">
                            +{predicateEdges.length - 8} more
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Node ID */}
            <div>
              <h4 className="text-[10px] text-bp-text-muted uppercase tracking-wider font-semibold mb-1">
                Node ID
              </h4>
              <code className="text-[10px] bg-bp-surface border border-bp-border rounded px-2 py-1 break-all block text-bp-text-secondary">
                {nd.id}
              </code>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-2.5 border-t border-bp-border space-y-1.5">
        {isExpanded ? (
          <Button
            fill
            small
            intent={Intent.NONE}
            icon={<Shrink size={14} />}
            onClick={() => onCollapseNode(nd.id)}
          >
            Collapse
          </Button>
        ) : (
          <Button
            fill
            small
            intent={Intent.PRIMARY}
            icon={<Expand size={14} />}
            onClick={() => onExpandNode(nd.id)}
          >
            Expand Connections
          </Button>
        )}
        <Button
          fill
          small
          intent={Intent.NONE}
          icon={<Route size={14} />}
          onClick={() => onStartPath(nd.id)}
        >
          Find Path From Here
        </Button>
      </div>
    </motion.div>
  )
})

// ============================================================================
// Main Component
// ============================================================================

export default function UnifiedGraphExplorer() {
  const cyRef = useRef<cytoscape.Core | null>(null)
  const containerInitialized = useRef(false)

  const {
    nodes,
    edges,
    selectedNodeId,
    hoveredNodeId,
    expandedNodes,
    visibleNodeTypes,
    visiblePredicates,
    minConfidence,
    hideOrphans,
    pathMode,
    pathHighlightIds,
    sidebarOpen,
    setNodes,
    setEdges,
    addNodes,
    addEdges,
    setTotalCounts,
    selectNode,
    hoverNode,
    markExpanded,
    collapseNode,
    startPathMode,
    setPathTarget,
    setPathHighlight,
    endPathMode,
    setZoomLevel,
    setCurrentView,
    reset,
  } = useUnifiedGraphStore()

  // --------------------------------------------------------------------------
  // Data fetching
  // --------------------------------------------------------------------------

  const {
    data: overviewData,
    isLoading: overviewLoading,
    error: overviewError,
  } = useGraphOverview()

  const { data: statsData } = useGraphStats()

  // Load overview data into store on first fetch
  useEffect(() => {
    if (overviewData) {
      setNodes(overviewData.nodes)
      setEdges(overviewData.edges)
      setTotalCounts(
        overviewData.total_graph_nodes,
        overviewData.total_graph_edges
      )
      setCurrentView('overview')
    }
  }, [overviewData, setNodes, setEdges, setTotalCounts, setCurrentView])

  // Update total counts from stats if available
  useEffect(() => {
    if (statsData) {
      setTotalCounts(statsData.total_nodes, statsData.total_edges)
    }
  }, [statsData, setTotalCounts])

  // --------------------------------------------------------------------------
  // Filtered elements (memoized)
  // --------------------------------------------------------------------------

  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (!visibleNodeTypes.includes(n.data.node_type)) return false
      if (n.data.confidence < minConfidence) return false
      return true
    })
  }, [nodes, visibleNodeTypes, minConfidence])

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.data.id)),
    [filteredNodes]
  )

  const filteredEdges = useMemo(() => {
    return edges.filter((e) => {
      if (!filteredNodeIds.has(e.data.source) || !filteredNodeIds.has(e.data.target))
        return false
      if (!visiblePredicates.includes(e.data.predicate)) return false
      if (e.data.confidence < minConfidence) return false
      return true
    })
  }, [edges, filteredNodeIds, visiblePredicates, minConfidence])

  // Orphan removal
  const displayNodes = useMemo(() => {
    if (!hideOrphans) return filteredNodes

    const connectedIds = new Set<string>()
    for (const e of filteredEdges) {
      connectedIds.add(e.data.source)
      connectedIds.add(e.data.target)
    }
    // Always keep place nodes (districts/provinces)
    return filteredNodes.filter(
      (n) => connectedIds.has(n.data.id) || n.data.node_type === 'place'
    )
  }, [filteredNodes, filteredEdges, hideOrphans])

  const displayNodeIds = useMemo(
    () => new Set(displayNodes.map((n) => n.data.id)),
    [displayNodes]
  )

  const displayEdges = useMemo(() => {
    return filteredEdges.filter(
      (e) => displayNodeIds.has(e.data.source) && displayNodeIds.has(e.data.target)
    )
  }, [filteredEdges, displayNodeIds])

  // Convert to Cytoscape elements
  const cytoscapeElements = useMemo(() => {
    const nodeEls = displayNodes.map((n) => ({
      data: {
        ...n.data,
        // Ensure defaults for mapData to work
        member_count: n.data.member_count ?? 0,
        pagerank: n.data.pagerank ?? 0,
        degree: n.data.degree ?? 0,
      },
    }))
    const edgeEls = displayEdges.map((e) => ({
      data: { ...e.data },
    }))
    return [...nodeEls, ...edgeEls]
  }, [displayNodes, displayEdges])

  // --------------------------------------------------------------------------
  // Node expansion
  // --------------------------------------------------------------------------

  const handleExpandNode = useCallback(
    async (nodeId: string) => {
      try {
        const limit = 50
        const response = await apiExpandNode(nodeId, { limit })
        const expandData: GraphExpandResponse = response.data
        addNodes(expandData.nodes)
        addEdges(expandData.edges)
        markExpanded(nodeId)
      } catch (err) {
        console.error('Failed to expand node:', err)
      }
    },
    [addNodes, addEdges, markExpanded]
  )

  const handleCollapseNode = useCallback(
    (nodeId: string) => {
      collapseNode(nodeId)
    },
    [collapseNode]
  )

  // --------------------------------------------------------------------------
  // Path finding
  // --------------------------------------------------------------------------

  const handleTogglePathMode = useCallback(() => {
    if (pathMode) {
      endPathMode()
      // Remove path-highlight classes from cytoscape
      cyRef.current?.elements().removeClass('path-highlight')
    } else if (selectedNodeId) {
      startPathMode(selectedNodeId)
    } else {
      // Need to select a source node first
      startPathMode('')
    }
  }, [pathMode, selectedNodeId, startPathMode, endPathMode])

  const executeFindPath = useCallback(
    async (from: string, to: string) => {
      try {
        const response = await apiFindPath(from, to, 5)
        const pathData: GraphPathResponse = response.data

        if (!pathData.found || pathData.path.length === 0) {
          console.warn('No path found between nodes')
          return
        }

        // Path response returns UUID arrays -- nodes are already in graph from prior expansion.
        // Use the path node IDs for highlighting.
        const highlightIds = pathData.path
        setPathHighlight(highlightIds)

        // Apply path-highlight class in cytoscape
        const cy = cyRef.current
        if (cy) {
          cy.elements().removeClass('path-highlight')
          for (const id of highlightIds) {
            cy.getElementById(id).addClass('path-highlight')
          }
          // Highlight edges between consecutive path nodes
          for (let i = 0; i < highlightIds.length - 1; i++) {
            const src = highlightIds[i]
            const tgt = highlightIds[i + 1]
            cy.edges().forEach((edge) => {
              const es = edge.data('source')
              const et = edge.data('target')
              if (
                (es === src && et === tgt) ||
                (es === tgt && et === src)
              ) {
                edge.addClass('path-highlight')
              }
            })
          }
        }
      } catch (err) {
        console.error('Path finding failed:', err)
      }
    },
    [setPathHighlight]
  )

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  const handleSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) return
      try {
        const response = await apiSearchGraph(q, { limit: 20 })
        const searchData: GraphSearchResponse = response.data

        // Add search results to graph (merge) -- search returns nodes only, no edges
        addNodes(searchData.nodes)

        // Highlight search results in cytoscape
        const cy = cyRef.current
        if (cy) {
          const matchIds = new Set(searchData.nodes.map((n) => n.data.id))
          cy.elements().removeClass('dimmed highlighted')
          cy.elements().addClass('dimmed')
          cy.nodes().forEach((node) => {
            if (matchIds.has(node.id())) {
              node.removeClass('dimmed')
              node.addClass('highlighted')
              node.connectedEdges().removeClass('dimmed')
              node.connectedEdges().connectedNodes().removeClass('dimmed')
            }
          })
          // Fit to matched nodes
          const matched = cy.nodes().filter((n) => matchIds.has(n.id()))
          if (matched.length > 0) {
            cy.animate(
              { fit: { eles: matched, padding: 80 } },
              { duration: 400 }
            )
          }
        }
      } catch (err) {
        console.error('Search failed:', err)
      }
    },
    [addNodes]
  )

  // --------------------------------------------------------------------------
  // Cytoscape init handler
  // --------------------------------------------------------------------------

  const handleCyInit = useCallback(
    (cy: cytoscape.Core) => {
      // Avoid re-initializing handlers if already done
      if (containerInitialized.current && cyRef.current === cy) return
      cyRef.current = cy
      containerInitialized.current = true

      // Run layout
      cy.layout(LAYOUT_OPTIONS as cytoscape.LayoutOptions).run()

      // Mark expanded nodes
      expandedNodes.forEach((id) => {
        cy.getElementById(id).addClass('expanded')
      })

      // ---------- Events ----------

      // Node click
      cy.on('tap', 'node', (evt) => {
        const node = evt.target
        const nodeId = node.id()

        // Path mode: set source or target
        const currentPathMode = useUnifiedGraphStore.getState().pathMode
        if (currentPathMode) {
          if (!currentPathMode.from) {
            startPathMode(nodeId)
          } else if (!currentPathMode.to) {
            setPathTarget(nodeId)
            executeFindPath(currentPathMode.from, nodeId)
          }
          return
        }

        selectNode(nodeId)
      })

      // Double-click for expand
      cy.on('dbltap', 'node', (evt) => {
        const nodeId = evt.target.id()
        const isAlreadyExpanded = useUnifiedGraphStore.getState().expandedNodes.has(nodeId)
        if (!isAlreadyExpanded) {
          handleExpandNode(nodeId)
        }
      })

      // Hover: highlight node + connected edges
      cy.on('mouseover', 'node', (evt) => {
        const node = evt.target
        hoverNode(node.id())

        // Dim everything, highlight neighborhood
        cy.elements().addClass('dimmed')
        node.removeClass('dimmed').addClass('highlighted')
        node.connectedEdges().removeClass('dimmed')
        node.connectedEdges().connectedNodes().removeClass('dimmed').addClass('highlighted')
      })

      cy.on('mouseout', 'node', () => {
        hoverNode(null)
        cy.elements().removeClass('dimmed highlighted')
      })

      // Background click: deselect
      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          selectNode(null)
          cy.elements().removeClass('dimmed highlighted path-highlight')
          // If search query is active, re-highlight
          const sq = useUnifiedGraphStore.getState().searchQuery
          if (sq) {
            // Clear dimming only
            cy.elements().removeClass('dimmed highlighted')
          }
        }
      })

      // Zoom tracking
      cy.on('zoom', () => {
        const zoom = cy.zoom()
        setZoomLevel(zoom)

        // Show labels on story nodes when zoomed in
        const threshold = 1.5
        if (zoom > threshold) {
          cy.$('node[node_type="story"]').addClass('show-label')
        } else {
          cy.$('node[node_type="story"]').removeClass('show-label')
        }
      })
    },
    [
      expandedNodes,
      selectNode,
      hoverNode,
      handleExpandNode,
      setZoomLevel,
      startPathMode,
      setPathTarget,
      executeFindPath,
    ]
  )

  // --------------------------------------------------------------------------
  // Toolbar handlers
  // --------------------------------------------------------------------------

  const handleZoomIn = useCallback(() => {
    cyRef.current?.zoom(cyRef.current.zoom() * 1.2)
  }, [])

  const handleZoomOut = useCallback(() => {
    cyRef.current?.zoom(cyRef.current.zoom() / 1.2)
  }, [])

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 50)
  }, [])

  const handleReset = useCallback(() => {
    reset()
    containerInitialized.current = false
  }, [reset])

  const handleExport = useCallback(() => {
    if (!cyRef.current) return
    const png = cyRef.current.png({ full: true, scale: 2, bg: '#111418' })
    const link = document.createElement('a')
    link.href = png
    link.download = 'unified-graph.png'
    link.click()
  }, [])

  const handleStartPathFromSidebar = useCallback(
    (nodeId: string) => {
      startPathMode(nodeId)
    },
    [startPathMode]
  )

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const errorMessage = overviewError instanceof Error ? overviewError.message : overviewError ? String(overviewError) : null

  return (
    <div className="flex flex-col h-full bg-bp-bg">
      {/* Toolbar */}
      <GraphToolbar
        onSearch={handleSearch}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onReset={handleReset}
        onExport={handleExport}
        isPathMode={!!pathMode}
        onTogglePathMode={handleTogglePathMode}
      />

      {/* Graph + Sidebar */}
      <div className="flex-1 min-h-0 relative">
        {overviewLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bp-bg">
            <Spinner size={32} intent={Intent.PRIMARY} />
            <p className="text-sm text-bp-text-secondary">Loading unified graph...</p>
            {/* Skeleton placeholders */}
            <div className="flex gap-3 mt-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="w-16 h-16 bg-bp-surface rounded-lg animate-pulse"
                  style={{ animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>
          </div>
        ) : errorMessage ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bp-bg">
            <AlertTriangle size={32} className="text-bp-danger" />
            <p className="text-sm text-bp-danger">{errorMessage}</p>
            <Button
              intent={Intent.PRIMARY}
              small
              onClick={handleReset}
            >
              Retry
            </Button>
          </div>
        ) : cytoscapeElements.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bp-bg">
            <Activity size={32} className="text-bp-text-muted" />
            <p className="text-sm text-bp-text-secondary">
              No graph data. The unified graph may not be populated yet.
            </p>
          </div>
        ) : (
          <>
            <CytoscapeComponent
              elements={cytoscapeElements}
              stylesheet={CYTOSCAPE_STYLE}
              style={{ width: '100%', height: '100%' }}
              cy={handleCyInit}
              wheelSensitivity={0.2}
            />

            {/* Legend */}
            <GraphLegend />

            {/* Path mode overlay */}
            <AnimatePresence>
              {pathMode && (
                <motion.div
                  className="absolute top-3 left-1/2 -translate-x-1/2 bg-bp-card/95 backdrop-blur-sm border border-bp-warning rounded-lg px-4 py-2 z-20 flex items-center gap-3"
                  initial={{ y: -20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -20, opacity: 0 }}
                >
                  <Route size={16} className="text-bp-warning" />
                  <span className="text-sm text-bp-text">
                    {!pathMode.from
                      ? 'Click a source node'
                      : !pathMode.to
                      ? 'Click a target node'
                      : 'Path found!'}
                  </span>
                  <Button
                    minimal
                    small
                    icon={<X size={14} />}
                    onClick={() => {
                      endPathMode()
                      cyRef.current?.elements().removeClass('path-highlight')
                    }}
                    aria-label="Cancel path mode"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sidebar toggle when collapsed */}
            {selectedNodeId && !sidebarOpen && (
              <Button
                className="absolute top-3 right-3 z-20"
                small
                icon={<ChevronLeft size={14} />}
                onClick={() => useUnifiedGraphStore.getState().setSidebarOpen(true)}
                aria-label="Open sidebar"
              >
                Details
              </Button>
            )}
          </>
        )}

        {/* Sidebar */}
        <AnimatePresence>
          {sidebarOpen && selectedNodeId && (
            <GraphSidebar
              onExpandNode={handleExpandNode}
              onCollapseNode={handleCollapseNode}
              onStartPath={handleStartPathFromSidebar}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Status Bar */}
      <GraphStatusBar
        visibleNodeCount={displayNodes.length}
        visibleEdgeCount={displayEdges.length}
      />
    </div>
  )
}
