import { Vote, Users, Award, BarChart3 } from 'lucide-react'
import { useElectionStore } from '../../stores/electionStore'

export function ElectionKPICards() {
  const { nationalSummary, isLoading } = useElectionStore()

  if (isLoading || !nationalSummary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-osint-card border border-osint-border rounded-lg p-3 animate-pulse">
            <div className="h-6 bg-osint-surface rounded w-16 mb-1" />
            <div className="h-3 bg-osint-surface rounded w-24" />
          </div>
        ))}
      </div>
    )
  }

  const cards = [
    {
      label: 'National Turnout',
      value: `${(nationalSummary.turnout_pct ?? 0).toFixed(1)}%`,
      subtitle: `${((nationalSummary.total_votes_cast ?? 0) / 1000000).toFixed(1)}M votes cast`,
      icon: Vote,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Results Declared',
      value: `${nationalSummary.declared}/${nationalSummary.total_constituencies}`,
      subtitle: `${nationalSummary.counting} counting`,
      icon: BarChart3,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      progress: (nationalSummary.declared / nationalSummary.total_constituencies) * 100,
    },
    {
      label: 'Leading Party',
      value: nationalSummary.leading_party,
      subtitle: `${nationalSummary.leading_party_seats} seats`,
      icon: Award,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
    },
    {
      label: 'Total Votes Cast',
      value: formatNumber(nationalSummary.total_votes_cast),
      subtitle: `${formatNumber(nationalSummary.total_registered_voters)} registered`,
      icon: Users,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map((card, i) => {
        const Icon = card.icon
        return (
          <div key={i} className="bg-osint-card border border-osint-border rounded-lg p-3 relative overflow-hidden">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-osint-muted uppercase tracking-wider font-medium">{card.label}</span>
              <div className={`p-1.5 rounded ${card.bgColor}`}>
                <Icon size={12} className={card.color} />
              </div>
            </div>
            <div className="text-xl font-semibold text-osint-text">{card.value}</div>
            <div className="text-[10px] text-osint-muted mt-0.5">{card.subtitle}</div>
            {card.progress !== undefined && (
              <div className="mt-2 h-1 bg-osint-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${card.progress}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}
