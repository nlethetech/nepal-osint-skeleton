import { useState, useCallback } from 'react'
import {
  X,
  Search,
  ChevronDown,
  Globe,
  TrendingUp,
  Users,
  Newspaper,
  AlertTriangle,
} from 'lucide-react'
import { Switch, Checkbox, HTMLSelect } from '@blueprintjs/core'
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore'
import type { GraphLayer } from '../../api/multiLayerGraph'

// ============================================================================
// Helper Components
// ============================================================================

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <Switch
      checked={checked}
      onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      label={label}
      alignIndicator="right"
      className="!mb-0 text-xs text-bp-text"
    />
  )
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="bp-section-header">
          {label}
        </span>
        <span className="text-[10px] text-bp-primary font-mono tabular-nums">
          {step < 1 ? value.toFixed(2) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 appearance-none rounded-full cursor-pointer bg-bp-border accent-bp-primary
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-bp-primary
          [&::-webkit-slider-thumb]:shadow-[0_0_4px_rgba(45,114,210,0.4)]"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-1">
      <span className="bp-section-header">
        {label}
      </span>
      <HTMLSelect
        minimal
        fill
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={options}
        className="!text-xs !bg-bp-surface !text-bp-text"
      />
    </div>
  )
}

function AccordionSection({
  title,
  color,
  children,
  defaultOpen = false,
}: {
  title: string
  color: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-bp-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bp-hover transition-colors"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="flex-1 text-left text-xs font-medium text-bp-text">
          {title}
        </span>
        <ChevronDown
          size={12}
          className={`text-bp-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-3 pb-3 space-y-2.5">{children}</div>}
    </div>
  )
}

function ButtonGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex rounded overflow-hidden border border-bp-border">
      {options.map((opt, idx) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-2 py-1 text-[10px] font-medium transition-colors
              ${idx > 0 ? 'border-l border-bp-border' : ''}
              ${active
                ? 'bg-bp-primary/20 text-bp-primary border-bp-primary/30'
                : 'bg-bp-surface text-bp-text-muted'
              }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================================
// Edge/Node type definitions by layer
// ============================================================================

const EDGE_TYPES_BY_LAYER: Record<string, string[]> = {
  trade: ['IMPORTS_FROM', 'EXPORTS_TO', 'TRADES_COMMODITY', 'HAS_CUSTOMS', 'CUSTOMS_IMPORTS', 'CUSTOMS_EXPORTS'],
  entity: [
    'PARTY_MEMBER', 'FORMER_PARTY_MEMBER', 'RAN_IN', 'OPPONENT',
    'WAS_PM', 'WAS_MINISTER_OF', 'IS_MP', 'REPRESENTS',
    'CO_MENTION', 'POLITICAL_ALLY', 'POLITICAL_OPPONENT',
    'AWARDED_CONTRACT', 'OPERATES_IN',
  ],
  news: ['CO_MENTION', 'MENTIONED_IN', 'STORY_IN_DISTRICT'],
  disaster: ['DISASTER_IN', 'DISASTER_IN_PROVINCE', 'IS_HAZARD_TYPE'],
  geographic: ['HAS_PROVINCE', 'HAS_DISTRICT', 'HAS_CONSTITUENCY', 'CUSTOMS_IN_DISTRICT'],
}

const ALL_EDGE_TYPES = Object.values(EDGE_TYPES_BY_LAYER).flat()

const ALL_NODE_TYPES = [
  'nepal', 'province', 'district', 'constituency',
  'person', 'party', 'organization', 'institution', 'government',
  'partner_country', 'hs_chapter', 'customs_office',
  'disaster_incident', 'hazard_type', 'story',
]

// ============================================================================
// Layer metadata
// ============================================================================

const LAYER_META: Record<GraphLayer, { label: string; color: string; icon: typeof Globe }> = {
  geographic: { label: 'Geographic', color: '#0ea5e9', icon: Globe },
  trade:      { label: 'Trade',      color: '#14b8a6', icon: TrendingUp },
  entity:     { label: 'Entity',     color: '#4f46e5', icon: Users },
  news:       { label: 'News',       color: '#8b5cf6', icon: Newspaper },
  disaster:   { label: 'Disaster',   color: '#ef4444', icon: AlertTriangle },
}

const LAYER_ORDER: GraphLayer[] = ['geographic', 'trade', 'entity', 'news', 'disaster']

// ============================================================================
// Main Component
// ============================================================================

interface GraphFilterPanelProps {
  className?: string
  fiscalYears?: string[]
  electionYears?: number[]
}

export default function GraphFilterPanel({
  className = '',
  fiscalYears = [],
  electionYears = [],
}: GraphFilterPanelProps) {
  const {
    activeLayers,
    layerConfigs,
    visibleEdgeTypes,
    visibleNodeTypes,
    graphFilterOpen,
    graphSearchQuery,
    hideOrphans,
    toggleLayer,
    setLayerConfig,
    setVisibleEdgeTypes,
    setVisibleNodeTypes,
    toggleGraphFilter,
    setGraphSearchQuery,
    setHideOrphans,
  } = useConnectedAnalystStore()

  // Province and party quick-filter state
  const [provinceFilter, setProvinceFilter] = useState('')
  const [partyFilter, setPartyFilter] = useState('')

  // ------ Edge type toggle logic ------
  const handleEdgeTypeToggle = useCallback(
    (edgeType: string, checked: boolean) => {
      if (checked) {
        // If currently filtered, remove this type from the exclusion
        if (visibleEdgeTypes.length === 0) return // already showing all
        const next = visibleEdgeTypes.filter((t) => t !== edgeType)
        // If removing results in all types visible, reset to empty
        const activeEdgeTypes = activeLayers.flatMap((l) => EDGE_TYPES_BY_LAYER[l] ?? [])
        if (next.length === 0 || next.length >= activeEdgeTypes.length) {
          setVisibleEdgeTypes([])
        } else {
          setVisibleEdgeTypes([...visibleEdgeTypes, edgeType])
        }
      } else {
        // Unchecking: populate with all EXCEPT this one
        if (visibleEdgeTypes.length === 0) {
          const allActive = activeLayers.flatMap((l) => EDGE_TYPES_BY_LAYER[l] ?? [])
          setVisibleEdgeTypes(allActive.filter((t) => t !== edgeType))
        } else {
          setVisibleEdgeTypes(visibleEdgeTypes.filter((t) => t !== edgeType))
        }
      }
    },
    [visibleEdgeTypes, activeLayers, setVisibleEdgeTypes],
  )

  const isEdgeTypeVisible = useCallback(
    (edgeType: string) => {
      if (visibleEdgeTypes.length === 0) return true
      return visibleEdgeTypes.includes(edgeType)
    },
    [visibleEdgeTypes],
  )

  // ------ Node type toggle logic ------
  const handleNodeTypeToggle = useCallback(
    (nodeType: string, checked: boolean) => {
      if (checked) {
        if (visibleNodeTypes.length === 0) return
        const next = [...visibleNodeTypes, nodeType]
        if (next.length >= ALL_NODE_TYPES.length) {
          setVisibleNodeTypes([])
        } else {
          setVisibleNodeTypes(next)
        }
      } else {
        if (visibleNodeTypes.length === 0) {
          setVisibleNodeTypes(ALL_NODE_TYPES.filter((t) => t !== nodeType))
        } else {
          setVisibleNodeTypes(visibleNodeTypes.filter((t) => t !== nodeType))
        }
      }
    },
    [visibleNodeTypes, setVisibleNodeTypes],
  )

  const isNodeTypeVisible = useCallback(
    (nodeType: string) => {
      if (visibleNodeTypes.length === 0) return true
      return visibleNodeTypes.includes(nodeType)
    },
    [visibleNodeTypes],
  )

  const isLayerActive = useCallback(
    (layer: GraphLayer) => activeLayers.includes(layer),
    [activeLayers],
  )

  // ======================================================================
  // Render
  // ======================================================================

  return (
    <div
      className={`
        absolute top-0 left-0 z-30 h-full w-[280px]
        bg-bp-bg/95 backdrop-blur-sm border-r border-bp-border
        transition-transform duration-200 ease-in-out
        ${graphFilterOpen ? 'translate-x-0' : '-translate-x-full'}
        flex flex-col
        ${className}
      `}
    >
      {/* -- Header -- */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-bp-border">
        <span className="text-xs font-semibold tracking-wide uppercase text-bp-text">
          Graph Filters
        </span>
        <button
          type="button"
          onClick={toggleGraphFilter}
          className="p-1 rounded text-bp-text-muted hover:bg-white/10 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* -- Scrollable body -- */}
      <div
        className="flex-1 overflow-y-auto
          [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent
          [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-bp-border"
      >
        {/* -- Search -- */}
        <div className="px-3 py-2.5 space-y-2">
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-bp-text-muted" />
            <input
              type="text"
              placeholder="Search entity name..."
              value={graphSearchQuery}
              onChange={(e) => setGraphSearchQuery(e.target.value)}
              className="w-full rounded text-xs pl-7 pr-2 py-1.5 focus:outline-none transition-colors
                bg-bp-surface border border-bp-border text-bp-text
                placeholder:text-bp-text-muted focus:border-bp-primary"
            />
          </div>
          {/* Province quick-filter */}
          <SelectField
            label="Province"
            value={provinceFilter}
            onChange={(v) => {
              setProvinceFilter(v)
              if (v) {
                setGraphSearchQuery(`Province ${v}`)
              } else if (partyFilter) {
                setGraphSearchQuery(partyFilter)
              } else {
                setGraphSearchQuery('')
              }
            }}
            options={[
              { value: '', label: 'All Provinces' },
              { value: '1', label: 'Province 1 (Koshi)' },
              { value: '2', label: 'Province 2 (Madhesh)' },
              { value: '3', label: 'Province 3 (Bagmati)' },
              { value: '4', label: 'Province 4 (Gandaki)' },
              { value: '5', label: 'Province 5 (Lumbini)' },
              { value: '6', label: 'Province 6 (Karnali)' },
              { value: '7', label: 'Province 7 (Sudurpashchim)' },
            ]}
          />
          {/* Party quick-filter */}
          <SelectField
            label="Party"
            value={partyFilter}
            onChange={(v) => {
              setPartyFilter(v)
              if (v) {
                setGraphSearchQuery(v)
              } else if (provinceFilter) {
                setGraphSearchQuery(`Province ${provinceFilter}`)
              } else {
                setGraphSearchQuery('')
              }
            }}
            options={[
              { value: '', label: 'All Parties' },
              { value: 'CPN-UML', label: 'CPN-UML' },
              { value: 'Nepali Congress', label: 'Nepali Congress' },
              { value: 'CPN Maoist Centre', label: 'CPN Maoist Centre' },
              { value: 'Rastriya Swatantra Party', label: 'RSP' },
              { value: 'Janata Samajbadi Party', label: 'JSP' },
              { value: 'CPN (Unified Socialist)', label: 'CPN (US)' },
              { value: 'RPP', label: 'RPP' },
              { value: 'Independent', label: 'Independent' },
            ]}
          />
        </div>

        {/* -- Layer Toggles -- */}
        <div className="px-3 pb-2 space-y-1.5">
          <span className="bp-section-header">
            Layers
          </span>
          {LAYER_ORDER.map((layer) => {
            const meta = LAYER_META[layer]
            const active = isLayerActive(layer)
            return (
              <div
                key={layer}
                className="flex items-center gap-2 py-0.5 cursor-pointer"
                onClick={() => toggleLayer(layer)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 transition-opacity"
                  style={{ backgroundColor: meta.color, opacity: active ? 1 : 0.3 }}
                />
                <span
                  className={`text-xs flex-1 transition-colors ${active ? 'text-bp-text' : 'text-bp-text-muted'}`}
                >
                  {meta.label}
                </span>
                <Switch
                  checked={active}
                  onChange={() => {/* handled by parent onClick */}}
                  className="!mb-0 !-mr-1"
                  innerLabelChecked=""
                  innerLabel=""
                />
              </div>
            )
          })}
        </div>

        {/* -- Display Options -- */}
        <div className="px-3 pb-2">
          <Toggle
            label="Hide Orphan Nodes"
            checked={hideOrphans}
            onChange={(v) => setHideOrphans(v)}
          />
        </div>

        {/* -- Per-Layer Config Sections -- */}

        {/* Geographic */}
        {isLayerActive('geographic') && (
          <AccordionSection title="Geographic" color="#0ea5e9" defaultOpen>
            <SelectField
              label="Province"
              value={String(layerConfigs.geographic.expand_province_id ?? '')}
              onChange={(v) =>
                setLayerConfig('geographic', {
                  expand_province_id: v === '' ? undefined : Number(v),
                })
              }
              options={[
                { value: '', label: 'All Provinces' },
                ...Array.from({ length: 7 }, (_, i) => ({
                  value: String(i + 1),
                  label: `Province ${i + 1}`,
                })),
              ]}
            />
            <div className="space-y-1">
              <span className="bp-section-header">
                District
              </span>
              <input
                type="text"
                placeholder="e.g. Kathmandu"
                value={layerConfigs.geographic.expand_district ?? ''}
                onChange={(e) =>
                  setLayerConfig('geographic', {
                    expand_district: e.target.value || undefined,
                  })
                }
                className="w-full rounded text-xs px-2 py-1.5 focus:outline-none transition-colors
                  bg-bp-surface border border-bp-border text-bp-text
                  placeholder:text-bp-text-muted focus:border-bp-primary"
              />
            </div>
          </AccordionSection>
        )}

        {/* Trade */}
        {isLayerActive('trade') && (
          <AccordionSection title="Trade" color="#14b8a6" defaultOpen>
            <SelectField
              label="Fiscal Year"
              value={layerConfigs.trade.fiscal_year_bs ?? ''}
              onChange={(v) =>
                setLayerConfig('trade', { fiscal_year_bs: v || undefined })
              }
              options={[
                { value: '', label: 'Latest' },
                ...fiscalYears.map((fy) => ({ value: fy, label: fy })),
              ]}
            />
            <div className="space-y-1">
              <span className="bp-section-header">
                Direction
              </span>
              <ButtonGroup
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'import', label: 'Import' },
                  { value: 'export', label: 'Export' },
                ]}
                value={layerConfigs.trade.direction ?? 'all'}
                onChange={(v) => setLayerConfig('trade', { direction: v })}
              />
            </div>
            <SliderField
              label="Top Countries"
              value={layerConfigs.trade.top_countries ?? 20}
              onChange={(v) => setLayerConfig('trade', { top_countries: v })}
              min={5}
              max={226}
            />
            <SliderField
              label="Top HS Chapters"
              value={layerConfigs.trade.top_hs_chapters ?? 20}
              onChange={(v) => setLayerConfig('trade', { top_hs_chapters: v })}
              min={5}
              max={87}
            />
            <div className="space-y-1">
              <span className="bp-section-header">
                Min Value (NPR &apos;000)
              </span>
              <input
                type="number"
                min={0}
                value={layerConfigs.trade.min_value_npr_thousands ?? 0}
                onChange={(e) =>
                  setLayerConfig('trade', {
                    min_value_npr_thousands: Number(e.target.value),
                  })
                }
                className="w-full rounded text-xs px-2 py-1.5 focus:outline-none transition-colors font-mono
                  bg-bp-surface border border-bp-border text-bp-text
                  focus:border-bp-primary"
              />
            </div>
            <Toggle
              label="Include Customs"
              checked={layerConfigs.trade.include_customs ?? false}
              onChange={(v) => setLayerConfig('trade', { include_customs: v })}
            />
            {layerConfigs.trade.include_customs && (
              <SliderField
                label="Top Customs"
                value={layerConfigs.trade.top_customs ?? 10}
                onChange={(v) => setLayerConfig('trade', { top_customs: v })}
                min={5}
                max={50}
              />
            )}
          </AccordionSection>
        )}

        {/* Entity */}
        {isLayerActive('entity') && (
          <AccordionSection title="Entity" color="#4f46e5" defaultOpen>
            <div className="space-y-1">
              <span className="bp-section-header">
                Time Window
              </span>
              <ButtonGroup
                options={[
                  { value: '24h', label: '24h' },
                  { value: '7d', label: '7d' },
                  { value: '30d', label: '30d' },
                  { value: '90d', label: '90d' },
                ]}
                value={layerConfigs.entity.window ?? '30d'}
                onChange={(v) => setLayerConfig('entity', { window: v })}
              />
            </div>
            <SliderField
              label="Min Strength"
              value={layerConfigs.entity.min_strength ?? 0.1}
              onChange={(v) => setLayerConfig('entity', { min_strength: v })}
              min={0}
              max={1}
              step={0.05}
            />
            <SliderField
              label="Max Nodes"
              value={layerConfigs.entity.limit_nodes ?? 100}
              onChange={(v) => setLayerConfig('entity', { limit_nodes: v })}
              min={10}
              max={500}
            />
            <SelectField
              label="Election Year"
              value={String(layerConfigs.entity.election_year_bs ?? '')}
              onChange={(v) =>
                setLayerConfig('entity', {
                  election_year_bs: v === '' ? undefined : Number(v),
                })
              }
              options={[
                { value: '', label: 'All Years' },
                ...electionYears.map((y) => ({ value: String(y), label: String(y) })),
              ]}
            />
            <div className="space-y-1.5 pt-1">
              <Toggle
                label="Parties"
                checked={layerConfigs.entity.include_parties ?? true}
                onChange={(v) => setLayerConfig('entity', { include_parties: v })}
              />
              <Toggle
                label="Constituencies"
                checked={layerConfigs.entity.include_constituencies ?? true}
                onChange={(v) => setLayerConfig('entity', { include_constituencies: v })}
              />
              <Toggle
                label="Ministerial"
                checked={layerConfigs.entity.include_ministerial ?? true}
                onChange={(v) => setLayerConfig('entity', { include_ministerial: v })}
              />
              <Toggle
                label="Opponents"
                checked={layerConfigs.entity.include_opponents ?? true}
                onChange={(v) => setLayerConfig('entity', { include_opponents: v })}
              />
              <Toggle
                label="Geographic"
                checked={layerConfigs.entity.include_geographic ?? true}
                onChange={(v) => setLayerConfig('entity', { include_geographic: v })}
              />
            </div>
          </AccordionSection>
        )}

        {/* News */}
        {isLayerActive('news') && (
          <AccordionSection title="News" color="#8b5cf6" defaultOpen>
            <SliderField
              label="Hours"
              value={layerConfigs.news.hours ?? 168}
              onChange={(v) => setLayerConfig('news', { hours: v })}
              min={24}
              max={720}
            />
            <div className="space-y-1">
              <span className="bp-section-header">
                Min Co-mentions
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={layerConfigs.news.min_co_mentions ?? 2}
                onChange={(e) =>
                  setLayerConfig('news', { min_co_mentions: Number(e.target.value) })
                }
                className="w-full rounded text-xs px-2 py-1.5 focus:outline-none transition-colors font-mono
                  bg-bp-surface border border-bp-border text-bp-text
                  focus:border-bp-primary"
              />
            </div>
            <SliderField
              label="Max Entities"
              value={layerConfigs.news.limit_entities ?? 50}
              onChange={(v) => setLayerConfig('news', { limit_entities: v })}
              min={10}
              max={200}
            />
            <SelectField
              label="Category"
              value={layerConfigs.news.category ?? ''}
              onChange={(v) => setLayerConfig('news', { category: v || undefined })}
              options={[
                { value: '', label: 'All Categories' },
                { value: 'political', label: 'Political' },
                { value: 'economic', label: 'Economic' },
                { value: 'security', label: 'Security' },
                { value: 'disaster', label: 'Disaster' },
                { value: 'social', label: 'Social' },
              ]}
            />
            <div className="space-y-1.5 pt-1">
              <Toggle
                label="Story Nodes"
                checked={layerConfigs.news.include_story_nodes ?? true}
                onChange={(v) => setLayerConfig('news', { include_story_nodes: v })}
              />
              <Toggle
                label="Districts"
                checked={layerConfigs.news.include_districts ?? true}
                onChange={(v) => setLayerConfig('news', { include_districts: v })}
              />
              <Toggle
                label="Entity Connections"
                checked={layerConfigs.news.include_entity_connections ?? true}
                onChange={(v) => setLayerConfig('news', { include_entity_connections: v })}
              />
            </div>
          </AccordionSection>
        )}

        {/* Disaster */}
        {isLayerActive('disaster') && (
          <AccordionSection title="Disaster" color="#ef4444" defaultOpen>
            <SliderField
              label="Days"
              value={layerConfigs.disaster.days ?? 30}
              onChange={(v) => setLayerConfig('disaster', { days: v })}
              min={7}
              max={365}
            />
            <SelectField
              label="Min Severity"
              value={layerConfigs.disaster.min_severity ?? ''}
              onChange={(v) => setLayerConfig('disaster', { min_severity: v || undefined })}
              options={[
                { value: '', label: 'Any' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
            />
            <SelectField
              label="Hazard Type"
              value={layerConfigs.disaster.hazard_type ?? ''}
              onChange={(v) => setLayerConfig('disaster', { hazard_type: v || undefined })}
              options={[
                { value: '', label: 'Any' },
                { value: 'flood', label: 'Flood' },
                { value: 'landslide', label: 'Landslide' },
                { value: 'earthquake', label: 'Earthquake' },
                { value: 'fire', label: 'Fire' },
                { value: 'lightning', label: 'Lightning' },
                { value: 'drought', label: 'Drought' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <SliderField
              label="Max Incidents"
              value={layerConfigs.disaster.limit_incidents ?? 50}
              onChange={(v) => setLayerConfig('disaster', { limit_incidents: v })}
              min={10}
              max={200}
            />
          </AccordionSection>
        )}

        {/* -- Edge Type Filters -- */}
        <div className="px-3 py-2.5 border-t border-bp-border">
          <span className="bp-section-header">
            Edge Types
          </span>
          <div className="mt-2 space-y-2">
            {LAYER_ORDER.filter((l) => isLayerActive(l)).map((layer) => {
              const meta = LAYER_META[layer]
              const edges = EDGE_TYPES_BY_LAYER[layer] ?? []
              return (
                <div key={layer}>
                  <span
                    className="text-[10px] font-medium mb-1 block"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <div className="space-y-0.5">
                    {edges.map((edgeType) => (
                      <Checkbox
                        key={edgeType}
                        checked={isEdgeTypeVisible(edgeType)}
                        onChange={(e) => handleEdgeTypeToggle(edgeType, (e.target as HTMLInputElement).checked)}
                        label={edgeType}
                        className="!mb-0.5 !text-[10px] text-bp-text-secondary"
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* -- Node Type Filters -- */}
        <div className="px-3 py-2.5 pb-6 border-t border-bp-border">
          <span className="bp-section-header">
            Node Types
          </span>
          <div className="mt-2 space-y-0.5">
            {ALL_NODE_TYPES.map((nodeType) => (
              <Checkbox
                key={nodeType}
                checked={isNodeTypeVisible(nodeType)}
                onChange={(e) => handleNodeTypeToggle(nodeType, (e.target as HTMLInputElement).checked)}
                label={nodeType}
                className="!mb-0.5 !text-[10px] text-bp-text-secondary"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
