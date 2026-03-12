import { useState, useEffect } from 'react'
import { Trophy, Crown } from 'lucide-react'
import { HTMLSelect, Button, Tag, Intent, Spinner } from '@blueprintjs/core'
import { getInfluenceLeaderboard, type LeaderboardEntry } from '../../api/entityIntelligence'

interface InfluenceLeaderboardProps {
  window?: string
  metric?: string
  limit?: number
  onEntityClick?: (entityId: string) => void
  className?: string
}

const METRIC_OPTIONS = [
  { value: 'pagerank', label: 'PageRank', description: 'Overall influence' },
  { value: 'betweenness', label: 'Betweenness', description: 'Bridge importance' },
  { value: 'degree', label: 'Degree', description: 'Connection count' },
  { value: 'eigenvector', label: 'Eigenvector', description: 'Connected to influencers' },
]

const WINDOW_OPTIONS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]

export function InfluenceLeaderboard({
  window: initialWindow = '7d',
  metric: initialMetric = 'pagerank',
  limit = 20,
  onEntityClick,
  className = '',
}: InfluenceLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMetric, setSelectedMetric] = useState(initialMetric)
  const [selectedWindow, setSelectedWindow] = useState(initialWindow)

  useEffect(() => {
    loadLeaderboard()
  }, [selectedMetric, selectedWindow, limit])

  const loadLeaderboard = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await getInfluenceLeaderboard({
        window: selectedWindow,
        metric: selectedMetric,
        limit,
      })
      setEntries(data.leaderboard)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard')
    } finally {
      setIsLoading(false)
    }
  }

  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center">
          <Crown size={12} style={{ color: '#ffffff' }} />
        </div>
      )
    }
    if (rank === 2) {
      return (
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gray-300 to-gray-500 flex items-center justify-center">
          <span style={{ fontSize: 10, fontWeight: 700, color: '#ffffff' }}>2</span>
        </div>
      )
    }
    if (rank === 3) {
      return (
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
          <span style={{ fontSize: 10, fontWeight: 700, color: '#ffffff' }}>3</span>
        </div>
      )
    }
    return (
      <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: '#1a1a1c' }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: '#b6bcc8' }}>{rank}</span>
      </div>
    )
  }

  const getMetricValue = (entry: LeaderboardEntry) => {
    const value = entry.metrics[selectedMetric as keyof typeof entry.metrics]
    if (typeof value === 'number') {
      return value.toFixed(4)
    }
    return '-'
  }

  const getMetricLabel = () => {
    return METRIC_OPTIONS.find((m) => m.value === selectedMetric)?.label || selectedMetric
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #252528' }}>
        <div className="flex items-center gap-2">
          <Trophy size={14} className="text-yellow-400" />
          <h3 style={{ fontSize: 12, fontWeight: 600, color: '#e8e8ea' }}>
            Influence Leaderboard
          </h3>
        </div>
        <Button minimal small icon="refresh" loading={isLoading} onClick={loadLeaderboard}
          style={{ color: '#b6bcc8' }} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid #252528' }}>
        {/* Metric Selector */}
        <HTMLSelect minimal value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)}
          options={METRIC_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          style={{ fontSize: 10, backgroundColor: '#1a1a1c', color: '#b6bcc8' }} />

        {/* Window Selector */}
        <div className="flex items-center gap-0.5">
          {WINDOW_OPTIONS.map((opt) => (
            <Button key={opt.value} small minimal
              text={opt.label}
              active={selectedWindow === opt.value}
              onClick={() => setSelectedWindow(opt.value)}
              style={{ fontSize: 10, color: selectedWindow === opt.value ? '#e8e8ea' : '#b6bcc8' }} />
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Spinner size={20} intent={Intent.PRIMARY} />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-xs text-red-400">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-32" style={{ fontSize: 12, color: '#b6bcc8' }}>
            No data available
          </div>
        ) : (
          <div>
            {entries.map((entry, idx) => (
              <button
                key={entry.entity.id}
                onClick={() => onEntityClick?.(entry.entity.id)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left"
                style={{
                  borderBottom: idx < entries.length - 1 ? '1px solid #252528' : undefined,
                  transition: 'background-color 150ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1a1a1c' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                {/* Rank */}
                {getRankBadge(entry.rank)}

                {/* Entity Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate" style={{ fontSize: 12, fontWeight: 500, color: '#e8e8ea' }}>
                      {entry.entity.name_en}
                    </span>
                    {entry.metrics.is_hub && <Tag minimal intent={Intent.PRIMARY} style={{ fontSize: 8 }}>HUB</Tag>}
                    {entry.metrics.is_bridge && <Tag minimal intent={Intent.SUCCESS} style={{ fontSize: 8 }}>BRIDGE</Tag>}
                  </div>
                  <div className="flex items-center gap-2" style={{ fontSize: 10, color: '#b6bcc8' }}>
                    <span className="capitalize">{entry.entity.entity_type}</span>
                    {entry.entity.party && (
                      <>
                        <span>•</span>
                        <span>{entry.entity.party}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Metric Value */}
                <div className="text-right">
                  <div className="font-mono" style={{ fontSize: 12, color: '#b6bcc8' }}>
                    {getMetricValue(entry)}
                  </div>
                  <div style={{ fontSize: 9, color: '#b6bcc8' }}>
                    {entry.metrics.total_connections} connections
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-3 py-2" style={{ borderTop: '1px solid #252528', fontSize: 9, color: '#b6bcc8' }}>
        Ranked by {getMetricLabel()} ({selectedWindow} window)
      </div>
    </div>
  )
}
