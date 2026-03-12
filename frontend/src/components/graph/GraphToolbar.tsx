import { useState, useRef, useEffect } from 'react'
import {
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Grid3X3,
  Circle,
  GitBranch,
  Download,
  Share2,
  Loader2,
} from 'lucide-react'
import type { GraphNode } from '../../types/api'

interface GraphToolbarProps {
  onSearch: (query: string) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitToView: () => void
  onResetGraph: () => void
  onLayoutChange: (layout: string) => void
  onExport?: () => void
  searchResults?: GraphNode[]
  onSearchResultClick?: (node: GraphNode) => void
  loading?: boolean
  currentLayout: string
  stats?: {
    nodeCount: number
    edgeCount: number
  }
}

const LAYOUTS = [
  { id: 'fcose', label: 'Force (Best)', icon: Share2, description: 'High-quality force-directed' },
  { id: 'cola', label: 'Constraint', icon: GitBranch, description: 'Physics-based with constraints' },
  { id: 'concentric', label: 'Concentric', icon: Circle, description: 'Rings by importance' },
  { id: 'circle', label: 'Circle', icon: Circle, description: 'Simple circular layout' },
  { id: 'grid', label: 'Grid', icon: Grid3X3, description: 'Organized by type' },
  { id: 'cose', label: 'Classic Force', icon: Share2, description: 'Basic force-directed' },
]

export function GraphToolbar({
  onSearch,
  onZoomIn,
  onZoomOut,
  onFitToView,
  onResetGraph,
  onLayoutChange,
  onExport,
  searchResults = [],
  onSearchResultClick,
  loading = false,
  currentLayout,
  stats,
}: GraphToolbarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [showLayoutMenu, setShowLayoutMenu] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)

  // Handle search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        onSearch(searchQuery)
        setShowResults(true)
      } else {
        setShowResults(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, onSearch])

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
      if (layoutRef.current && !layoutRef.current.contains(event.target as Node)) {
        setShowLayoutMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="flex items-center justify-between p-4 bg-osint-bg/80 backdrop-blur-sm border-b border-osint-border relative z-20">
      {/* Left: Title & Stats */}
      <div className="flex items-center gap-6">
        <h1 className="text-xl font-bold">Graph Explorer</h1>
        {stats && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-osint-accent animate-pulse" />
              <span className="text-osint-muted">
                <span className="text-osint-text font-medium">{stats.nodeCount}</span> nodes
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-osint-muted">
                <span className="text-osint-text font-medium">{stats.edgeCount}</span> edges
              </span>
            </div>
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-osint-accent">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        )}
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div ref={searchRef} className="relative">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-osint-muted"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowResults(true)}
              placeholder="Search nodes..."
              className="bg-osint-card border border-osint-border rounded-lg pl-9 pr-4 py-2 text-sm w-56 focus:outline-none focus:border-osint-accent transition-colors"
            />
          </div>

          {/* Search Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-osint-bg border border-osint-border rounded-lg shadow-xl max-h-64 overflow-y-auto z-[100]">
              {searchResults.map((node) => (
                <button
                  key={node.id}
                  onClick={() => {
                    onSearchResultClick?.(node)
                    setShowResults(false)
                    setSearchQuery('')
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-osint-card transition-colors text-left"
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    node.type === 'PERSON' ? 'bg-entity-person' :
                    node.type === 'ORGANIZATION' ? 'bg-entity-organization' :
                    node.type === 'LOCATION' ? 'bg-entity-location' :
                    node.type === 'DISTRICT' ? 'bg-teal-500' :
                    'bg-entity-event'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{node.label}</p>
                    <p className="text-xs text-osint-muted">{node.type}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-osint-border" />

        {/* Layout Selector */}
        <div ref={layoutRef} className="relative">
          <button
            onClick={() => setShowLayoutMenu(!showLayoutMenu)}
            className="flex items-center gap-2 px-3 py-2 bg-osint-card border border-osint-border rounded-lg hover:bg-osint-border transition-colors text-sm"
          >
            <Share2 className="w-4 h-4" />
            <span>Layout</span>
          </button>

          {showLayoutMenu && (
            <div className="absolute top-full right-0 mt-1 bg-osint-bg border border-osint-border rounded-lg shadow-xl z-[100] w-64">
              <div className="p-2 border-b border-osint-border">
                <span className="text-xs text-osint-muted font-medium uppercase">Graph Layout</span>
              </div>
              {LAYOUTS.map((layout) => {
                const Icon = layout.icon
                const isActive = currentLayout === layout.id
                return (
                  <button
                    key={layout.id}
                    onClick={() => {
                      onLayoutChange(layout.id)
                      setShowLayoutMenu(false)
                    }}
                    className={`w-full flex items-center gap-3 p-3 hover:bg-osint-card transition-colors text-left ${
                      isActive ? 'text-osint-accent bg-osint-accent/10' : ''
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-osint-accent' : 'text-osint-muted'}`} />
                    <div className="flex-1">
                      <span className="text-sm font-medium block">{layout.label}</span>
                      <span className="text-xs text-osint-muted">{layout.description}</span>
                    </div>
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-osint-accent" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center bg-osint-card border border-osint-border rounded-lg">
          <button
            onClick={onZoomOut}
            className="p-2 hover:bg-osint-border transition-colors rounded-l-lg"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-osint-border" />
          <button
            onClick={onZoomIn}
            className="p-2 hover:bg-osint-border transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-osint-border" />
          <button
            onClick={onFitToView}
            className="p-2 hover:bg-osint-border transition-colors rounded-r-lg"
            title="Fit to View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* Reset */}
        <button
          onClick={onResetGraph}
          className="p-2 bg-osint-card border border-osint-border rounded-lg hover:bg-osint-border transition-colors"
          title="Reset Graph"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Export */}
        {onExport && (
          <button
            onClick={onExport}
            className="flex items-center gap-2 px-3 py-2 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        )}
      </div>
    </div>
  )
}
