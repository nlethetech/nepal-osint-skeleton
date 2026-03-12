/**
 * AnomalyFlags - Vote anomaly detection panel
 *
 * Displays flagged constituencies with statistical anomalies:
 * high/low turnout, lopsided margins, close races.
 * Sorted by severity (red first, then amber).
 */

import { TrendingUp, TrendingDown, Target, AlertTriangle } from 'lucide-react'
import { useElectionStore, type AnomalyFlag } from '../../stores/electionStore'

const TYPE_ICONS: Record<AnomalyFlag['type'], typeof TrendingUp> = {
  high_turnout: TrendingUp,
  low_turnout: TrendingDown,
  lopsided_margin: Target,
  close_race: AlertTriangle,
}

const TYPE_LABELS: Record<AnomalyFlag['type'], string> = {
  high_turnout: 'High Turnout',
  low_turnout: 'Low Turnout',
  lopsided_margin: 'Lopsided',
  close_race: 'Close Race',
}

export function AnomalyFlags() {
  const { anomalyFlags } = useElectionStore()

  if (anomalyFlags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1">
        <AlertTriangle size={14} className="text-osint-muted" />
        <span className="text-[10px] text-osint-muted">No anomalies detected</span>
      </div>
    )
  }

  const critical = anomalyFlags.filter(f => f.severity === 'red').length
  const warnings = anomalyFlags.filter(f => f.severity === 'amber').length

  return (
    <div className="space-y-1.5 overflow-y-auto max-h-full">
      {/* Summary header */}
      <div className="flex items-center gap-2 text-[10px] mb-1">
        {critical > 0 && (
          <span className="text-red-400 font-medium">{critical} critical</span>
        )}
        {warnings > 0 && (
          <span className="text-amber-400 font-medium">{warnings} warnings</span>
        )}
      </div>

      {/* Anomaly cards */}
      {anomalyFlags.map((flag, i) => (
        <AnomalyCard key={`${flag.constituency_id}-${flag.type}-${i}`} flag={flag} />
      ))}
    </div>
  )
}

function AnomalyCard({ flag }: { flag: AnomalyFlag }) {
  const Icon = TYPE_ICONS[flag.type]
  const isRed = flag.severity === 'red'

  return (
    <div className={`rounded-lg px-2 py-1.5 border ${
      isRed
        ? 'bg-red-500/10 border-red-500/20'
        : 'bg-amber-500/10 border-amber-500/20'
    }`}>
      <div className="flex items-center gap-1.5">
        <Icon size={11} className={isRed ? 'text-red-400' : 'text-amber-400'} />
        <span className="text-[10px] text-osint-text flex-1 truncate">{flag.constituency_name}</span>
        <span className={`text-[8px] px-1 py-0.5 rounded font-medium ${
          isRed ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
        }`}>
          {TYPE_LABELS[flag.type]}
        </span>
      </div>
      <div className="text-[9px] text-osint-muted mt-0.5 pl-4">
        {flag.description}
      </div>
      <div className="text-[8px] text-osint-muted mt-0.5 pl-4">
        {flag.district}
      </div>
    </div>
  )
}
