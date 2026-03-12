import { useEffect, useRef, useCallback, useMemo } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import { useQuery } from '@tanstack/react-query'
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RefreshCw,
  Filter,
  Download,
  Layers,
} from 'lucide-react'
import { Button, Spinner, Intent } from '@blueprintjs/core'
import {
  getCombinedGraph,
  getGraphMetadata,
  type MultiLayerGraphResponse,
  type GraphLayer,
} from '../../api/multiLayerGraph'
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore'
import GraphFilterPanel from './GraphFilterPanel'

// ============================================================================
// Types
// ============================================================================

interface UnifiedGraphPanelProps {
  className?: string
}

// ============================================================================
// Layer Colors (for indicator dots)
// ============================================================================

const LAYER_COLORS: Record<string, string> = {
  geographic: 'bg-sky-500',
  trade: 'bg-teal-500',
  entity: 'bg-indigo-500',
  news: 'bg-purple-500',
  disaster: 'bg-red-500',
}

// ============================================================================
// Dynamic Legend Items (per layer)
// ============================================================================

const LEGEND_ITEMS: Record<string, Array<{ type: string; label: string; color: string; shape: string }>> = {
  geographic: [
    { type: 'nepal', label: 'Nepal', color: 'bg-red-600', shape: 'star' },
    { type: 'province', label: 'Province', color: 'bg-sky-500', shape: 'rounded' },
    { type: 'district', label: 'District', color: 'bg-pink-500', shape: 'rounded' },
  ],
  trade: [
    { type: 'partner_country', label: 'Country', color: 'bg-teal-500', shape: 'octagon' },
    { type: 'hs_chapter', label: 'HS Chapter', color: 'bg-yellow-500', shape: 'rounded' },
    { type: 'customs_office', label: 'Customs', color: 'bg-orange-500', shape: 'pentagon' },
  ],
  entity: [
    { type: 'person', label: 'Person', color: 'bg-indigo-500', shape: 'circle' },
    { type: 'party', label: 'Party', color: 'bg-green-500', shape: 'hexagon' },
    { type: 'organization', label: 'Organization', color: 'bg-orange-500', shape: 'rounded' },
    { type: 'institution', label: 'Institution', color: 'bg-cyan-500', shape: 'diamond' },
    { type: 'government', label: 'Government', color: 'bg-emerald-600', shape: 'diamond' },
  ],
  news: [
    { type: 'story', label: 'Story', color: 'bg-purple-500', shape: 'rounded' },
  ],
  disaster: [
    { type: 'disaster_incident', label: 'Disaster', color: 'bg-red-500', shape: 'vee' },
    { type: 'hazard_type', label: 'Hazard Hub', color: 'bg-amber-500', shape: 'triangle' },
  ],
}

// ============================================================================
// Cytoscape Stylesheet (30+ selectors for multi-layer graph)
// ============================================================================

const CYTOSCAPE_STYLE: cytoscape.StylesheetCSS[] = [
  // ===== NODES =====
  // Base node
  {
    selector: 'node',
    style: {
      'background-color': '#4f46e5',
      label: 'data(label)',
      'font-size': '8px',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 4,
      color: '#a1a1aa',
      'text-max-width': '70px',
      'text-wrap': 'ellipsis',
      width: 20,
      height: 20,
      'background-opacity': 0.9,
    },
  },
  // Nepal central star — always large
  {
    selector: 'node[type="nepal"]',
    style: {
      'background-color': '#dc2626',
      shape: 'star',
      width: 65,
      height: 65,
      'font-size': '12px',
      'font-weight': 'bold',
      color: '#fbbf24',
      'border-width': 3,
      'border-color': '#fbbf24',
    },
  },
  // Province — medium-large
  {
    selector: 'node[type="province"]',
    style: {
      'background-color': '#0ea5e9',
      shape: 'round-rectangle',
      width: 38,
      height: 38,
      'font-size': '9px',
      'font-weight': 'bold',
      'border-width': 2,
      'border-color': '#38bdf8',
    },
  },
  // District
  {
    selector: 'node[type="district"]',
    style: {
      'background-color': '#ec4899',
      shape: 'round-rectangle',
      width: 25,
      height: 25,
    },
  },
  // Constituency — small, labels hidden (too many)
  {
    selector: 'node[type="constituency"]',
    style: {
      'background-color': '#8b5cf6',
      shape: 'round-rectangle',
      width: 18,
      height: 18,
      label: '',
    },
  },
  // Person — PROPORTIONAL by pagerank (normalized 0-1), label scales with importance
  {
    selector: 'node[type="person"]',
    style: {
      'background-color': '#4f46e5',
      shape: 'ellipse',
      width: 'mapData(pagerank, 0, 1, 15, 55)',
      height: 'mapData(pagerank, 0, 1, 15, 55)',
      'font-size': 'mapData(pagerank, 0, 1, 0, 9)',
    },
  },
  // Party — sized by connected members (medium)
  {
    selector: 'node[type="party"]',
    style: {
      'background-color': '#22c55e',
      shape: 'hexagon',
      width: 35,
      height: 35,
      'font-size': '9px',
      'font-weight': 'bold',
      'border-width': 2,
      'border-color': '#4ade80',
    },
  },
  // Organization (contractors) — PROPORTIONAL by contract amount (top ~56M NPR)
  {
    selector: 'node[type="organization"]',
    style: {
      'background-color': '#f97316',
      shape: 'rectangle',
      width: 'mapData(totalContractAmount, 0, 60000000, 16, 45)',
      height: 'mapData(totalContractAmount, 0, 60000000, 16, 45)',
    },
  },
  // Institution
  {
    selector: 'node[type="institution"]',
    style: {
      'background-color': '#06b6d4',
      shape: 'diamond',
      width: 22,
      height: 22,
    },
  },
  // Government (procuring entities) — medium-large
  {
    selector: 'node[type="government"]',
    style: {
      'background-color': '#059669',
      shape: 'diamond',
      width: 35,
      height: 35,
      'font-size': '9px',
      'font-weight': 'bold',
      'border-width': 2,
      'border-color': '#34d399',
    },
  },
  // Partner country — PROPORTIONAL by trade value (NPR thousands — India ~1.5B, China ~500M)
  {
    selector: 'node[type="partner_country"]',
    style: {
      'background-color': '#14b8a6',
      shape: 'octagon',
      width: 'mapData(tradeValue, 0, 1500000000, 16, 75)',
      height: 'mapData(tradeValue, 0, 1500000000, 16, 75)',
      'font-size': 'mapData(tradeValue, 0, 1500000000, 7, 12)',
    },
  },
  // HS Chapter — PROPORTIONAL by trade value
  {
    selector: 'node[type="hs_chapter"]',
    style: {
      'background-color': '#eab308',
      shape: 'round-rectangle',
      width: 'mapData(tradeValue, 0, 400000000, 14, 50)',
      height: 'mapData(tradeValue, 0, 400000000, 14, 50)',
    },
  },
  // Customs office — PROPORTIONAL by trade value (Birgunj ~1.2B)
  {
    selector: 'node[type="customs_office"]',
    style: {
      'background-color': '#f97316',
      shape: 'pentagon',
      width: 'mapData(tradeValue, 0, 1200000000, 14, 50)',
      height: 'mapData(tradeValue, 0, 1200000000, 14, 50)',
    },
  },
  // Disaster incident — PROPORTIONAL by impact (deaths + injured), labels hidden by default
  {
    selector: 'node[type="disaster_incident"]',
    style: {
      'background-color': '#ef4444',
      shape: 'vee',
      width: 'mapData(impactScore, 0, 100, 12, 45)',
      height: 'mapData(impactScore, 0, 100, 12, 45)',
      label: '',
    },
  },
  // Show label for high-impact disasters
  {
    selector: 'node[type="disaster_incident"][impactScore > 20]',
    style: {
      label: 'data(label)',
    },
  },
  // Hazard type — medium
  {
    selector: 'node[type="hazard_type"]',
    style: {
      'background-color': '#f59e0b',
      shape: 'triangle',
      width: 30,
      height: 30,
      'font-size': '9px',
      'font-weight': 'bold',
    },
  },
  // Story nodes — small, labels hidden by default
  {
    selector: 'node[type="story"]',
    style: {
      'background-color': '#6366f1',
      shape: 'round-rectangle',
      width: 14,
      height: 14,
      label: '',
    },
  },
  {
    selector: 'node[type="story"][category="economic"]',
    style: { 'background-color': '#06b6d4' },
  },
  {
    selector: 'node[type="story"][category="security"]',
    style: { 'background-color': '#ef4444' },
  },
  {
    selector: 'node[type="story"][category="disaster"]',
    style: { 'background-color': '#f59e0b' },
  },
  {
    selector: 'node[type="story"][category="social"]',
    style: { 'background-color': '#22c55e' },
  },
  // Hub/Bridge indicators
  {
    selector: 'node[?isHub]',
    style: { 'border-width': 3, 'border-color': '#a855f7' },
  },
  {
    selector: 'node[?isBridge]',
    style: { 'border-width': 3, 'border-color': '#06b6d4' },
  },
  // Expanded node indicator
  {
    selector: 'node[?isExpanded]',
    style: { 'border-width': 3, 'border-color': '#fbbf24', 'border-style': 'dashed' },
  },
  // ===== EDGES =====
  // Base edge
  {
    selector: 'edge',
    style: {
      width: 1,
      'line-color': '#3f3f46',
      'curve-style': 'bezier',
      opacity: 0.4,
      'target-arrow-shape': 'none',
      'font-size': '6px',
      color: '#71717a',
    },
  },
  // Geographic edges
  {
    selector: 'edge[edgeType="HAS_PROVINCE"]',
    style: { 'line-color': '#0ea5e9', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#0ea5e9', width: 2, opacity: 0.6 },
  },
  {
    selector: 'edge[edgeType="HAS_DISTRICT"]',
    style: { 'line-color': '#ec4899', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#ec4899', width: 1.5, opacity: 0.5 },
  },
  {
    selector: 'edge[edgeType="HAS_CONSTITUENCY"]',
    style: { 'line-color': '#8b5cf6', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#8b5cf6', width: 1, opacity: 0.4 },
  },
  {
    selector: 'edge[edgeType="CUSTOMS_IN_DISTRICT"]',
    style: { 'line-color': '#f97316', 'line-style': 'dotted', width: 1, opacity: 0.4 },
  },
  // Trade edges — PROPORTIONAL width by value (India imports ~1.5B NPR thousands)
  {
    selector: 'edge[edgeType="IMPORTS_FROM"]',
    style: {
      'line-color': '#ef4444',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#ef4444',
      width: 'mapData(weight, 0, 1500000000, 1, 12)',
      opacity: 0.7,
    },
  },
  {
    selector: 'edge[edgeType="EXPORTS_TO"]',
    style: {
      'line-color': '#22c55e',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#22c55e',
      width: 'mapData(weight, 0, 1500000000, 1, 12)',
      opacity: 0.7,
    },
  },
  {
    selector: 'edge[edgeType="TRADES_COMMODITY"]',
    style: { 'line-color': '#eab308', 'line-style': 'dashed', width: 1, opacity: 0.4 },
  },
  {
    selector: 'edge[edgeType="HAS_CUSTOMS"]',
    style: { 'line-color': '#6b7280', 'line-style': 'dashed', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#6b7280', width: 1, opacity: 0.4 },
  },
  {
    selector: 'edge[edgeType="CUSTOMS_IMPORTS"]',
    style: { 'line-color': '#f97316', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#f97316', width: 1.5, opacity: 0.5 },
  },
  {
    selector: 'edge[edgeType="CUSTOMS_EXPORTS"]',
    style: { 'line-color': '#22c55e', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#22c55e', width: 1.5, 'line-style': 'dashed', opacity: 0.5 },
  },
  // Entity edges
  {
    selector: 'edge[edgeType="PARTY_MEMBER"]',
    style: { 'line-color': '#22c55e', width: 1, opacity: 0.35 },
  },
  {
    selector: 'edge[edgeType="FORMER_PARTY_MEMBER"]',
    style: { 'line-color': '#f59e0b', 'line-style': 'dashed', width: 1.5, opacity: 0.6, label: 'switched' },
  },
  {
    selector: 'edge[edgeType="RAN_IN"]',
    style: { 'line-color': '#8b5cf6', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#8b5cf6', width: 1, opacity: 0.4 },
  },
  {
    selector: 'edge[edgeType="OPPONENT"]',
    style: { 'line-color': '#f43f5e', 'line-style': 'dotted', width: 0.8, opacity: 0.3 },
  },
  {
    selector: 'edge[edgeType="WAS_PM"]',
    style: { 'line-color': '#dc2626', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#dc2626', width: 3.5, opacity: 0.8, label: 'data(label)' },
  },
  {
    selector: 'edge[edgeType="WAS_MINISTER_OF"]',
    style: { 'line-color': '#f59e0b', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#f59e0b', width: 2, opacity: 0.6, label: 'data(label)' },
  },
  {
    selector: 'edge[edgeType="IS_MP"]',
    style: { 'line-color': '#3b82f6', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#3b82f6', width: 2, opacity: 0.6 },
  },
  {
    selector: 'edge[edgeType="REPRESENTS"]',
    style: { 'line-color': '#8b5cf6', 'line-style': 'dashed', width: 1, opacity: 0.4 },
  },
  {
    selector: 'edge[edgeType="CO_MENTION"]',
    style: { 'line-color': '#6366f1', width: 'mapData(weight, 0, 1, 1, 5)', opacity: 0.6 },
  },
  {
    selector: 'edge[edgeType="POLITICAL_ALLY"]',
    style: { 'line-color': '#22c55e', width: 1.5, opacity: 0.5 },
  },
  {
    selector: 'edge[edgeType="POLITICAL_OPPONENT"]',
    style: { 'line-color': '#f43f5e', width: 1.5, opacity: 0.5 },
  },
  // News edges
  {
    selector: 'edge[edgeType="CO_MENTIONED_IN"]',
    style: { 'line-color': '#a855f7', width: 'mapData(weight, 0, 1, 1, 4)', opacity: 0.5 },
  },
  {
    selector: 'edge[edgeType="MENTIONED_IN"]',
    style: { 'line-color': '#a855f7', 'line-style': 'dashed', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#a855f7', width: 1, opacity: 0.4 },
  },
  {
    selector: 'edge[edgeType="STORY_IN_DISTRICT"]',
    style: { 'line-color': '#d946ef', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#d946ef', width: 1, opacity: 0.4 },
  },
  // Procurement edges
  {
    selector: 'edge[edgeType="AWARDED_CONTRACT"]',
    style: { 'line-color': '#f59e0b', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#f59e0b', width: 2, 'line-style': 'dashed', opacity: 0.6 },
  },
  {
    selector: 'edge[edgeType="OPERATES_IN"]',
    style: { 'line-color': '#6b7280', 'line-style': 'dotted', width: 1, opacity: 0.3 },
  },
  // Disaster edges
  {
    selector: 'edge[edgeType="DISASTER_IN"]',
    style: { 'line-color': '#ef4444', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#ef4444', width: 2, opacity: 0.6 },
  },
  {
    selector: 'edge[edgeType="DISASTER_IN_PROVINCE"]',
    style: { 'line-color': '#f97316', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#f97316', width: 1.5, 'line-style': 'dashed', opacity: 0.5 },
  },
  {
    selector: 'edge[edgeType="IS_HAZARD_TYPE"]',
    style: { 'line-color': '#f59e0b', width: 1, opacity: 0.3 },
  },
  // Show label on selected nodes (disaster/story/constituency)
  {
    selector: 'node:selected',
    style: { label: 'data(label)', 'border-width': 4, 'border-color': '#ef4444' },
  },
  // Selected edge
  {
    selector: 'edge:selected',
    style: { 'line-color': '#ef4444', opacity: 1, width: 3 },
  },
] as any

// ============================================================================
// Component
// ============================================================================

export function UnifiedGraphPanel({ className = '' }: UnifiedGraphPanelProps) {
  const {
    activeLayers,
    layerConfigs,
    expandedCountry,
    expandedHsChapter,
    visibleEdgeTypes,
    visibleNodeTypes,
    graphFilterOpen,
    graphSearchQuery,
    hideOrphans,
    selectEntity,
    selectObject,
    setExpandedCountry,
    setExpandedHsChapter,
    toggleGraphFilter,
  } = useConnectedAnalystStore()

  const cyRef = useRef<cytoscape.Core | null>(null)

  // --------------------------------------------------------------------------
  // Data Fetching: combined multi-layer graph
  // --------------------------------------------------------------------------

  const { data: graphData, isLoading, error, refetch } = useQuery({
    queryKey: ['multi-layer-graph', activeLayers, layerConfigs, expandedCountry, expandedHsChapter],
    queryFn: () =>
      getCombinedGraph({
        layers: activeLayers,
        fiscal_year_bs: layerConfigs.trade.fiscal_year_bs ?? undefined,
        direction: layerConfigs.trade.direction ?? undefined,
        top_countries: layerConfigs.trade.top_countries,
        window: layerConfigs.entity.window,
        min_strength: layerConfigs.entity.min_strength,
        limit_nodes: layerConfigs.entity.limit_nodes,
        include_parties: layerConfigs.entity.include_parties,
        include_constituencies: layerConfigs.entity.include_constituencies,
        include_ministerial: layerConfigs.entity.include_ministerial,
        include_opponents: layerConfigs.entity.include_opponents,
        include_geographic: layerConfigs.entity.include_geographic,
        expand_province_id: layerConfigs.geographic.expand_province_id ?? undefined,
        expand_district: layerConfigs.geographic.expand_district ?? undefined,
        news_hours: layerConfigs.news.hours,
        min_co_mentions: layerConfigs.news.min_co_mentions,
        disaster_days: layerConfigs.disaster.days,
        election_year_bs: layerConfigs.entity.election_year_bs ?? undefined,
      }),
    staleTime: 60_000,
    enabled: activeLayers.length > 0,
  })

  // Metadata for filter dropdowns (fiscal years, election years)
  const { data: metadata } = useQuery({
    queryKey: ['graph-metadata'],
    queryFn: getGraphMetadata,
    staleTime: 300_000,
  })

  // --------------------------------------------------------------------------
  // Element Filtering: client-side edge/node type filtering
  // --------------------------------------------------------------------------

  const elements = useMemo(() => {
    if (!graphData) return []

    const { nodes, edges } = graphData.elements

    // Filter by visible node types (empty = show all)
    const filteredNodes =
      visibleNodeTypes.length > 0
        ? nodes.filter((n) => visibleNodeTypes.includes(n.data.type))
        : nodes

    // Filter by visible edge types (empty = show all)
    const filteredEdges =
      visibleEdgeTypes.length > 0
        ? edges.filter((e) => visibleEdgeTypes.includes(e.data.edgeType))
        : edges

    // Only include edges whose source and target are in filtered nodes
    const nodeIds = new Set(filteredNodes.map((n) => n.data.id))
    const validEdges = filteredEdges.filter(
      (e) => nodeIds.has(e.data.source) && nodeIds.has(e.data.target)
    )

    // Orphan filtering: remove degree-0 nodes (except hub types)
    if (hideOrphans) {
      const connectedIds = new Set<string>()
      for (const e of validEdges) {
        connectedIds.add(e.data.source)
        connectedIds.add(e.data.target)
      }
      const hubTypes = new Set(['nepal', 'hazard_type', 'government'])
      const connectedNodes = filteredNodes.filter(
        (n) => connectedIds.has(n.data.id) || hubTypes.has(n.data.type)
      )
      return [...connectedNodes, ...validEdges]
    }

    return [...filteredNodes, ...validEdges]
  }, [graphData, visibleEdgeTypes, visibleNodeTypes, hideOrphans])

  // --------------------------------------------------------------------------
  // Graph Search: highlight/focus matched nodes
  // --------------------------------------------------------------------------

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !graphSearchQuery) {
      cy?.elements().style({ opacity: 1 })
      return
    }

    const q = graphSearchQuery.toLowerCase()
    const matched = cy.nodes().filter((node) => {
      const label = (node.data('label') || '').toLowerCase()
      const id = (node.data('id') || '').toLowerCase()
      return label.includes(q) || id.includes(q)
    })

    if (matched.length > 0) {
      cy.elements().style({ opacity: 0.15 })
      matched.style({ opacity: 1 })
      matched.connectedEdges().style({ opacity: 0.6 })
      matched.connectedEdges().connectedNodes().style({ opacity: 0.6 })
      cy.animate({ fit: { eles: matched, padding: 80 } }, { duration: 300 })
    }
  }, [graphSearchQuery])

  // --------------------------------------------------------------------------
  // Cytoscape Init + Event Handlers
  // --------------------------------------------------------------------------

  const handleCyInit = useCallback(
    (cy: cytoscape.Core) => {
      cyRef.current = cy

      // Layout — tuned for large multi-layer graphs
      cy.layout({
        name: 'fcose',
        animate: true,
        animationDuration: 800,
        randomize: true,
        nodeDimensionsIncludeLabels: false,
        idealEdgeLength: 180,
        nodeRepulsion: 15000,
        edgeElasticity: 0.1,
        gravity: 0.15,
        gravityRange: 2.5,
        nestingFactor: 0.1,
        numIter: 5000,
        tile: true,
        tilingPaddingVertical: 30,
        tilingPaddingHorizontal: 30,
      } as any).run()

      // Zoom-based label reveal: show all labels when zoomed in past 1.5
      cy.on('zoom', () => {
        const zoom = cy.zoom()
        const hiddenLabelTypes = 'node[type="disaster_incident"], node[type="story"], node[type="constituency"]'
        if (zoom > 1.5) {
          cy.$(hiddenLabelTypes).style({ label: 'data(label)' })
        } else {
          cy.$('node[type="story"]').style({ label: '' })
          cy.$('node[type="constituency"]').style({ label: '' })
          // Re-show high-impact disasters only
          cy.$('node[type="disaster_incident"]').style({ label: '' })
          cy.$('node[type="disaster_incident"][impactScore > 20]').style({ label: 'data(label)' })
        }
      })

      // Node tap handler
      cy.on('tap', 'node', (evt) => {
        const node = evt.target
        const nodeType = node.data('type')
        const nodeId = node.data('id')

        switch (nodeType) {
          case 'person':
          case 'organization':
          case 'institution': {
            // Select entity for right panel profile
            const entityUuid = nodeId.replace('entity:', '')
            selectEntity(entityUuid)
            break
          }

          case 'partner_country': {
            // Drill-down: expand HS chapters for this country
            const country = nodeId.replace('country:', '')
            setExpandedCountry(country === expandedCountry ? null : country)
            break
          }

          case 'hs_chapter': {
            // Drill-down: expand countries for this chapter
            const chapter = nodeId.replace('hs:', '')
            setExpandedHsChapter(chapter === expandedHsChapter ? null : chapter)
            break
          }

          case 'party': {
            // Highlight all members of this party
            const partyId = nodeId
            cy.elements().style({ opacity: 0.15 })
            const partyNode = cy.$(`#${CSS.escape(partyId)}`)
            partyNode.style({ opacity: 1 })
            partyNode.connectedEdges().style({ opacity: 0.8 })
            partyNode.connectedEdges().connectedNodes().style({ opacity: 1 })
            break
          }

          case 'province':
          case 'district':
          case 'constituency':
            // Highlight neighborhood
            cy.elements().style({ opacity: 0.15 })
            node.style({ opacity: 1 })
            node.connectedEdges().style({ opacity: 0.8 })
            node.connectedEdges().connectedNodes().style({ opacity: 1 })
            break

          case 'story': {
            // Could open story in right panel
            break
          }

          default:
            break
        }
      })

      // Background click: reset
      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          selectEntity(null)
          selectObject(null)
          setExpandedCountry(null)
          setExpandedHsChapter(null)
          cy.elements().style({ opacity: 1 })
        }
      })
    },
    [selectEntity, selectObject, expandedCountry, expandedHsChapter, setExpandedCountry, setExpandedHsChapter]
  )

  // --------------------------------------------------------------------------
  // Toolbar Handlers
  // --------------------------------------------------------------------------

  const handleZoomIn = () => {
    cyRef.current?.zoom(cyRef.current.zoom() * 1.2)
  }

  const handleZoomOut = () => {
    cyRef.current?.zoom(cyRef.current.zoom() / 1.2)
  }

  const handleFit = () => {
    cyRef.current?.fit(undefined, 50)
  }

  const handleRefresh = () => {
    refetch()
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
    link.download = 'unified-graph.png'
    link.click()
  }

  // --------------------------------------------------------------------------
  // Dynamic legend based on active layers
  // --------------------------------------------------------------------------

  const legendItems = useMemo(() => {
    const items: Array<{ type: string; label: string; color: string; shape: string }> = []
    for (const layer of activeLayers) {
      const layerItems = LEGEND_ITEMS[layer]
      if (layerItems) {
        items.push(...layerItems)
      }
    }
    return items
  }, [activeLayers])

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : null

  return (
    <div
      className={`flex flex-col h-full bg-bp-bg border border-bp-border rounded-lg ${className}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bp-border">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-bp-text">
            Unified Graph
          </h3>
          <span className="text-[10px] text-bp-text-secondary">
            {elements.length} elements
          </span>
          {/* Layer indicator dots */}
          <div className="flex items-center gap-1">
            {activeLayers.map((layer) => (
              <span
                key={layer}
                className={`w-2 h-2 rounded-full ${LAYER_COLORS[layer]}`}
                title={layer}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Filter panel toggle */}
          <Button
            minimal
            small
            icon={<Filter size={12} className={graphFilterOpen ? 'text-bp-primary' : 'text-bp-text-secondary'} />}
            onClick={toggleGraphFilter}
            active={graphFilterOpen}
            title="Filters"
            className={graphFilterOpen ? 'text-bp-primary' : 'text-bp-text-secondary'}
          />
          {/* Layers button */}
          <Button
            minimal
            small
            icon={<Layers size={12} className="text-bp-text-secondary" />}
            onClick={toggleGraphFilter}
            title="Layer controls"
            className="text-bp-text-secondary"
          />
          <div className="w-px h-4 mx-1 bg-bp-border" />
          {/* Zoom/Fit/Refresh/Export buttons */}
          <Button minimal small icon={<ZoomIn size={12} className="text-bp-text-secondary" />} onClick={handleZoomIn} title="Zoom in" className="text-bp-text-secondary" />
          <Button minimal small icon={<ZoomOut size={12} className="text-bp-text-secondary" />} onClick={handleZoomOut} title="Zoom out" className="text-bp-text-secondary" />
          <Button minimal small icon={<Maximize2 size={12} className="text-bp-text-secondary" />} onClick={handleFit} title="Fit to view" className="text-bp-text-secondary" />
          <Button minimal small icon={<RefreshCw size={12} className="text-bp-text-secondary" />} onClick={handleRefresh} title="Refresh" className="text-bp-text-secondary" />
          <Button minimal small icon={<Download size={12} className="text-bp-text-secondary" />} onClick={handleExport} title="Export PNG" className="text-bp-text-secondary" />
        </div>
      </div>

      {/* Graph container */}
      <div className="flex-1 min-h-0 relative">
        {/* Filter panel overlay */}
        <GraphFilterPanel
          className="absolute left-0 top-0 bottom-0 z-10"
          fiscalYears={metadata?.fiscal_years}
          electionYears={metadata?.election_years}
        />

        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner size={24} intent={Intent.PRIMARY} />
          </div>
        ) : errorMessage ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-severity-critical">{errorMessage}</p>
          </div>
        ) : activeLayers.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Layers size={32} className="mx-auto mb-2 text-bp-text-secondary" />
              <p className="text-sm text-bp-text-secondary">Enable a layer to view graph</p>
            </div>
          </div>
        ) : elements.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-bp-text-secondary">No graph data available</p>
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

      {/* Dynamic Legend */}
      {legendItems.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] flex-wrap border-t border-bp-border">
          {legendItems.map((item, idx) => (
            <div key={`${item.type}-${idx}`} className="flex items-center gap-1">
              <span
                className={`w-2 h-2 ${item.color} ${
                  item.shape === 'circle'
                    ? 'rounded-full'
                    : item.shape === 'rounded'
                    ? 'rounded-sm'
                    : item.shape === 'diamond'
                    ? 'rotate-45'
                    : item.shape === 'star'
                    ? 'rounded-full'
                    : item.shape === 'hexagon'
                    ? 'rounded-full'
                    : item.shape === 'pentagon'
                    ? 'rounded-full'
                    : item.shape === 'octagon'
                    ? 'rounded-sm'
                    : item.shape === 'vee'
                    ? 'rounded-full'
                    : ''
                }`}
              />
              <span className="text-bp-text-secondary">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
