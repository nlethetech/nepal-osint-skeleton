import { useEffect, useMemo, useState } from 'react'
import { Spinner, Intent, Tag } from '@blueprintjs/core'
import { getUnifiedNodeProfile, type NodeProfileResponse } from '../../api/unifiedGraph'

interface UnifiedNodeProfilePanelProps {
  nodeId: string
  className?: string
}

export function UnifiedNodeProfilePanel({ nodeId, className = '' }: UnifiedNodeProfilePanelProps) {
  const [profile, setProfile] = useState<NodeProfileResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getUnifiedNodeProfile(nodeId).then((r) => r.data)
        if (!cancelled) setProfile(data)
      } catch (e) {
        if (!cancelled) {
          setProfile(null)
          setError(e instanceof Error ? e.message : 'Failed to load profile')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [nodeId])

  const summaryRows = useMemo(() => {
    if (!profile) return []
    return Object.entries(profile.summary)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .slice(0, 10)
  }, [profile])

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <Spinner size={24} intent={Intent.PRIMARY} />
      </div>
    )
  }

  if (!profile || error) {
    return (
      <div className={`h-full flex items-center justify-center ${className}`}>
        <p className="text-xs text-bp-text-secondary">{error || 'Profile not found'}</p>
      </div>
    )
  }

  return (
    <div className={`h-full overflow-y-auto p-3 space-y-3 ${className}`}>
      <div className="rounded-lg border border-bp-border bg-bp-surface p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-bp-text">{profile.node.title}</h3>
            <p className="text-[11px] text-bp-text-secondary capitalize">
              {profile.profile_type.replace('_', ' ')} · {profile.node.node_type}
            </p>
          </div>
          <Tag minimal round intent={profile.quality.quality_score >= 0.8 ? Intent.SUCCESS : profile.quality.quality_score >= 0.5 ? Intent.WARNING : Intent.DANGER}>
            q {Math.round(profile.quality.quality_score * 100)}%
          </Tag>
        </div>
        {profile.node.description && (
          <p className="text-xs text-bp-text-secondary mt-2 leading-relaxed">
            {profile.node.description}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-bp-border bg-bp-surface p-3">
        <h4 className="text-[11px] uppercase tracking-wide text-bp-text-secondary mb-2">Summary</h4>
        {summaryRows.length === 0 ? (
          <p className="text-xs text-bp-text-secondary">No enriched summary fields yet.</p>
        ) : (
          <div className="space-y-1.5">
            {summaryRows.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 text-xs">
                <span className="text-bp-text-secondary min-w-[110px] capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="text-bp-text break-words">
                  {Array.isArray(value) ? value.join(', ') : String(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-bp-border bg-bp-surface p-3">
        <h4 className="text-[11px] uppercase tracking-wide text-bp-text-secondary mb-2">Quality</h4>
        <div className="text-xs text-bp-text-secondary space-y-1">
          <p>Provenance count: <span className="text-bp-text">{profile.quality.provenance_count}</span></p>
          <p>Last updated: <span className="text-bp-text">{profile.quality.last_updated || 'unknown'}</span></p>
          <p>Missing fields: <span className="text-bp-text">{profile.quality.missing_fields.join(', ') || 'none'}</span></p>
        </div>
      </div>

      <div className="rounded-lg border border-bp-border bg-bp-surface p-3">
        <h4 className="text-[11px] uppercase tracking-wide text-bp-text-secondary mb-2">
          Relationships ({profile.relationships.total})
        </h4>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(profile.relationships.by_predicate).slice(0, 8).map(([predicate, count]) => (
            <Tag key={predicate} minimal round className="text-[10px]">
              {predicate} {count}
            </Tag>
          ))}
        </div>
        <div className="space-y-1">
          {profile.relationships.top_neighbors.slice(0, 6).map((n) => (
            <div key={`${n.peer_id}-${n.predicate}`} className="text-xs text-bp-text-secondary truncate">
              {n.predicate} · <span className="text-bp-text">{n.peer_title || n.peer_id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
