/**
 * ConstituencyDetailPanel
 *
 * Slides up when a district is selected on the map.
 * Shows all constituencies within that district with candidates, photos, and vote data.
 */

import { useMemo, useState } from 'react'
import { X, MapPin, Users, Newspaper, History, Star } from 'lucide-react'
import { useElectionStore, type ConstituencyResult } from '../../stores/electionStore'
import { CandidateTable } from './CandidateTable'
import { ConstituencyNewsPanel } from './ConstituencyNewsPanel'
import { getPartyColor } from './partyColors'

type DetailTab = 'candidates' | 'intel' | 'history'

export function ConstituencyDetailPanel() {
  const { selectedConstituencyId, constituencyResults, selectConstituency } = useElectionStore()
  const [activeTab, setActiveTab] = useState<DetailTab>('candidates')

  // Get all constituencies matching the selected district
  const districtConstituencies = useMemo(() => {
    if (!selectedConstituencyId) return []

    const results: ConstituencyResult[] = []
    const selectedLower = selectedConstituencyId.toLowerCase()

    for (const [, result] of constituencyResults) {
      if (
        result.district.toLowerCase() === selectedLower ||
        result.constituency_id === selectedConstituencyId ||
        result.name_en.toLowerCase().includes(selectedLower)
      ) {
        results.push(result)
      }
    }

    return results.sort((a, b) => a.name_en.localeCompare(b.name_en))
  }, [selectedConstituencyId, constituencyResults])

  const districtName = selectedConstituencyId || ''
  const province = districtConstituencies[0]?.province || ''
  const totalDeclared = districtConstituencies.filter(c => c.status === 'declared').length
  const totalConstituencies = districtConstituencies.length

  return (
    <div className="h-full flex flex-col bg-osint-card border border-osint-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-osint-border bg-osint-surface/50 flex-shrink-0">
        {selectedConstituencyId ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <MapPin size={12} className="text-osint-primary flex-shrink-0" />
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-osint-text truncate">{districtName}</h3>
                <div className="flex items-center gap-1.5 text-[9px] text-osint-muted">
                  {province && <span>{province}</span>}
                  {totalConstituencies > 0 && (
                    <>
                      <span className="text-osint-border">|</span>
                      <span>{totalDeclared}/{totalConstituencies} declared</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => selectConstituency(null)}
              className="p-1 text-osint-muted hover:text-osint-text rounded hover:bg-osint-surface transition-colors flex-shrink-0"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <MapPin size={12} className="text-osint-muted" />
            <span className="text-xs text-osint-muted">Constituency Intel</span>
          </div>
        )}
      </div>

      {!selectedConstituencyId ? (
        /* Empty state - no district selected */
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-osint-surface/50 flex items-center justify-center mb-3">
            <MapPin size={18} className="text-osint-muted" />
          </div>
          <p className="text-xs text-osint-text-secondary mb-1">Select a district on the map</p>
          <p className="text-[10px] text-osint-muted leading-relaxed max-w-[200px]">
            Click any district to view constituencies, candidates, and intel feed
          </p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex border-b border-osint-border px-3 flex-shrink-0">
            {([
              { id: 'candidates' as DetailTab, label: 'Candidates', icon: Users },
              { id: 'intel' as DetailTab, label: 'Intel Feed', icon: Newspaper },
              { id: 'history' as DetailTab, label: 'History', icon: History },
            ]).map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1 px-2 py-1.5 text-[10px] border-b-2 transition-colors ${
                    isActive
                      ? 'border-osint-primary text-osint-text'
                      : 'border-transparent text-osint-muted hover:text-osint-text-secondary'
                  }`}
                >
                  <Icon size={10} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            {activeTab === 'candidates' && (
              districtConstituencies.length === 0 ? (
                <EmptyState districtName={districtName} />
              ) : (
                <div className="space-y-4">
                  {districtConstituencies.map(result => (
                    <ConstituencyCard key={result.constituency_id} result={result} />
                  ))}
                </div>
              )
            )}

            {activeTab === 'intel' && (
              districtConstituencies.length > 0 ? (
                <div className="space-y-3">
                  {districtConstituencies.map(result => (
                    <div key={result.constituency_id}>
                      <div className="text-[10px] text-osint-muted font-medium mb-1">{result.name_en}</div>
                      <ConstituencyNewsPanel
                        constituencyId={result.constituency_id}
                        constituencyName={result.name_en}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState districtName={districtName} />
              )
            )}

            {activeTab === 'history' && (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <History size={16} className="text-osint-muted mb-2" />
                <p className="text-xs text-osint-text-secondary">Historical data requires backend connection</p>
                <p className="text-[10px] text-osint-muted mt-1">
                  Connect the API to view constituency history across elections.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ConstituencyCard({ result }: { result: ConstituencyResult }) {
  const isWatched = useElectionStore(s => s.watchlist.some(w => w.constituency_id === result.constituency_id))
  const addToWatchlist = useElectionStore(s => s.addToWatchlist)
  const removeFromWatchlist = useElectionStore(s => s.removeFromWatchlist)

  return (
    <div className="bg-osint-surface/30 border border-osint-border/50 rounded-lg p-3">
      {/* Constituency header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-osint-text">{result.name_en}</span>
          {result.name_ne && (
            <span className="text-[10px] text-osint-muted">({result.name_ne})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (isWatched) {
                removeFromWatchlist(result.constituency_id)
                return
              }
              addToWatchlist({
                id: result.constituency_id,
                user_id: 'local',
                constituency_id: result.constituency_id,
                constituency_code: result.constituency_id,
                constituency_name: result.name_en,
                district: result.district,
                province: result.province,
                alert_level: 'medium',
                is_active: true,
              })
            }}
            className="p-1 rounded hover:bg-osint-surface/60 transition-colors"
            title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <Star
              size={12}
              className={isWatched ? 'text-yellow-400' : 'text-osint-muted'}
              fill={isWatched ? 'currentColor' : 'none'}
            />
          </button>
          {result.turnout_pct != null && (
            <span className="text-[10px] text-osint-muted">
              {result.turnout_pct.toFixed(1)}% turnout
            </span>
          )}
          <StatusBadge status={result.status} />
        </div>
      </div>

      {/* Winner info (if declared) */}
      {result.status === 'declared' && result.winner_party && (
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded bg-osint-surface/50">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: getPartyColor(result.winner_party) }}
          />
          <span className="text-xs text-osint-text font-medium">{result.winner_name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${getPartyColor(result.winner_party)}20`,
                  color: getPartyColor(result.winner_party),
                }}>
            {result.winner_party}
          </span>
          {result.winner_votes != null && (
            <span className="text-[10px] text-osint-muted ml-auto">
              {result.winner_votes.toLocaleString()} votes
            </span>
          )}
        </div>
      )}

      {/* Full candidate table with photos */}
      {result.candidates.length > 0 && (
        <CandidateTable candidates={result.candidates} />
      )}

      {/* Total votes footer */}
      {result.total_votes != null && result.total_votes > 0 && (
        <div className="mt-2 pt-2 border-t border-osint-border/30 flex items-center justify-between">
          <span className="text-[10px] text-osint-muted">Total votes cast</span>
          <span className="text-[10px] text-osint-text font-medium tabular-nums">
            {result.total_votes.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    declared: 'bg-green-500/10 text-green-400',
    counting: 'bg-yellow-500/10 text-yellow-400',
    pending: 'bg-gray-500/10 text-gray-400',
  }

  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${styles[status as keyof typeof styles] || styles.pending}`}>
      {status === 'counting' ? 'Counting...' : status === 'pending' ? 'Pending' : 'Declared'}
    </span>
  )
}

function EmptyState({ districtName }: { districtName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <MapPin size={20} className="text-osint-muted mb-2" />
      <p className="text-xs text-osint-text-secondary mb-1">No election data for {districtName}</p>
      <p className="text-[10px] text-osint-muted">
        Results will appear here once the Election Commission publishes data.
      </p>
    </div>
  )
}
