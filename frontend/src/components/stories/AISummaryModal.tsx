import { useState, useEffect } from 'react'
import { Modal } from '../common/Modal'
import { getStorySummary, getClusterSummary, StorySummaryResponse, ClusterSummaryResponse } from '../../api/analytics'
import {
  Sparkles,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Users,
  Newspaper,
  ExternalLink,
  Zap,
  Shield,
  TrendingUp,
  Building,
  Cloud
} from 'lucide-react'

interface AISummaryModalProps {
  isOpen: boolean
  onClose: () => void
  storyId?: string | null
  clusterId?: string | null
  title?: string
  url?: string
}

type SummaryData = StorySummaryResponse | ClusterSummaryResponse | null

const severityConfig: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  critical: {
    color: 'text-red-400',
    bg: 'bg-red-500/20 border-red-500/30',
    icon: <AlertTriangle size={16} />
  },
  high: {
    color: 'text-orange-400',
    bg: 'bg-orange-500/20 border-orange-500/30',
    icon: <AlertTriangle size={16} />
  },
  medium: {
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20 border-yellow-500/30',
    icon: <Shield size={16} />
  },
  low: {
    color: 'text-green-400',
    bg: 'bg-green-500/20 border-green-500/30',
    icon: <CheckCircle size={16} />
  },
}

const categoryConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  political: { color: 'text-purple-400', icon: <Building size={14} /> },
  economic: { color: 'text-emerald-400', icon: <TrendingUp size={14} /> },
  security: { color: 'text-red-400', icon: <Shield size={14} /> },
  disaster: { color: 'text-orange-400', icon: <Cloud size={14} /> },
  social: { color: 'text-blue-400', icon: <Users size={14} /> },
  mixed: { color: 'text-gray-400', icon: <Newspaper size={14} /> },
}

export function AISummaryModal({
  isOpen,
  onClose,
  storyId,
  clusterId,
  title,
  url
}: AISummaryModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SummaryData>(null)

  const isCluster = !!clusterId

  useEffect(() => {
    if (!isOpen) {
      setSummary(null)
      setError(null)
      return
    }

    const fetchSummary = async () => {
      setLoading(true)
      setError(null)

      try {
        if (clusterId) {
          const data = await getClusterSummary(clusterId)
          setSummary(data)
        } else if (storyId) {
          const data = await getStorySummary(storyId)
          setSummary(data)
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate summary'
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    }

    fetchSummary()
  }, [isOpen, storyId, clusterId])

  const severity = summary?.severity || 'medium'
  const category = summary?.category || 'unknown'
  const sevConfig = severityConfig[severity] || severityConfig.medium
  const catConfig = categoryConfig[category] || categoryConfig.mixed

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCluster ? "Cluster Intelligence Summary" : "Story Intelligence Summary"}
      size="lg"
      footer={
        url ? (
          <div className="flex justify-between items-center">
            <div className="text-xs text-osint-muted flex items-center gap-1">
              <Sparkles size={12} className="text-blue-400" />
              Powered by Claude AI
              {summary?.cached && (
                <span className="ml-2 text-green-400">(Cached)</span>
              )}
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm flex items-center gap-2"
            >
              <ExternalLink size={14} />
              Read Full Article
            </a>
          </div>
        ) : (
          <div className="text-xs text-osint-muted flex items-center gap-1">
            <Sparkles size={12} className="text-blue-400" />
            Powered by Claude AI
            {summary?.cached && (
              <span className="ml-2 text-green-400">(Cached)</span>
            )}
          </div>
        )
      }
    >
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="relative">
            <div className="w-12 h-12 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            <Sparkles className="absolute inset-0 m-auto text-blue-400" size={20} />
          </div>
          <p className="text-osint-muted text-sm">Generating AI summary...</p>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
            <XCircle className="text-red-400" size={24} />
          </div>
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => {
              setError(null)
              setLoading(true)
              // Re-trigger fetch
              if (clusterId) {
                getClusterSummary(clusterId).then(setSummary).catch(e => setError(e.message)).finally(() => setLoading(false))
              } else if (storyId) {
                getStorySummary(storyId).then(setSummary).catch(e => setError(e.message)).finally(() => setLoading(false))
              }
            }}
            className="btn btn-secondary btn-sm"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && summary && (
        <div className="space-y-6">
          {/* Header with severity and category badges */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-xl font-semibold text-osint-text leading-tight">
                {summary.headline || title}
              </h3>
              {title && summary.headline && summary.headline !== title && (
                <p className="text-sm text-osint-muted mt-1">
                  Original: {title}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {/* Severity Badge */}
              <div className={`px-3 py-1.5 rounded-lg border ${sevConfig.bg} flex items-center gap-2`}>
                <span className={sevConfig.color}>{sevConfig.icon}</span>
                <span className={`text-sm font-medium capitalize ${sevConfig.color}`}>
                  {severity}
                </span>
              </div>
              {/* Category Badge */}
              <div className="px-3 py-1 rounded-md bg-osint-surface border border-osint-border flex items-center gap-2">
                <span className={catConfig.color}>{catConfig.icon}</span>
                <span className={`text-xs font-medium capitalize ${catConfig.color}`}>
                  {category}
                </span>
              </div>
            </div>
          </div>

          {/* Main Summary */}
          <div className="bg-osint-surface/50 rounded-lg p-4 border border-osint-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={16} className="text-blue-400" />
              <span className="text-sm font-medium text-osint-text">Intelligence Summary</span>
            </div>
            <p className="text-osint-text-secondary leading-relaxed">
              {summary.summary}
            </p>
          </div>

          {/* Key Entities */}
          {summary.key_entities && summary.key_entities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-purple-400" />
                <span className="text-sm font-medium text-osint-text">Key Entities</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {summary.key_entities.map((entity, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 text-sm bg-purple-500/10 text-purple-300 rounded-full border border-purple-500/20"
                  >
                    {entity}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Cluster-specific info */}
          {isCluster && 'sources' in summary && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-osint-surface/30 rounded-lg p-3 border border-osint-border/30">
                <div className="flex items-center gap-2 mb-2">
                  <Newspaper size={14} className="text-blue-400" />
                  <span className="text-xs text-osint-muted">Stories</span>
                </div>
                <p className="text-2xl font-bold text-osint-text">
                  {(summary as ClusterSummaryResponse).story_count}
                </p>
              </div>
              <div className="bg-osint-surface/30 rounded-lg p-3 border border-osint-border/30">
                <div className="flex items-center gap-2 mb-2">
                  <Users size={14} className="text-green-400" />
                  <span className="text-xs text-osint-muted">Sources</span>
                </div>
                <p className="text-2xl font-bold text-osint-text">
                  {(summary as ClusterSummaryResponse).source_count}
                </p>
              </div>
            </div>
          )}

          {/* Sources list for clusters */}
          {isCluster && 'sources' in summary && summary.sources.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Newspaper size={16} className="text-green-400" />
                <span className="text-sm font-medium text-osint-text">Sources</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(summary as ClusterSummaryResponse).sources.map((source, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 text-sm bg-green-500/10 text-green-300 rounded-full border border-green-500/20"
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Confidence indicator */}
          <div className="flex items-center justify-between text-sm pt-4 border-t border-osint-border/30">
            <div className="flex items-center gap-2">
              <span className="text-osint-muted">Confidence:</span>
              <div className="w-24 h-2 bg-osint-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${(summary.confidence || 0) * 100}%` }}
                />
              </div>
              <span className="text-osint-text font-medium">
                {Math.round((summary.confidence || 0) * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              {summary.verified ? (
                <span className="flex items-center gap-1 text-green-400">
                  <CheckCircle size={14} />
                  Verified
                </span>
              ) : (
                <span className="flex items-center gap-1 text-yellow-400">
                  <AlertTriangle size={14} />
                  Unverified
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
