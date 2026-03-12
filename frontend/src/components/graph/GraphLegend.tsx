import { useState } from 'react'
import { Info, ChevronDown, ChevronUp, ChevronRight, Layers } from 'lucide-react'

interface GraphLegendProps {
  showCentrality?: boolean
}

const NODE_TYPES = [
  { type: 'PERSON', label: 'Person', color: 'bg-entity-person' },
  { type: 'ORGANIZATION', label: 'Organization', color: 'bg-entity-organization' },
  { type: 'LOCATION', label: 'Location', color: 'bg-entity-location' },
  { type: 'Document', label: 'Document', color: 'bg-indigo-500' },
]

// Classified relationship types (Palantir-grade)
const RELATIONSHIP_TYPES = [
  { type: 'LEADS', label: 'Leads', color: '#ef4444' },           // Red
  { type: 'MEMBER_OF', label: 'Member Of', color: '#8b5cf6' },   // Purple
  { type: 'AFFILIATED_WITH', label: 'Affiliated', color: '#ec4899' }, // Pink
  { type: 'ALLIED_WITH', label: 'Allied', color: '#22c55e' },    // Green
  { type: 'OPPOSES', label: 'Opposes', color: '#f97316' },       // Orange
  { type: 'LOCATED_IN', label: 'Located In', color: '#14b8a6' }, // Teal
  { type: 'WORKS_FOR', label: 'Works For', color: '#3b82f6' },   // Blue
  { type: 'COLLEAGUE_OF', label: 'Colleague', color: '#06b6d4' }, // Cyan
  { type: 'FAMILY_OF', label: 'Family', color: '#d946ef' },      // Fuchsia
]

export function GraphLegend({ showCentrality = true }: GraphLegendProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [showRelationships, setShowRelationships] = useState(false)
  const [showNodeTypes, setShowNodeTypes] = useState(true)
  const [showSizeLegend, setShowSizeLegend] = useState(false)

  // Collapsed state - just show a small button
  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-2 bg-osint-bg/90 backdrop-blur-sm border border-osint-border rounded-lg hover:bg-osint-border transition-colors z-10"
      >
        <Layers className="w-4 h-4" />
        <span className="text-sm">Legend</span>
        <ChevronRight className="w-4 h-4" />
      </button>
    )
  }

  return (
    <div className="absolute bottom-4 left-4 bg-osint-bg/95 backdrop-blur-sm border border-osint-border rounded-xl z-10 min-w-[180px] max-h-[80vh] overflow-y-auto">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between p-3 border-b border-osint-border">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-osint-accent" />
          <span className="text-sm font-medium">Legend</span>
        </div>
        <button
          onClick={() => setIsCollapsed(true)}
          className="text-xs text-osint-muted hover:text-osint-text transition-colors"
        >
          Hide
        </button>
      </div>

      {/* Node Types - Collapsible */}
      <div className="border-b border-osint-border">
        <button
          onClick={() => setShowNodeTypes(!showNodeTypes)}
          className="w-full flex items-center justify-between p-3 hover:bg-osint-card/50 transition-colors"
        >
          <span className="text-xs font-medium text-osint-muted uppercase tracking-wide flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-osint-accent" />
            Node Types
          </span>
          {showNodeTypes ? <ChevronUp className="w-3.5 h-3.5 text-osint-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-osint-muted" />}
        </button>
        {showNodeTypes && (
          <div className="px-3 pb-3 space-y-2">
            {NODE_TYPES.map((nodeType) => (
              <div key={nodeType.type} className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-full ${nodeType.color} ring-2 ring-offset-1 ring-offset-osint-bg ring-white/10`} />
                <span className="text-sm text-osint-text">{nodeType.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edge Types - Collapsible */}
      <div className="border-b border-osint-border">
        <button
          onClick={() => setShowRelationships(!showRelationships)}
          className="w-full flex items-center justify-between p-3 hover:bg-osint-card/50 transition-colors"
        >
          <span className="text-xs font-medium text-osint-muted uppercase tracking-wide flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Edges
          </span>
          {showRelationships ? <ChevronUp className="w-3.5 h-3.5 text-osint-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-osint-muted" />}
        </button>

        {showRelationships && (
          <div className="px-3 pb-3 space-y-2">
            {/* Basic edge types */}
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-0.5 bg-amber-500" />
              <span className="text-sm text-osint-text">Unclassified</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-0.5">
                <div className="w-2 h-0.5 bg-slate-400" />
                <div className="w-1 h-0.5 bg-transparent" />
                <div className="w-2 h-0.5 bg-slate-400" />
              </div>
              <span className="text-sm text-osint-text">Doc Mention</span>
            </div>

            {/* Classified relationship types */}
            <div className="mt-2 pt-2 border-t border-osint-border/50 space-y-1.5">
              <span className="text-[10px] text-osint-muted uppercase">Classified</span>
              {RELATIONSHIP_TYPES.map((rel) => (
                <div key={rel.type} className="flex items-center gap-2.5">
                  <div className="w-6 h-0.5" style={{ backgroundColor: rel.color }} />
                  <span className="text-xs text-osint-text">{rel.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Size Legend - Collapsible */}
      {showCentrality && (
        <div>
          <button
            onClick={() => setShowSizeLegend(!showSizeLegend)}
            className="w-full flex items-center justify-between p-3 hover:bg-osint-card/50 transition-colors"
          >
            <span className="text-xs font-medium text-osint-muted uppercase tracking-wide flex items-center gap-1.5">
              <Info className="w-3 h-3" />
              Node Size
            </span>
            {showSizeLegend ? <ChevronUp className="w-3.5 h-3.5 text-osint-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-osint-muted" />}
          </button>
          {showSizeLegend && (
            <div className="px-3 pb-3">
              <div className="flex items-end gap-2">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-osint-muted" />
                  <span className="text-[10px] text-osint-muted mt-1">Low</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="w-4 h-4 rounded-full bg-osint-muted" />
                  <span className="text-[10px] text-osint-muted mt-1">Med</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-osint-muted" />
                  <span className="text-[10px] text-osint-muted mt-1">High</span>
                </div>
                <span className="text-xs text-osint-muted ml-1">Centrality</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
