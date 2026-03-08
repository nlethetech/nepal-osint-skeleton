import { useState } from 'react'
import { Award, User, FileEdit } from 'lucide-react'
import { useElectionStore, type CandidateResult } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'
import { usePermissions } from '../../hooks/usePermissions'
import { CorrectionSubmitModal } from '../dev/CorrectionSubmitModal'

/** Optional proxy for external photo URLs */
function getProxyPhotoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  // Only proxy external election.gov.np URLs
  if (url.includes('election.gov.np')) {
    return `/api/v1/elections/image-proxy?url=${encodeURIComponent(url)}`
  }
  return url
}

interface CandidateTableProps {
  candidates: CandidateResult[]
  maxVisible?: number
}

export function CandidateTable({ candidates, maxVisible = 5 }: CandidateTableProps) {
  const [showAll, setShowAll] = useState(false)
  const [correctionTarget, setCorrectionTarget] = useState<CandidateResult | null>(null)
  const selectCandidate = useElectionStore(s => s.selectCandidate)
  const { canProvideFeedback } = usePermissions()

  if (candidates.length === 0) {
    return <p className="text-xs text-osint-muted py-2">No candidate data available.</p>
  }

  const sorted = [...candidates].sort((a, b) => b.votes - a.votes)
  const visible = showAll ? sorted : sorted.slice(0, maxVisible)
  const hasMore = sorted.length > maxVisible

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-osint-border text-left text-[10px] text-osint-muted uppercase tracking-wider">
            <th className="pb-1.5 pr-2 w-5">#</th>
            <th className="pb-1.5 pr-2">Candidate</th>
            <th className="pb-1.5 pr-2">Party</th>
            <th className="pb-1.5 pr-2 text-right">Votes</th>
            <th className="pb-1.5 pr-2 text-right">%</th>
            <th className="pb-1.5 w-5"></th>
            {canProvideFeedback && <th className="pb-1.5 w-5"></th>}
          </tr>
        </thead>
        <tbody>
          {visible.map((c, i) => (
            <tr key={c.id} className={`border-b border-osint-border/30 ${c.is_winner ? 'bg-green-500/5' : ''}`}>
              <td className="py-1.5 pr-2 text-osint-muted tabular-nums">{i + 1}</td>
              <td className="py-1.5 pr-2">
                <div className="flex items-center gap-1.5">
                  <CandidatePhoto url={c.photo_url} name={c.name_en_roman || c.name_en} />
                  <div className="min-w-0">
                    <div
                      className="text-osint-text truncate max-w-[160px] cursor-pointer hover:text-osint-primary transition-colors"
                      onClick={() => selectCandidate(c.id)}
                      title={c.name_ne}
                    >
                      {c.name_en_roman || c.name_en}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-1.5 pr-2">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getPartyColor(c.party) }} />
                  <span className="text-osint-text-secondary truncate max-w-[100px]">{c.party}</span>
                </div>
              </td>
              <td className="py-1.5 pr-2 text-right text-osint-text tabular-nums whitespace-nowrap">
                {c.votes.toLocaleString()}
              </td>
              <td className="py-1.5 pr-2 text-right text-osint-muted tabular-nums whitespace-nowrap">
                {c.vote_pct.toFixed(1)}%
              </td>
              <td className="py-1.5">
                {c.is_winner && <Award size={12} className="text-green-400" />}
              </td>
              {canProvideFeedback && (
                <td className="py-1.5">
                  <button
                    onClick={() => setCorrectionTarget(c)}
                    className="p-0.5 rounded hover:bg-osint-surface transition-colors"
                    title="Suggest Correction"
                  >
                    <FileEdit size={11} className="text-osint-muted hover:text-osint-primary" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-1.5 text-[10px] text-osint-primary hover:text-osint-primary/80 transition-colors"
        >
          Show all {sorted.length} candidates
        </button>
      )}
      {showAll && hasMore && (
        <button
          onClick={() => setShowAll(false)}
          className="mt-1.5 text-[10px] text-osint-muted hover:text-osint-text transition-colors"
        >
          Show less
        </button>
      )}

      {/* Correction Submit Modal */}
      {correctionTarget && (
        <CorrectionSubmitModal
          candidate={{
            external_id: correctionTarget.id,
            name_en: correctionTarget.name_en_roman || correctionTarget.name_en,
            name_ne: correctionTarget.name_ne,
            name_en_roman: correctionTarget.name_en_roman,
            biography: correctionTarget.biography,
            biography_source: correctionTarget.biography_source,
            education: correctionTarget.education,
            age: correctionTarget.age,
            gender: correctionTarget.gender,
            aliases: correctionTarget.aliases,
            previous_positions: correctionTarget.previous_positions as any[],
          }}
          onClose={() => setCorrectionTarget(null)}
        />
      )}
    </div>
  )
}

function CandidatePhoto({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const [source, setSource] = useState<'direct' | 'proxy'>(() => (
    url?.includes('election.gov.np') ? 'proxy' : 'direct'
  ))

  const src = source === 'proxy' ? getProxyPhotoUrl(url) : url

  if (!src || failed) {
    return (
      <div className="w-6 h-6 rounded-full bg-osint-surface flex items-center justify-center flex-shrink-0">
        <User size={12} className="text-osint-muted" />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      className="w-6 h-6 rounded-full object-cover flex-shrink-0 bg-osint-surface"
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
