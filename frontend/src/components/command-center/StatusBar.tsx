import { Wifi, WifiOff, Clock, Database, RefreshCw } from 'lucide-react'
import { useCommandCenterStore } from '../../stores/commandCenterStore'

interface StatusBarProps {
  isConnected?: boolean
}

export function StatusBar({ isConnected = true }: StatusBarProps) {
  const { lastUpdated, isLoading, totalStories, filters, workspaceMode } = useCommandCenterStore()

  const formatLastUpdated = () => {
    if (!lastUpdated) return 'Never'
    const date = new Date(lastUpdated)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const getModeLabel = () => {
    switch (workspaceMode) {
      case 'situational': return 'Situational Awareness'
      case 'investigation': return 'Investigation Mode'
      case 'geospatial': return 'Geospatial Analysis'
      case 'entities': return 'Entity Intelligence'
      case 'custom': return 'Custom Layout'
      default: return 'Unknown Mode'
    }
  }

  return (
    <div className="h-full flex items-center justify-between px-4 bg-[var(--pro-bg-secondary)] border-t border-[var(--pro-border-subtle)] text-[10px] font-mono">
      {/* Left: Connection Status + Mode */}
      <div className="flex items-center gap-4 text-[var(--pro-text-muted)]">
        {/* Connection Status */}
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <>
              <Wifi size={10} className="text-green-400" />
              <span className="text-green-400">Connected</span>
            </>
          ) : (
            <>
              <WifiOff size={10} className="text-red-400" />
              <span className="text-red-400">Disconnected</span>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-3 bg-[var(--pro-border-subtle)]" />

        {/* Current Mode */}
        <span>{getModeLabel()}</span>
      </div>

      {/* Center: Stats */}
      <div className="flex items-center gap-4 text-[var(--pro-text-disabled)]">
        <div className="flex items-center gap-1.5">
          <Database size={10} />
          <span>{totalStories} stories</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={10} />
          <span>{filters.hours}h window</span>
        </div>
        {filters.categories.length > 0 && (
          <span className="text-[var(--pro-accent)]">
            {filters.categories.length} categories
          </span>
        )}
        {filters.severities.length > 0 && (
          <span className="text-orange-400">
            {filters.severities.length} severities
          </span>
        )}
        {filters.districts.length > 0 && (
          <span className="text-purple-400">
            {filters.districts.length} districts
          </span>
        )}
      </div>

      {/* Right: Last Updated */}
      <div className="flex items-center gap-3 text-[var(--pro-text-disabled)]">
        {isLoading && (
          <div className="flex items-center gap-1 text-[var(--pro-accent)]">
            <RefreshCw size={10} className="animate-spin" />
            <span>Updating...</span>
          </div>
        )}
        <span>Last sync: {formatLastUpdated()}</span>
      </div>
    </div>
  )
}
