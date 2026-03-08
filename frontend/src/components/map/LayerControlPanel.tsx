import { useState, useEffect } from 'react'
import {
  Layers,
  Map,
  Satellite,
  Cloud,
  AlertTriangle,
  Droplet,
  Mountain,
  Activity,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
} from 'lucide-react'
import apiClient from '../../api/client'

interface LayerSource {
  type: string
  url?: string
  api_endpoint?: string
  refresh_interval?: number
}

interface LayerConfig {
  id: string
  name: string
  description?: string
  category: string
  type: string
  source: LayerSource
  visible: boolean
  opacity: number
  min_zoom?: number
  max_zoom?: number
  legend?: {
    type: string
    min?: number
    max?: number
    colors?: string[]
    labels?: string[]
    items?: Array<{ color: string; label: string }>
  }
  style?: Record<string, unknown>
  attribution?: string
}

interface LayerGroup {
  id: string
  name: string
  layers: LayerConfig[]
  exclusive: boolean
}

interface LayerConfigResponse {
  base_layers: LayerConfig[]
  overlay_layers: LayerConfig[]
  data_layers: LayerConfig[]
  groups: LayerGroup[]
}

interface LayerControlPanelProps {
  onLayerToggle?: (layerId: string, visible: boolean) => void
  onLayerOpacityChange?: (layerId: string, opacity: number) => void
  onBaseLayerChange?: (layerId: string) => void
  className?: string
}

const CATEGORY_ICONS: Record<string, typeof Layers> = {
  base: Map,
  overlay: Satellite,
  data: Activity,
}

const LAYER_ICONS: Record<string, typeof Layers> = {
  osm: Map,
  'carto-dark': Map,
  'carto-voyager': Map,
  'sentinel2-rgb': Satellite,
  ndvi: Mountain,
  'flood-extent': Droplet,
  'damage-pwtt': AlertTriangle,
  'landslide-risk': Mountain,
  events: Activity,
  'river-stations': Droplet,
  curfews: AlertTriangle,
  seismic: Activity,
  'threat-heatmap': AlertTriangle,
}

export function LayerControlPanel({
  onLayerToggle,
  onLayerOpacityChange,
  onBaseLayerChange,
  className = '',
}: LayerControlPanelProps) {
  const [config, setConfig] = useState<LayerConfigResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    base: true,
    overlay: false,
    data: true,
  })
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({})
  const [layerOpacities, setLayerOpacities] = useState<Record<string, number>>({})
  const [selectedBaseLayer, setSelectedBaseLayer] = useState<string>('carto-dark')

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await apiClient.get('/layers/config')
      const data: LayerConfigResponse = response.data

      setConfig(data)

      // Initialize layer states
      const initialActive: Record<string, boolean> = {}
      const initialOpacity: Record<string, number> = {};

      [...data.base_layers, ...data.overlay_layers, ...data.data_layers].forEach((layer) => {
        initialActive[layer.id] = layer.visible
        initialOpacity[layer.id] = layer.opacity
      })

      setActiveLayers(initialActive)
      setLayerOpacities(initialOpacity)

      // Find default base layer
      const defaultBase = data.base_layers.find((l) => l.visible)
      if (defaultBase) {
        setSelectedBaseLayer(defaultBase.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load layer config')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }))
  }

  const toggleLayer = (layerId: string, isBaseLayer = false) => {
    if (isBaseLayer) {
      setSelectedBaseLayer(layerId)
      onBaseLayerChange?.(layerId)
    } else {
      const newState = !activeLayers[layerId]
      setActiveLayers((prev) => ({
        ...prev,
        [layerId]: newState,
      }))
      onLayerToggle?.(layerId, newState)
    }
  }

  const changeOpacity = (layerId: string, opacity: number) => {
    setLayerOpacities((prev) => ({
      ...prev,
      [layerId]: opacity,
    }))
    onLayerOpacityChange?.(layerId, opacity)
  }

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-32 ${className}`}>
        <div className="w-4 h-4 border-2 border-[var(--pro-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-xs text-red-400 mb-2">{error || 'Config not available'}</p>
        <button
          onClick={loadConfig}
          className="text-xs text-[var(--pro-accent)] hover:underline"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--pro-border-subtle)]">
        <Layers size={14} className="text-[var(--pro-accent)]" />
        <h3 className="text-xs font-semibold text-[var(--pro-text-primary)]">
          Map Layers
        </h3>
      </div>

      {/* Layer List */}
      <div className="flex-1 overflow-y-auto">
        {/* Base Layers */}
        <LayerCategory
          title="Base Maps"
          icon={Map}
          isExpanded={expandedCategories.base}
          onToggle={() => toggleCategory('base')}
        >
          {config.base_layers.map((layer) => (
            <BaseLayerItem
              key={layer.id}
              layer={layer}
              isSelected={selectedBaseLayer === layer.id}
              onSelect={() => toggleLayer(layer.id, true)}
            />
          ))}
        </LayerCategory>

        {/* Overlay Layers */}
        <LayerCategory
          title="Analysis Overlays"
          icon={Satellite}
          isExpanded={expandedCategories.overlay}
          onToggle={() => toggleCategory('overlay')}
        >
          {config.overlay_layers.map((layer) => (
            <OverlayLayerItem
              key={layer.id}
              layer={layer}
              isActive={activeLayers[layer.id]}
              opacity={layerOpacities[layer.id]}
              onToggle={() => toggleLayer(layer.id)}
              onOpacityChange={(opacity) => changeOpacity(layer.id, opacity)}
            />
          ))}
        </LayerCategory>

        {/* Data Layers */}
        <LayerCategory
          title="Data Layers"
          icon={Activity}
          isExpanded={expandedCategories.data}
          onToggle={() => toggleCategory('data')}
        >
          {config.data_layers.map((layer) => (
            <DataLayerItem
              key={layer.id}
              layer={layer}
              isActive={activeLayers[layer.id]}
              onToggle={() => toggleLayer(layer.id)}
            />
          ))}
        </LayerCategory>
      </div>
    </div>
  )
}

// Category Component
function LayerCategory({
  title,
  icon: Icon,
  isExpanded,
  onToggle,
  children,
}: {
  title: string
  icon: typeof Layers
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-[var(--pro-border-subtle)]">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--pro-bg-hover)] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown size={12} className="text-[var(--pro-text-muted)]" />
        ) : (
          <ChevronRight size={12} className="text-[var(--pro-text-muted)]" />
        )}
        <Icon size={12} className="text-[var(--pro-text-muted)]" />
        <span className="text-xs font-medium text-[var(--pro-text-secondary)]">
          {title}
        </span>
      </button>
      {isExpanded && (
        <div className="pb-2">
          {children}
        </div>
      )}
    </div>
  )
}

// Base Layer Item (radio-style selection)
function BaseLayerItem({
  layer,
  isSelected,
  onSelect,
}: {
  layer: LayerConfig
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = LAYER_ICONS[layer.id] || Map

  return (
    <button
      onClick={onSelect}
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors
        ${isSelected
          ? 'bg-[var(--pro-accent-muted)]'
          : 'hover:bg-[var(--pro-bg-hover)]'
        }
      `}
    >
      <div className={`
        w-4 h-4 rounded-full border-2 flex items-center justify-center
        ${isSelected
          ? 'border-[var(--pro-accent)]'
          : 'border-[var(--pro-border-subtle)]'
        }
      `}>
        {isSelected && (
          <div className="w-2 h-2 rounded-full bg-[var(--pro-accent)]" />
        )}
      </div>
      <Icon size={12} className="text-[var(--pro-text-muted)]" />
      <span className={`text-xs ${isSelected ? 'text-[var(--pro-accent)]' : 'text-[var(--pro-text-muted)]'}`}>
        {layer.name}
      </span>
    </button>
  )
}

// Overlay Layer Item (checkbox-style with opacity slider)
function OverlayLayerItem({
  layer,
  isActive,
  opacity,
  onToggle,
  onOpacityChange,
}: {
  layer: LayerConfig
  isActive: boolean
  opacity: number
  onToggle: () => void
  onOpacityChange: (opacity: number) => void
}) {
  const [showDetails, setShowDetails] = useState(false)
  const Icon = LAYER_ICONS[layer.id] || Satellite

  return (
    <div className="px-3 py-1">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`
            p-1 rounded transition-colors
            ${isActive
              ? 'text-[var(--pro-accent)]'
              : 'text-[var(--pro-text-disabled)] hover:text-[var(--pro-text-muted)]'
            }
          `}
        >
          {isActive ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <Icon size={12} className="text-[var(--pro-text-muted)]" />
        <span className={`text-xs flex-1 ${isActive ? 'text-[var(--pro-text-secondary)]' : 'text-[var(--pro-text-muted)]'}`}>
          {layer.name}
        </span>
        {layer.description && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="p-1 text-[var(--pro-text-disabled)] hover:text-[var(--pro-text-muted)]"
          >
            <Info size={10} />
          </button>
        )}
      </div>

      {/* Opacity Slider */}
      {isActive && (
        <div className="flex items-center gap-2 mt-1 ml-7">
          <span className="text-[9px] text-[var(--pro-text-disabled)] w-12">Opacity</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={opacity}
            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
            className="flex-1 h-1 cursor-pointer"
          />
          <span className="text-[9px] text-[var(--pro-text-muted)] w-6 text-right">
            {Math.round(opacity * 100)}%
          </span>
        </div>
      )}

      {/* Description */}
      {showDetails && layer.description && (
        <p className="text-[9px] text-[var(--pro-text-disabled)] mt-1 ml-7 leading-relaxed">
          {layer.description}
        </p>
      )}

      {/* Legend */}
      {isActive && layer.legend && (
        <div className="mt-2 ml-7">
          <LayerLegend legend={layer.legend} />
        </div>
      )}
    </div>
  )
}

// Data Layer Item
function DataLayerItem({
  layer,
  isActive,
  onToggle,
}: {
  layer: LayerConfig
  isActive: boolean
  onToggle: () => void
}) {
  const Icon = LAYER_ICONS[layer.id] || Activity

  return (
    <button
      onClick={onToggle}
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors
        ${isActive
          ? 'bg-[var(--pro-accent-muted)]'
          : 'hover:bg-[var(--pro-bg-hover)]'
        }
      `}
    >
      <div className={`
        w-4 h-4 rounded border flex items-center justify-center
        ${isActive
          ? 'border-[var(--pro-accent)] bg-[var(--pro-accent)]'
          : 'border-[var(--pro-border-subtle)]'
        }
      `}>
        {isActive && (
          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </div>
      <Icon size={12} className="text-[var(--pro-text-muted)]" />
      <span className={`text-xs ${isActive ? 'text-[var(--pro-accent)]' : 'text-[var(--pro-text-muted)]'}`}>
        {layer.name}
      </span>
      {layer.source.refresh_interval && (
        <span className="text-[9px] text-[var(--pro-text-disabled)] ml-auto">
          {Math.round(layer.source.refresh_interval / 60)}m
        </span>
      )}
    </button>
  )
}

// Legend Component
function LayerLegend({ legend }: { legend: LayerConfig['legend'] }) {
  if (!legend) return null

  if (legend.type === 'gradient' && legend.colors && legend.labels) {
    return (
      <div className="flex flex-col gap-1">
        <div
          className="h-2 rounded"
          style={{
            background: `linear-gradient(to right, ${legend.colors.join(', ')})`,
          }}
        />
        <div className="flex justify-between text-[8px] text-[var(--pro-text-disabled)]">
          {legend.labels.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>
      </div>
    )
  }

  if (legend.type === 'categorical' && legend.items) {
    return (
      <div className="flex flex-wrap gap-2">
        {legend.items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[8px] text-[var(--pro-text-disabled)]">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return null
}
