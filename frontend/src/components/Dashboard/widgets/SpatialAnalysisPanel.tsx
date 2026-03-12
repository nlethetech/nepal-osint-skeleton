/**
 * SpatialAnalysisPanel - Export and spatial analysis controls
 *
 * Features:
 * - KML/KMZ/GeoJSON export dropdown
 * - Network Link URL generator for Google Earth
 * - Hotspot analysis toggle with parameter controls
 * - Proximity circle tool activation
 */

import { memo, useState, useCallback } from 'react'
import {
  Download,
  Radio,
  Target,
  Activity,
  Map,
  Copy,
  Check,
  ChevronDown,
  ExternalLink,
  Play,
  Settings,
  X,
} from 'lucide-react'
import { getNetworkLinkUrl, type HotspotParams } from '../../../api/spatial'
import apiClient from '../../../api/client'
import { useAuthStore } from '../../../store/slices/authSlice'

interface SpatialAnalysisPanelProps {
  hours: number
  categories: string[]
  onHotspotsToggle: (enabled: boolean, params?: HotspotParams) => void
  onProximityModeToggle: (enabled: boolean) => void
  onTemporalModeToggle?: (enabled: boolean) => void
  isHotspotsEnabled: boolean
  isProximityMode: boolean
  isTemporalMode?: boolean
  compact?: boolean
}

export const SpatialAnalysisPanel = memo(function SpatialAnalysisPanel({
  hours,
  categories,
  onHotspotsToggle,
  onProximityModeToggle,
  onTemporalModeToggle,
  isHotspotsEnabled,
  isProximityMode,
  isTemporalMode = false,
  compact = false,
}: SpatialAnalysisPanelProps) {
  const token = useAuthStore((s) => s.token)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showHotspotSettings, setShowHotspotSettings] = useState(false)
  const [networkLinkCopied, setNetworkLinkCopied] = useState(false)
  const [hotspotParams, setHotspotParams] = useState<HotspotParams>({
    eps_km: 25,
    min_cluster_size: 3,
    hours: 168, // 7 days
  })

  const categoriesParam = categories.length > 0 ? categories.join(',') : undefined

  const handleExport = useCallback(async (format: 'kml' | 'kmz') => {
    try {
      const { data } = await apiClient.get('/spatial/export/kml', {
        params: {
          hours,
          categories: categoriesParam,
          format,
        },
        responseType: 'blob',
      })

      const blob = data as Blob
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `spatial_export.${format}`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export KML/KMZ:', err)
    } finally {
      setShowExportMenu(false)
    }
  }, [hours, categoriesParam])

  const copyNetworkLink = useCallback(async () => {
    const urlObj = new URL(getNetworkLinkUrl({
      refresh_interval: 300, // 5 minutes
      hours,
      categories: categoriesParam,
    }), window.location.origin)
    if (token) {
      urlObj.searchParams.set('token', token)
    }
    try {
      await navigator.clipboard.writeText(urlObj.toString())
      setNetworkLinkCopied(true)
      setTimeout(() => setNetworkLinkCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [hours, categoriesParam, token])

  const toggleHotspots = useCallback(() => {
    const newEnabled = !isHotspotsEnabled
    onHotspotsToggle(newEnabled, newEnabled ? hotspotParams : undefined)
  }, [isHotspotsEnabled, onHotspotsToggle, hotspotParams])

  const applyHotspotSettings = useCallback(() => {
    if (isHotspotsEnabled) {
      onHotspotsToggle(true, hotspotParams)
    }
    setShowHotspotSettings(false)
  }, [isHotspotsEnabled, onHotspotsToggle, hotspotParams])

  // Compact mode for small widgets
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {/* Export */}
        <button
          onClick={() => handleExport('kml')}
          className="p-1.5 rounded hover:bg-white/5 transition-colors"
          title="Export KML"
        >
          <Download size={14} className="text-slate-400" />
        </button>

        {/* Live Feed */}
        <button
          onClick={copyNetworkLink}
          className="p-1.5 rounded hover:bg-white/5 transition-colors"
          title="Copy Google Earth Live Feed URL"
        >
          {networkLinkCopied ? (
            <Check size={14} className="text-green-500" />
          ) : (
            <Radio size={14} className="text-slate-400" />
          )}
        </button>

        {/* Hotspots */}
        <button
          onClick={toggleHotspots}
          className={`p-1.5 rounded transition-colors ${
            isHotspotsEnabled
              ? 'bg-orange-500/20 text-orange-400'
              : 'hover:bg-white/5 text-slate-400'
          }`}
          title="Toggle Hotspot Detection"
        >
          <Activity size={14} />
        </button>

        {/* Proximity */}
        <button
          onClick={() => onProximityModeToggle(!isProximityMode)}
          className={`p-1.5 rounded transition-colors ${
            isProximityMode
              ? 'bg-blue-500/20 text-blue-400'
              : 'hover:bg-white/5 text-slate-400'
          }`}
          title="Toggle Proximity Mode"
        >
          <Target size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {/* Export Dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowExportMenu(!showExportMenu)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 rounded border border-slate-700/50 transition-colors"
        >
          <Download size={12} />
          Export
          <ChevronDown size={10} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
        </button>

        {showExportMenu && (
          <div className="absolute top-full left-0 mt-1 py-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[140px]">
            <button
              onClick={() => handleExport('kml')}
              className="w-full px-3 py-1.5 text-[11px] text-left text-slate-300 hover:bg-slate-700/50 flex items-center gap-2"
            >
              <Map size={12} />
              KML (Google Earth)
            </button>
            <button
              onClick={() => handleExport('kmz')}
              className="w-full px-3 py-1.5 text-[11px] text-left text-slate-300 hover:bg-slate-700/50 flex items-center gap-2"
            >
              <Map size={12} />
              KMZ (Compressed)
            </button>
            <hr className="my-1 border-slate-700" />
            <div className="px-3 py-1 text-[10px] text-slate-500">
              Exports last {hours}h of events
            </div>
          </div>
        )}
      </div>

      {/* Network Link */}
      <button
        onClick={copyNetworkLink}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 rounded border border-slate-700/50 transition-colors"
        title="Copy Google Earth Network Link URL for live data feed"
      >
        {networkLinkCopied ? (
          <>
            <Check size={12} className="text-green-500" />
            <span className="text-green-400">Copied!</span>
          </>
        ) : (
          <>
            <Radio size={12} />
            Live Feed
          </>
        )}
      </button>

      {/* Hotspot Analysis */}
      <div className="relative flex items-center">
        <button
          onClick={toggleHotspots}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-l border transition-colors ${
            isHotspotsEnabled
              ? 'bg-orange-500/20 text-orange-400 border-orange-500/50'
              : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border-slate-700/50'
          }`}
        >
          <Activity size={12} />
          Hotspots
        </button>
        <button
          onClick={() => setShowHotspotSettings(!showHotspotSettings)}
          className={`px-1.5 py-1.5 text-[11px] font-medium rounded-r border-y border-r transition-colors ${
            isHotspotsEnabled
              ? 'bg-orange-500/20 text-orange-400 border-orange-500/50'
              : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border-slate-700/50'
          }`}
        >
          <Settings size={10} />
        </button>

        {/* Hotspot Settings Popover */}
        {showHotspotSettings && (
          <div className="absolute top-full left-0 mt-1 p-3 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 min-w-[200px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-200">Hotspot Settings</span>
              <button
                onClick={() => setShowHotspotSettings(false)}
                className="p-0.5 hover:bg-slate-700 rounded"
              >
                <X size={12} className="text-slate-400" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Cluster Radius (km)
                </label>
                <input
                  type="range"
                  min="5"
                  max="100"
                  value={hotspotParams.eps_km}
                  onChange={(e) => setHotspotParams(p => ({ ...p, eps_km: Number(e.target.value) }))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-[10px] text-slate-300 text-right">{hotspotParams.eps_km} km</div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Min Events per Cluster
                </label>
                <input
                  type="range"
                  min="2"
                  max="20"
                  value={hotspotParams.min_cluster_size}
                  onChange={(e) => setHotspotParams(p => ({ ...p, min_cluster_size: Number(e.target.value) }))}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-[10px] text-slate-300 text-right">{hotspotParams.min_cluster_size} events</div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 mb-1 block">
                  Time Window
                </label>
                <select
                  value={hotspotParams.hours}
                  onChange={(e) => setHotspotParams(p => ({ ...p, hours: Number(e.target.value) }))}
                  className="w-full px-2 py-1 text-[11px] bg-slate-700 border border-slate-600 rounded text-slate-200"
                >
                  <option value={24}>24 hours</option>
                  <option value={72}>3 days</option>
                  <option value={168}>7 days</option>
                  <option value={336}>14 days</option>
                  <option value={720}>30 days</option>
                </select>
              </div>

              <button
                onClick={applyHotspotSettings}
                className="w-full py-1.5 text-[11px] font-medium bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
              >
                Apply Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Proximity Mode */}
      <button
        onClick={() => onProximityModeToggle(!isProximityMode)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded border transition-colors ${
          isProximityMode
            ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
            : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border-slate-700/50'
        }`}
        title="Click map to set center point for proximity analysis"
      >
        <Target size={12} />
        Proximity
      </button>

      {/* Temporal Animation (optional) */}
      {onTemporalModeToggle && (
        <button
          onClick={() => onTemporalModeToggle(!isTemporalMode)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded border transition-colors ${
            isTemporalMode
              ? 'bg-purple-500/20 text-purple-400 border-purple-500/50'
              : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-300 border-slate-700/50'
          }`}
          title="Play temporal animation"
        >
          <Play size={12} />
          Timeline
        </button>
      )}
    </div>
  )
});

export default SpatialAnalysisPanel
