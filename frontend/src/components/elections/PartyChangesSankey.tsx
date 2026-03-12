/**
 * PartyChangesSankey - Party defection flow visualization
 *
 * Groups party changes by from→to flow pairs, showing candidate thumbnails,
 * elected badges, and vote counts. Sorted by total_votes (most impactful first).
 */

import { useMemo, useState } from 'react'
import { Award } from 'lucide-react'
import { useElectionStore, type PartyChange } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'

/** Optional proxy for external photo URLs */
function getProxyPhotoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.includes('election.gov.np')) {
    return `/api/v1/elections/image-proxy?url=${encodeURIComponent(url)}`
  }
  return url
}

interface FlowGroup {
  from_party: string
  to_party: string
  candidates: PartyChange[]
  total_votes: number
}

export function PartyChangesSankey() {
  const { partyChanges, electionYear } = useElectionStore()

  const flows = useMemo(() => {
    if (electionYear === 2074 || partyChanges.length === 0) return []

    // Group by from→to
    const groups = new Map<string, FlowGroup>()

    for (const change of partyChanges) {
      const key = `${change.from_party}→${change.to_party}`
      if (!groups.has(key)) {
        groups.set(key, {
          from_party: change.from_party,
          to_party: change.to_party,
          candidates: [],
          total_votes: 0,
        })
      }
      const g = groups.get(key)!
      g.candidates.push(change)
      g.total_votes += change.votes_2079
    }

    // Sort by total_votes descending
    return [...groups.values()].sort((a, b) => b.total_votes - a.total_votes)
  }, [partyChanges, electionYear])

  if (electionYear === 2074) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[10px] text-osint-muted">No previous election data for 2074 comparison</span>
      </div>
    )
  }

  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[10px] text-osint-muted">No party change data available</span>
      </div>
    )
  }

  return (
    <div className="space-y-2 overflow-y-auto max-h-full">
      <div className="text-[10px] text-osint-muted mb-1">
        {partyChanges.length} candidates switched parties
      </div>
      {flows.map(flow => (
        <FlowCard key={`${flow.from_party}→${flow.to_party}`} flow={flow} />
      ))}
    </div>
  )
}

function FlowCard({ flow }: { flow: FlowGroup }) {
  const maxShow = 5
  const visible = flow.candidates.slice(0, maxShow)
  const overflow = flow.candidates.length - maxShow

  return (
    <div className="bg-osint-surface/30 border border-osint-border/50 rounded-lg p-2">
      {/* Flow header: from → to */}
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: `${getPartyColor(flow.from_party)}20`,
            color: getPartyColor(flow.from_party),
          }}
        >
          {flow.from_party}
        </span>
        <svg width="20" height="10" viewBox="0 0 20 10" className="flex-shrink-0">
          <path d="M0 5 L15 5 M12 2 L15 5 L12 8" stroke="#9898a0" strokeWidth="1.5" fill="none" />
        </svg>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={{
            backgroundColor: `${getPartyColor(flow.to_party)}20`,
            color: getPartyColor(flow.to_party),
          }}
        >
          {flow.to_party}
        </span>
        <span className="text-[9px] text-osint-muted ml-auto">
          {flow.candidates.length} candidates
        </span>
      </div>

      {/* Candidate thumbnails */}
      <div className="flex flex-wrap gap-1.5">
        {visible.map(c => (
          <div key={c.candidate_id} className="flex items-center gap-1 bg-osint-bg/50 rounded px-1.5 py-0.5">
            {c.photo_url ? (
              <CandidateThumb url={c.photo_url} name={c.name} />
            ) : (
              <div className="w-4 h-4 rounded-full bg-osint-surface" />
            )}
            <span className="text-[9px] text-osint-text-secondary truncate max-w-[80px]">{c.name}</span>
            {c.was_elected_2079 && <Award size={8} className="text-green-400 flex-shrink-0" />}
            <span className="text-[8px] text-osint-muted tabular-nums">
              {(c.votes_2079 / 1000).toFixed(0)}k
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <span className="text-[9px] text-osint-muted self-center">+{overflow} more</span>
        )}
      </div>
    </div>
  )
}

function CandidateThumb({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const [source, setSource] = useState<'direct' | 'proxy'>(() => (
    url?.includes('election.gov.np') ? 'proxy' : 'direct'
  ))

  const src = source === 'proxy' ? getProxyPhotoUrl(url) : url

  if (!src || failed) {
    return <div className="w-4 h-4 rounded-full bg-osint-surface" />
  }

  return (
    <img
      src={src}
      alt={name}
      className="w-4 h-4 rounded-full object-cover bg-osint-surface"
      referrerPolicy="no-referrer"
      onError={() => {
        if (source === 'proxy') {
          setSource('direct')
          return
        }
        setFailed(true)
      }}
      loading="lazy"
    />
  )
}
