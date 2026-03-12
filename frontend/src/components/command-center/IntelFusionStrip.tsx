import { AlertTriangle, GitBranch, MapPin, Clock, ChevronRight, X } from 'lucide-react'
import { useCommandCenterStore, type IntelCorrelation } from '../../stores/commandCenterStore'

interface IntelFusionStripProps {
  onCorrelationClick?: (correlation: IntelCorrelation) => void
}

export function IntelFusionStrip({ onCorrelationClick }: IntelFusionStripProps) {
  const { threatLevel, correlations, activeHotspots, executiveSummary, totalStories, filters } = useCommandCenterStore()

  const getThreatConfig = () => {
    switch (threatLevel) {
      case 'CRITICAL':
        return {
          bg: 'bg-gradient-to-r from-red-900/40 to-red-800/20',
          border: 'border-red-500/30',
          icon: 'text-red-400',
          pulse: 'animate-pulse',
        }
      case 'ELEVATED':
        return {
          bg: 'bg-gradient-to-r from-orange-900/30 to-orange-800/10',
          border: 'border-orange-500/20',
          icon: 'text-orange-400',
          pulse: '',
        }
      case 'GUARDED':
        return {
          bg: 'bg-gradient-to-r from-yellow-900/20 to-yellow-800/5',
          border: 'border-yellow-500/20',
          icon: 'text-yellow-400',
          pulse: '',
        }
      default:
        return {
          bg: 'bg-gradient-to-r from-green-900/20 to-green-800/5',
          border: 'border-green-500/20',
          icon: 'text-green-400',
          pulse: '',
        }
    }
  }

  const config = getThreatConfig()

  // Get correlation icon
  const getCorrelationIcon = (type: IntelCorrelation['type']) => {
    switch (type) {
      case 'entity_spike': return AlertTriangle
      case 'geographic_cluster': return MapPin
      case 'temporal_pattern': return Clock
      case 'cross_category': return GitBranch
      default: return GitBranch
    }
  }

  return (
    <div className={`flex items-center gap-4 px-4 py-2 ${config.bg} border-b ${config.border}`}>
      {/* Threat Level Indicator */}
      <div className="flex items-center gap-2">
        <div className={`flex items-center gap-1.5 ${config.icon} ${config.pulse}`}>
          <AlertTriangle size={14} />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Threat: {threatLevel}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-[var(--pro-border-subtle)]" />

      {/* Key Judgment / Summary */}
      {executiveSummary?.key_judgment && (
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--pro-text-secondary)] truncate">
            <span className="text-[var(--pro-text-muted)]">Assessment:</span>{' '}
            {executiveSummary.key_judgment}
          </p>
        </div>
      )}

      {/* Divider */}
      <div className="w-px h-4 bg-[var(--pro-border-subtle)]" />

      {/* Correlations */}
      {correlations.length > 0 && (
        <div className="flex items-center gap-2">
          <GitBranch size={12} className="text-[var(--pro-accent)]" />
          <span className="text-[11px] text-[var(--pro-text-muted)]">
            {correlations.length} Correlations
          </span>
          <div className="flex items-center gap-1">
            {correlations.slice(0, 3).map((corr) => {
              const Icon = getCorrelationIcon(corr.type)
              return (
                <button
                  key={corr.id}
                  onClick={() => onCorrelationClick?.(corr)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[var(--pro-accent-muted)] text-[var(--pro-accent)] rounded hover:bg-[var(--pro-accent)]/20 transition-colors"
                  title={corr.title}
                >
                  <Icon size={10} />
                  <span className="max-w-20 truncate">{corr.title}</span>
                </button>
              )
            })}
            {correlations.length > 3 && (
              <button className="text-[10px] text-[var(--pro-text-muted)] hover:text-[var(--pro-accent)]">
                +{correlations.length - 3}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hotspots */}
      {activeHotspots.length > 0 && (
        <>
          <div className="w-px h-4 bg-[var(--pro-border-subtle)]" />
          <div className="flex items-center gap-2">
            <MapPin size={12} className="text-red-400" />
            <span className="text-[11px] text-[var(--pro-text-muted)]">
              Hotspots:
            </span>
            <div className="flex items-center gap-1">
              {activeHotspots.slice(0, 3).map((district) => (
                <span
                  key={district}
                  className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-300 rounded"
                >
                  {district}
                </span>
              ))}
              {activeHotspots.length > 3 && (
                <span className="text-[10px] text-[var(--pro-text-muted)]">
                  +{activeHotspots.length - 3}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Right: Stats */}
      <div className="ml-auto flex items-center gap-3 text-[10px] text-[var(--pro-text-muted)]">
        <span className="font-mono">{totalStories} stories</span>
        <span className="font-mono">{filters.hours}h window</span>
        {executiveSummary?.threat_trajectory && (
          <span className={`px-1.5 py-0.5 rounded ${
            executiveSummary.threat_trajectory === 'ESCALATING'
              ? 'bg-red-500/20 text-red-400'
              : executiveSummary.threat_trajectory === 'DE-ESCALATING'
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-500/20 text-gray-400'
          }`}>
            {executiveSummary.threat_trajectory}
          </span>
        )}
      </div>
    </div>
  )
}
