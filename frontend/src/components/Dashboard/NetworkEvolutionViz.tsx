import { useState, useMemo } from 'react'
import {
  Network,
  TrendingUp,
  TrendingDown,
  Users,
  Zap,
  Clock,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause
} from 'lucide-react'

interface NetworkSnapshot {
  timestamp: string
  label: string
  metrics: {
    nodes: number
    edges: number
    density: number
    avg_clustering: number
    communities: number
  }
  top_entities: Array<{
    id: string
    name: string
    centrality: number
    change: number
  }>
  significant_changes: Array<{
    type: 'new_connection' | 'broken_connection' | 'influence_shift' | 'community_merge'
    description: string
    significance: 'high' | 'medium' | 'low'
  }>
}

interface NetworkEvolutionVizProps {
  snapshots?: NetworkSnapshot[]
  autoPlayInterval?: number
}

const mockSnapshots: NetworkSnapshot[] = [
  {
    timestamp: '2024-01-10T00:00:00Z',
    label: 'Week 1',
    metrics: { nodes: 1245, edges: 3420, density: 0.0044, avg_clustering: 0.32, communities: 12 },
    top_entities: [
      { id: 'E001', name: 'Ministry of Home Affairs', centrality: 0.85, change: 0 },
      { id: 'E002', name: 'Nepal Police HQ', centrality: 0.78, change: 0.02 },
      { id: 'E003', name: 'PM Office', centrality: 0.72, change: -0.01 },
    ],
    significant_changes: []
  },
  {
    timestamp: '2024-01-17T00:00:00Z',
    label: 'Week 2',
    metrics: { nodes: 1289, edges: 3580, density: 0.0043, avg_clustering: 0.33, communities: 12 },
    top_entities: [
      { id: 'E001', name: 'Ministry of Home Affairs', centrality: 0.87, change: 0.02 },
      { id: 'E002', name: 'Nepal Police HQ', centrality: 0.76, change: -0.02 },
      { id: 'E004', name: 'Election Commission', centrality: 0.74, change: 0.08 },
    ],
    significant_changes: [
      { type: 'influence_shift', description: 'Election Commission centrality increased by 12%', significance: 'high' },
      { type: 'new_connection', description: '45 new connections to electoral bodies', significance: 'medium' },
    ]
  },
  {
    timestamp: '2024-01-24T00:00:00Z',
    label: 'Week 3',
    metrics: { nodes: 1312, edges: 3750, density: 0.0044, avg_clustering: 0.35, communities: 11 },
    top_entities: [
      { id: 'E004', name: 'Election Commission', centrality: 0.89, change: 0.15 },
      { id: 'E001', name: 'Ministry of Home Affairs', centrality: 0.84, change: -0.03 },
      { id: 'E005', name: 'Major Political Party A', centrality: 0.79, change: 0.10 },
    ],
    significant_changes: [
      { type: 'influence_shift', description: 'Election Commission now top centrality node', significance: 'high' },
      { type: 'community_merge', description: 'Two political communities merged (election coalition)', significance: 'high' },
      { type: 'new_connection', description: '78 new inter-party connections', significance: 'medium' },
    ]
  },
  {
    timestamp: '2024-01-31T00:00:00Z',
    label: 'Week 4',
    metrics: { nodes: 1356, edges: 3920, density: 0.0043, avg_clustering: 0.34, communities: 10 },
    top_entities: [
      { id: 'E004', name: 'Election Commission', centrality: 0.92, change: 0.03 },
      { id: 'E005', name: 'Major Political Party A', centrality: 0.85, change: 0.06 },
      { id: 'E006', name: 'Major Political Party B', centrality: 0.82, change: 0.08 },
    ],
    significant_changes: [
      { type: 'influence_shift', description: 'Political parties surge in network importance', significance: 'high' },
      { type: 'community_merge', description: 'Additional community consolidation detected', significance: 'medium' },
    ]
  },
]

export function NetworkEvolutionViz({
  snapshots = mockSnapshots,
  autoPlayInterval = 3000
}: NetworkEvolutionVizProps) {
  const [currentIndex, setCurrentIndex] = useState(snapshots.length - 1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showChanges, setShowChanges] = useState(true)

  const currentSnapshot = snapshots[currentIndex]
  const previousSnapshot = currentIndex > 0 ? snapshots[currentIndex - 1] : null

  const metricChanges = useMemo(() => {
    if (!previousSnapshot) return null
    return {
      nodes: currentSnapshot.metrics.nodes - previousSnapshot.metrics.nodes,
      edges: currentSnapshot.metrics.edges - previousSnapshot.metrics.edges,
      density: ((currentSnapshot.metrics.density - previousSnapshot.metrics.density) / previousSnapshot.metrics.density * 100),
      clustering: ((currentSnapshot.metrics.avg_clustering - previousSnapshot.metrics.avg_clustering) / previousSnapshot.metrics.avg_clustering * 100),
      communities: currentSnapshot.metrics.communities - previousSnapshot.metrics.communities,
    }
  }, [currentSnapshot, previousSnapshot])

  const handlePrevious = () => {
    setCurrentIndex(prev => Math.max(0, prev - 1))
  }

  const handleNext = () => {
    setCurrentIndex(prev => Math.min(snapshots.length - 1, prev + 1))
  }

  const getSignificanceColor = (significance: string): string => {
    switch (significance) {
      case 'high':
        return 'text-severity-critical'
      case 'medium':
        return 'text-severity-high'
      case 'low':
        return 'text-severity-medium'
      default:
        return 'text-osint-muted'
    }
  }

  const getChangeTypeIcon = (type: string) => {
    switch (type) {
      case 'new_connection':
        return <Zap size={12} className="text-severity-low" />
      case 'broken_connection':
        return <Zap size={12} className="text-severity-critical" />
      case 'influence_shift':
        return <TrendingUp size={12} className="text-entity-organization" />
      case 'community_merge':
        return <Users size={12} className="text-primary-400" />
      default:
        return <Clock size={12} className="text-osint-muted" />
    }
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Network className="text-primary-400" size={20} />
            <h3 className="font-semibold text-osint-text">Network Evolution</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChanges(!showChanges)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showChanges ? 'bg-primary-600 text-white' : 'bg-osint-border text-osint-muted'
              }`}
            >
              Changes
            </button>
          </div>
        </div>

        {/* Timeline Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="p-1.5 rounded hover:bg-osint-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} className="text-osint-muted" />
          </button>

          <div className="flex-1 flex items-center gap-1">
            {snapshots.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`flex-1 h-1.5 rounded-full transition-colors ${
                  idx === currentIndex
                    ? 'bg-primary-500'
                    : idx < currentIndex
                    ? 'bg-primary-500/40'
                    : 'bg-osint-border'
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={currentIndex === snapshots.length - 1}
            className="p-1.5 rounded hover:bg-osint-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} className="text-osint-muted" />
          </button>

          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1.5 rounded hover:bg-osint-border transition-colors"
          >
            {isPlaying ? (
              <Pause size={16} className="text-osint-muted" />
            ) : (
              <Play size={16} className="text-osint-muted" />
            )}
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs text-osint-muted">
          <span>{currentSnapshot.label}</span>
          <span>{new Date(currentSnapshot.timestamp).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="p-4">
        <div className="grid grid-cols-5 gap-2 mb-4">
          {[
            { label: 'Nodes', value: currentSnapshot.metrics.nodes, change: metricChanges?.nodes },
            { label: 'Edges', value: currentSnapshot.metrics.edges, change: metricChanges?.edges },
            { label: 'Density', value: (currentSnapshot.metrics.density * 1000).toFixed(2), change: metricChanges?.density?.toFixed(1), suffix: '%' },
            { label: 'Clustering', value: currentSnapshot.metrics.avg_clustering.toFixed(2), change: metricChanges?.clustering?.toFixed(1), suffix: '%' },
            { label: 'Communities', value: currentSnapshot.metrics.communities, change: metricChanges?.communities },
          ].map(metric => (
            <div key={metric.label} className="p-2 rounded-lg bg-osint-bg border border-osint-border text-center">
              <p className="text-xs text-osint-muted mb-0.5">{metric.label}</p>
              <p className="text-lg font-bold text-osint-text">{metric.value}</p>
              {metric.change !== undefined && metric.change !== null && (
                <p className={`text-xs flex items-center justify-center gap-0.5 ${
                  Number(metric.change) > 0 ? 'text-severity-low' : Number(metric.change) < 0 ? 'text-severity-critical' : 'text-osint-muted'
                }`}>
                  {Number(metric.change) > 0 ? '+' : ''}{metric.change}{metric.suffix || ''}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Top Entities */}
        <div className="mb-4">
          <p className="text-xs text-osint-muted mb-2">Top Centrality Entities</p>
          <div className="space-y-2">
            {currentSnapshot.top_entities.map((entity, idx) => (
              <div key={entity.id} className="flex items-center justify-between p-2 rounded-lg bg-osint-bg border border-osint-border">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary-600/20 text-primary-400 text-xs flex items-center justify-center font-medium">
                    {idx + 1}
                  </span>
                  <span className="text-sm text-osint-text">{entity.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-osint-text">{entity.centrality.toFixed(2)}</span>
                  {entity.change !== 0 && (
                    <span className={`text-xs flex items-center gap-0.5 ${
                      entity.change > 0 ? 'text-severity-low' : 'text-severity-critical'
                    }`}>
                      {entity.change > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {Math.abs(entity.change).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Significant Changes */}
        {showChanges && currentSnapshot.significant_changes.length > 0 && (
          <div>
            <p className="text-xs text-osint-muted mb-2">Significant Changes</p>
            <div className="space-y-2">
              {currentSnapshot.significant_changes.map((change, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-lg bg-osint-bg border border-osint-border"
                >
                  {getChangeTypeIcon(change.type)}
                  <div className="flex-1">
                    <p className="text-xs text-osint-text">{change.description}</p>
                    <span className={`text-[10px] ${getSignificanceColor(change.significance)}`}>
                      {change.significance.toUpperCase()} SIGNIFICANCE
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showChanges && currentSnapshot.significant_changes.length === 0 && (
          <div className="text-center py-4 text-xs text-osint-muted">
            No significant changes detected in this period
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between text-xs text-osint-muted">
          <span>Analysis Window: {snapshots.length} periods</span>
          <span>Network Analyzer v2</span>
        </div>
      </div>
    </div>
  )
}
