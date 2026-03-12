import { useState } from 'react'
import { Filter, Eye, EyeOff, Sliders, Sparkles, Network, ChevronDown, ChevronRight } from 'lucide-react'

// Collapsible Section Component
function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = true
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-osint-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 hover:bg-osint-card/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-osint-muted" />
          <span className="text-xs font-medium text-osint-muted uppercase tracking-wide">
            {title}
          </span>
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-osint-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-osint-muted" />
        )}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}

interface NodeTypeFilter {
  type: string
  label: string
  color: string
  count: number
}

interface GraphFilterPanelProps {
  visibleNodeTypes: Set<string>
  minConfidence: number
  maxNeighbors: number
  classifiedOnly: boolean
  nodeTypeCounts: Record<string, number>
  onToggleType: (type: string) => void
  onConfidenceChange: (confidence: number) => void
  onMaxNeighborsChange: (max: number) => void
  onClassifiedOnlyChange: (value: boolean) => void
  isOpen: boolean
  onToggle: () => void
}

const NODE_TYPES: NodeTypeFilter[] = [
  { type: 'PERSON', label: 'Person', color: 'bg-entity-person', count: 0 },
  { type: 'PARTY', label: 'Party', color: 'bg-purple-500', count: 0 },
  { type: 'CONSTITUENCY', label: 'Constituency', color: 'bg-teal-500', count: 0 },
  { type: 'ORGANIZATION', label: 'Organization', color: 'bg-entity-organization', count: 0 },
  { type: 'LOCATION', label: 'Location', color: 'bg-entity-location', count: 0 },
]

export function GraphFilterPanel({
  visibleNodeTypes,
  minConfidence,
  maxNeighbors,
  classifiedOnly,
  nodeTypeCounts,
  onToggleType,
  onConfidenceChange,
  onMaxNeighborsChange,
  onClassifiedOnlyChange,
  isOpen,
  onToggle,
}: GraphFilterPanelProps) {
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="absolute top-4 left-4 flex items-center gap-2 px-3 py-2 bg-osint-bg/90 backdrop-blur-sm border border-osint-border rounded-lg hover:bg-osint-border transition-colors z-10"
      >
        <Filter className="w-4 h-4" />
        <span className="text-sm">Filters</span>
      </button>
    )
  }

  return (
    <div className="absolute top-4 left-4 w-72 bg-osint-bg/95 backdrop-blur-sm border border-osint-border rounded-xl shadow-xl z-10">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-osint-border">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-osint-accent" />
          <span className="font-medium">Filters</span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs text-osint-muted hover:text-osint-text transition-colors"
        >
          Close
        </button>
      </div>

      {/* Classified Only Toggle - Most Important */}
      <div className="p-3 border-b border-osint-border">
        <button
          onClick={() => onClassifiedOnlyChange(!classifiedOnly)}
          className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
            classifiedOnly
              ? 'bg-osint-accent/20 border border-osint-accent'
              : 'bg-osint-card border border-osint-border hover:border-osint-accent/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles className={`w-4 h-4 ${classifiedOnly ? 'text-osint-accent' : 'text-osint-muted'}`} />
            <div className="text-left">
              <span className={`text-sm font-medium ${classifiedOnly ? 'text-osint-accent' : 'text-osint-text'}`}>
                Classified Only
              </span>
              <p className="text-xs text-osint-muted">Show only LLM-classified relationships</p>
            </div>
          </div>
          <div className={`w-10 h-5 rounded-full transition-colors ${
            classifiedOnly ? 'bg-osint-accent' : 'bg-osint-border'
          }`}>
            <div className={`w-4 h-4 mt-0.5 rounded-full bg-white shadow transition-transform ${
              classifiedOnly ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </div>
        </button>
      </div>

      {/* Max Neighbors Slider - Collapsible */}
      <CollapsibleSection title="Max Connections" icon={Network} defaultOpen={true}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-mono text-osint-accent">
            {maxNeighbors}
          </span>
        </div>
        <input
          type="range"
          min="20"
          max="300"
          step="20"
          value={maxNeighbors}
          onChange={(e) => onMaxNeighborsChange(parseInt(e.target.value))}
          className="w-full h-2 bg-osint-border rounded-lg appearance-none cursor-pointer accent-osint-accent"
        />
        <div className="flex justify-between text-xs text-osint-muted mt-1">
          <span>20</span>
          <span>100</span>
          <span>300</span>
        </div>
        <p className="text-xs text-osint-muted mt-2">
          Fewer = clearer graph, More = complete view
        </p>
      </CollapsibleSection>

      {/* Node Type Toggles - Collapsible */}
      <CollapsibleSection title="Node Types" icon={Eye} defaultOpen={false}>
        <div className="space-y-2">
          {NODE_TYPES.map((nodeType) => {
            const isVisible = visibleNodeTypes.has(nodeType.type)
            const count = nodeTypeCounts[nodeType.type] || 0

            return (
              <button
                key={nodeType.type}
                onClick={() => onToggleType(nodeType.type)}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${
                  isVisible
                    ? 'bg-osint-card border border-osint-border'
                    : 'bg-osint-bg/50 border border-transparent opacity-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${nodeType.color}`} />
                  <span className="text-sm">{nodeType.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-osint-muted">{count}</span>
                  {isVisible ? (
                    <Eye className="w-4 h-4 text-osint-accent" />
                  ) : (
                    <EyeOff className="w-4 h-4 text-osint-muted" />
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {/* Quick Actions */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => NODE_TYPES.forEach(t => !visibleNodeTypes.has(t.type) && onToggleType(t.type))}
            className="flex-1 text-xs py-2 bg-osint-card border border-osint-border rounded-lg hover:bg-osint-border transition-colors"
          >
            Show All
          </button>
          <button
            onClick={() => NODE_TYPES.forEach(t => visibleNodeTypes.has(t.type) && onToggleType(t.type))}
            className="flex-1 text-xs py-2 bg-osint-card border border-osint-border rounded-lg hover:bg-osint-border transition-colors"
          >
            Hide All
          </button>
        </div>
      </CollapsibleSection>

      {/* Confidence Slider - Collapsible */}
      <CollapsibleSection title="Min Confidence" icon={Sliders} defaultOpen={false}>
        <div className="flex items-center justify-end mb-2">
          <span className="text-sm font-mono text-osint-accent">
            {Math.round(minConfidence * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={minConfidence}
          onChange={(e) => onConfidenceChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-osint-border rounded-lg appearance-none cursor-pointer accent-osint-accent"
        />
        <div className="flex justify-between text-xs text-osint-muted mt-1">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </CollapsibleSection>
    </div>
  )
}
