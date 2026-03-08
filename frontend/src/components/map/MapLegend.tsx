/**
 * MapLegend - Professional collapsible legend panel
 * ==================================================
 *
 * Shows a collapsible legend explaining map symbols:
 * - Category icons with labels
 * - Severity scale with colors
 * - Cluster information
 * - Data quality indicators
 */

import { memo, useState, useEffect, useCallback } from 'react'
import {
  Info,
  ChevronDown,
  ChevronUp,
  Shield,
  Landmark,
  TrendingUp,
  Building2,
  AlertTriangle,
  Heart,
  Users,
  Leaf,
  Circle,
  Layers,
} from 'lucide-react'
import type { IntelligenceCategory, EventSeverity } from './EventMarkerIcons'

// =============================================================================
// TYPES
// =============================================================================

export interface MapLegendProps {
  /** Whether the legend is expanded */
  isExpanded?: boolean
  /** Callback when expanded state changes */
  onExpandedChange?: (expanded: boolean) => void
  /** Optional class name */
  className?: string
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CATEGORY_ITEMS: {
  key: IntelligenceCategory
  label: string
  labelNe: string
  Icon: React.ElementType
  color: string
  bgColor: string
}[] = [
  { key: 'SECURITY', label: 'Security', labelNe: 'सुरक्षा', Icon: Shield, color: '#ff6b6b', bgColor: '#c92a2a' },
  { key: 'POLITICAL', label: 'Political', labelNe: 'राजनीतिक', Icon: Landmark, color: '#74c0fc', bgColor: '#1971c2' },
  { key: 'ECONOMIC', label: 'Economic', labelNe: 'आर्थिक', Icon: TrendingUp, color: '#69db7c', bgColor: '#2f9e44' },
  { key: 'INFRASTRUCTURE', label: 'Infrastructure', labelNe: 'पूर्वाधार', Icon: Building2, color: '#ffa94d', bgColor: '#e8590c' },
  { key: 'DISASTER', label: 'Disaster', labelNe: 'विपद्', Icon: AlertTriangle, color: '#ff8787', bgColor: '#e03131' },
  { key: 'HEALTH', label: 'Health', labelNe: 'स्वास्थ्य', Icon: Heart, color: '#f783ac', bgColor: '#c2255c' },
  { key: 'SOCIAL', label: 'Social', labelNe: 'सामाजिक', Icon: Users, color: '#b197fc', bgColor: '#7950f2' },
  { key: 'ENVIRONMENT', label: 'Environment', labelNe: 'वातावरण', Icon: Leaf, color: '#63e6be', bgColor: '#099268' },
  { key: 'GENERAL', label: 'General', labelNe: 'सामान्य', Icon: Circle, color: '#51cf66', bgColor: '#2b8a3e' },
]

const SEVERITY_ITEMS: {
  key: EventSeverity
  label: string
  color: string
  description: string
}[] = [
  { key: 'CRITICAL', label: 'Critical', color: '#ef4444', description: 'Immediate attention required' },
  { key: 'HIGH', label: 'High', color: '#f97316', description: 'Significant event' },
  { key: 'MEDIUM', label: 'Medium', color: '#eab308', description: 'Notable event' },
  { key: 'LOW', label: 'Low', color: '#22c55e', description: 'Minor event' },
]

// =============================================================================
// COMPONENT
// =============================================================================

export const MapLegend = memo(function MapLegend({
  isExpanded: controlledExpanded,
  onExpandedChange,
  className = '',
}: MapLegendProps) {
  // Internal state for uncontrolled mode
  const [internalExpanded, setInternalExpanded] = useState(false)

  // Use controlled or uncontrolled state
  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded

  const toggleExpanded = useCallback(() => {
    const newValue = !isExpanded
    if (onExpandedChange) {
      onExpandedChange(newValue)
    }
    setInternalExpanded(newValue)
  }, [isExpanded, onExpandedChange])

  // Keyboard shortcut: L to toggle legend
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.key === 'l' || e.key === 'L') {
        toggleExpanded()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleExpanded])

  return (
    <div
      className={`
        absolute bottom-4 left-4 z-[1000]
        bg-white
        border border-gray-200 rounded-lg
        shadow-lg overflow-hidden
        transition-all duration-300 ease-out
        ${isExpanded ? 'w-72' : 'w-auto'}
        ${className}
      `}
    >
      {/* Header / Toggle Button */}
      <button
        onClick={toggleExpanded}
        className={`
          w-full flex items-center justify-between gap-2 px-3 py-2.5
          hover:bg-gray-50 transition-colors
          ${isExpanded ? 'border-b border-gray-200' : ''}
        `}
        title="Toggle legend (L)"
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-100">
            <Layers className="w-4 h-4 text-blue-600" />
          </div>
          {isExpanded && (
            <span className="text-sm font-medium text-gray-900">Map Legend</span>
          )}
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-3 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Categories Section */}
          <div>
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Event Categories
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {CATEGORY_ITEMS.map(({ key, label, Icon, bgColor }) => (
                <div
                  key={key}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 transition-colors"
                >
                  <div
                    className="flex items-center justify-center w-6 h-6 rounded-full"
                    style={{ backgroundColor: bgColor }}
                  >
                    <Icon className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="text-xs text-gray-700 truncate">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Severity Section */}
          <div>
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Severity Levels
            </h3>
            <div className="space-y-1">
              {SEVERITY_ITEMS.map(({ key, label, color, description }) => (
                <div
                  key={key}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-gray-900 font-medium w-14">{label}</span>
                  <span className="text-xs text-gray-500 truncate">{description}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Clusters Section */}
          <div>
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Event Clusters
            </h3>
            <div className="flex items-start gap-3 px-2 py-2 rounded bg-gray-50">
              {/* Cluster visual */}
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white border-2 border-blue-500 shadow-sm">
                <span className="text-xs font-bold text-blue-600">12</span>
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-700">
                  Numbered circles group nearby events.
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Click to see event timeline.
                </p>
              </div>
            </div>
          </div>

          {/* Keyboard hint */}
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Press <kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono text-xs">L</kbd> to toggle legend
            </p>
          </div>
        </div>
      )}
    </div>
  )
})

export default MapLegend
