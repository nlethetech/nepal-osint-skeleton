import { useEffect, useState } from 'react'
import { ExternalLink, ShieldCheck, AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { Modal } from '../common/Modal'
import { getPublicEvent, type PublicEventDetail } from '../../api/publicEvents'

interface PublicEventModalProps {
  isOpen: boolean
  onClose: () => void
  clusterId: string | null
}

function badgeForPeerState(peerState: string) {
  switch (peerState) {
    case 'reviewed':
      return { label: 'Peer reviewed', className: 'bg-green-500/15 text-green-300 border border-green-500/30' }
    case 'contested':
      return { label: 'Contested', className: 'bg-red-500/15 text-red-300 border border-red-500/30' }
    case 'corrected':
      return { label: 'Corrected', className: 'bg-purple-500/15 text-purple-300 border border-purple-500/30' }
    default:
      return { label: 'Unreviewed', className: 'bg-gray-500/15 text-gray-300 border border-gray-500/30' }
  }
}

export function PublicEventModal({ isOpen, onClose, clusterId }: PublicEventModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState<PublicEventDetail | null>(null)

  const load = async () => {
    if (!clusterId) return
    setLoading(true)
    setError(null)
    try {
      const data = await getPublicEvent(clusterId)
      setEvent(data)
    } catch (e: any) {
      setError(e?.message || 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen) {
      setEvent(null)
      setError(null)
      return
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clusterId])

  const peerBadge = badgeForPeerState(event?.peer_review?.peer_state || 'unreviewed')
  const isOfficial = event?.peer_review?.official_confirmation === true
  const isUnconfirmed = event?.peer_review?.official_confirmation === false

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Published Report"
      size="xl"
      footer={
        <div className="flex items-center justify-between">
          <div className="text-xs text-osint-muted">
            {event?.publication?.version !== undefined && (
              <span className="font-mono">v{event.publication.version}</span>
            )}
            {event?.publication?.created_at && (
              <span className="ml-2">
                Updated {new Date(event.publication.created_at).toLocaleString()}
              </span>
            )}
          </div>
          <button
            onClick={() => load()}
            className="btn btn-secondary btn-sm flex items-center gap-2"
            disabled={loading || !clusterId}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      }
    >
      {loading && (
        <div className="flex items-center justify-center py-10 text-osint-muted">
          Loading…
        </div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <span className="text-sm font-medium">{error}</span>
          </div>
        </div>
      )}

      {!loading && !error && event && (
        <div className="space-y-6">
          {/* Header */}
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-osint-text leading-tight">
              {event.headline}
            </h3>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded ${peerBadge.className}`}>
                <ShieldCheck size={12} className="inline mr-1" />
                {peerBadge.label}
              </span>

              {isOfficial && (
                <span className="px-2 py-1 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  Officially confirmed
                </span>
              )}
              {isUnconfirmed && (
                <span className="px-2 py-1 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                  <Info size={12} className="inline mr-1" />
                  Not officially confirmed
                </span>
              )}

              {event.category && (
                <span className="px-2 py-1 rounded bg-osint-surface border border-osint-border/50 text-osint-muted">
                  {event.category}
                </span>
              )}
              {event.severity && (
                <span className="px-2 py-1 rounded bg-osint-surface border border-osint-border/50 text-osint-muted">
                  {event.severity}
                </span>
              )}

              {typeof event.peer_review?.citations_count === 'number' && (
                <span className="px-2 py-1 rounded bg-osint-surface border border-osint-border/50 text-osint-muted font-mono">
                  {event.peer_review.citations_count} cites
                </span>
              )}
            </div>
          </div>

          {/* Customer brief */}
          <div className="bg-osint-surface/50 rounded-lg p-4 border border-osint-border/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={16} className="text-green-400" />
              <span className="text-sm font-medium text-osint-text">Summary</span>
            </div>
            <p className="text-osint-text-secondary leading-relaxed whitespace-pre-wrap">
              {event.publication.customer_brief || 'No summary provided.'}
            </p>
            {event.publication.change_note && (
              <div className="mt-3 pt-3 border-t border-osint-border/40 text-xs text-osint-muted">
                <span className="font-semibold">Update note:</span> {event.publication.change_note}
              </div>
            )}
          </div>

          {/* Citations */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-osint-text">Sources</h4>
              {event.publication.citations && (
                <span className="text-xs text-osint-muted">
                  {event.publication.citations.length} linked
                </span>
              )}
            </div>

            {!event.publication.citations || event.publication.citations.length === 0 ? (
              <div className="p-4 rounded-lg border border-osint-border/50 bg-osint-surface/30 text-osint-muted text-sm">
                No citations available for this report.
              </div>
            ) : (
              <div className="space-y-2">
                {event.publication.citations.map((c, idx) => (
                  <a
                    key={`${c.url}-${idx}`}
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block p-3 rounded-lg border border-osint-border/50 bg-osint-surface/30 hover:bg-osint-surface/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-osint-text line-clamp-2">
                          {c.title || c.url}
                        </p>
                        <div className="mt-1 text-xs text-osint-muted flex flex-wrap gap-2">
                          {c.source_name && <span>{c.source_name}</span>}
                          {c.source_id && <span className="font-mono">{c.source_id}</span>}
                          {c.admiralty_code && (
                            <span className="font-mono px-1.5 py-0.5 bg-osint-bg/40 border border-osint-border/50 rounded">
                              {c.admiralty_code}
                            </span>
                          )}
                          {c.source_type && (
                            <span className="px-1.5 py-0.5 bg-osint-bg/40 border border-osint-border/50 rounded">
                              {c.source_type}
                            </span>
                          )}
                        </div>
                      </div>
                      <ExternalLink size={14} className="text-osint-muted flex-shrink-0" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

