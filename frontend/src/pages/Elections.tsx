import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Star, Users, Building2, MapPin, Newspaper,
  Plus, Minus, ExternalLink, ChevronDown, Download,
} from 'lucide-react'
import {
  fetchCandidates,
  fetchParties,
  fetchConstituencies,
  fetchWatchlist,
  fetchWatchlistAlerts,
  fetchElectionSummary,
  fetchEntityMentions,
  addToWatchlist,
  removeFromWatchlist,
  type Candidate,
  type Party,
  type Constituency,
  type WatchlistItem,
  type ElectionAlert,
  type ElectionSummary,
  type Mention,
} from '../api/elections'

type TabId = 'watchlist' | 'candidates' | 'parties' | 'constituencies' | 'mentions'

export default function Elections() {
  const [activeTab, setActiveTab] = useState<TabId>('candidates')
  const [summary, setSummary] = useState<ElectionSummary | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetchElectionSummary().then(setSummary).catch(() => {})
  }, [])

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'watchlist', label: 'Watchlist', icon: Star },
    { id: 'candidates', label: 'Candidates', icon: Users },
    { id: 'parties', label: 'Parties', icon: Building2 },
    { id: 'constituencies', label: 'Constituencies', icon: MapPin },
    { id: 'mentions', label: 'Mentions', icon: Newspaper },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-osint-text">Election Watchlist</h1>
          {summary && (
            <p className="text-xs text-osint-muted mt-0.5">
              {summary.total_candidates} candidates tracked
              {summary.last_scrape_at && ` · Last updated ${new Date(summary.last_scrape_at).toLocaleDateString()}`}
            </p>
          )}
        </div>
        <a
          href="/api/v1/elections/candidates/export?format=csv"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-osint-border text-osint-text-secondary hover:text-osint-text hover:bg-osint-surface"
        >
          <Download size={12} />
          Export CSV
        </a>
      </div>

      {/* Summary Stats */}
      {summary && summary.total_candidates > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-osint-card border border-osint-border rounded p-3">
            <div className="text-xl font-semibold text-osint-text">{summary.total_candidates}</div>
            <div className="text-xs text-osint-muted">Total Candidates</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded p-3">
            <div className="text-xl font-semibold text-osint-text">{summary.by_party.length}</div>
            <div className="text-xs text-osint-muted">Parties</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded p-3">
            <div className="text-xl font-semibold text-osint-text">{summary.by_province.length}</div>
            <div className="text-xs text-osint-muted">Provinces</div>
          </div>
          <div className="bg-osint-card border border-osint-border rounded p-3">
            <div className="text-xl font-semibold text-osint-text">
              {summary.by_gender.find(g => g.gender === 'Female')?.share_pct ?? 0}%
            </div>
            <div className="text-xs text-osint-muted">Women Candidates</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-osint-border">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-osint-primary text-osint-text'
                  : 'border-transparent text-osint-text-secondary hover:text-osint-text'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'watchlist' && <WatchlistTab />}
        {activeTab === 'candidates' && <CandidatesTab navigate={navigate} />}
        {activeTab === 'parties' && <PartiesTab />}
        {activeTab === 'constituencies' && <ConstituenciesTab />}
        {activeTab === 'mentions' && <MentionsTab />}
      </div>
    </div>
  )
}

// =============================================================================
// WATCHLIST TAB
// =============================================================================

function WatchlistTab() {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [alerts, setAlerts] = useState<ElectionAlert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchWatchlist().then(r => setItems(r.watchlist)),
      fetchWatchlistAlerts().then(r => setAlerts(r.alerts)),
    ]).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState />

  return (
    <div className="space-y-4">
      {/* Watched Entities */}
      <div>
        <h3 className="text-sm font-medium text-osint-text mb-2">Watched Entities ({items.length})</h3>
        {items.length === 0 ? (
          <p className="text-xs text-osint-muted">No entities in watchlist. Add candidates, parties, or constituencies from other tabs.</p>
        ) : (
          <div className="space-y-1">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between bg-osint-card border border-osint-border rounded px-3 py-2">
                <div>
                  <span className="text-sm text-osint-text">{item.entity_name}</span>
                  {item.entity_name_ne && (
                    <span className="text-xs text-osint-muted ml-2">{item.entity_name_ne}</span>
                  )}
                  <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${
                    item.item_type === 'candidate' ? 'bg-blue-500/10 text-blue-400' :
                    item.item_type === 'party' ? 'bg-purple-500/10 text-purple-400' :
                    'bg-green-500/10 text-green-400'
                  }`}>
                    {item.item_type}
                  </span>
                </div>
                <button
                  onClick={() => {
                    removeFromWatchlist(item.entity_id).then(() => {
                      setItems(prev => prev.filter(i => i.id !== item.id))
                    })
                  }}
                  className="p-1 text-osint-muted hover:text-red-400"
                  title="Remove from watchlist"
                >
                  <Minus size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alerts Stream */}
      <div>
        <h3 className="text-sm font-medium text-osint-text mb-2">Recent Alerts ({alerts.length})</h3>
        {alerts.length === 0 ? (
          <p className="text-xs text-osint-muted">No alerts yet. Alerts appear when watched entities are mentioned in news.</p>
        ) : (
          <div className="space-y-1">
            {alerts.slice(0, 20).map(alert => (
              <div key={alert.id} className="bg-osint-card border border-osint-border rounded px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    alert.severity === 'high' ? 'bg-red-400' :
                    alert.severity === 'med' ? 'bg-yellow-400' : 'bg-blue-400'
                  }`} />
                  <span className="text-sm text-osint-text">{alert.title}</span>
                </div>
                {alert.metadata?.excerpt && (
                  <p className="text-xs text-osint-muted mt-1 ml-3.5 line-clamp-2">
                    {alert.metadata.excerpt}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1 ml-3.5">
                  {alert.created_at && (
                    <span className="text-[10px] text-osint-muted">
                      {new Date(alert.created_at).toLocaleString()}
                    </span>
                  )}
                  {alert.metadata?.url && (
                    <a href={alert.metadata.url} target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-osint-primary hover:underline flex items-center gap-0.5">
                      View story <ExternalLink size={9} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// CANDIDATES TAB
// =============================================================================

function CandidatesTab({ navigate }: { navigate: (path: string) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchCandidates({ search: search || undefined, election_year: 2082, limit, offset })
      setCandidates(result.candidates)
    } catch {
      setCandidates([])
    }
    setLoading(false)
  }, [search, offset])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-2.5 text-osint-muted" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0) }}
          placeholder="Search candidates (English or नेपाली)..."
          className="w-full pl-8 pr-3 py-2 text-sm bg-osint-card border border-osint-border rounded text-osint-text placeholder:text-osint-muted focus:outline-none focus:border-osint-primary"
        />
      </div>

      {loading ? <LoadingState /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-osint-border text-left text-xs text-osint-muted">
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Party</th>
                  <th className="pb-2 pr-3">Constituency</th>
                  <th className="pb-2 pr-3">Result</th>
                  <th className="pb-2 pr-3">2079 History</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={`${c.id}-${c.election_year}`} className="border-b border-osint-border/50 hover:bg-osint-surface/30">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {c.photo_url && (
                          <img src={c.photo_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                        )}
                        <div>
                          <div className="text-osint-text">{c.name_en}</div>
                          {c.name_ne && <div className="text-[10px] text-osint-muted">{c.name_ne}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-osint-text-secondary">{c.party_name || 'Independent'}</td>
                    <td className="py-2 pr-3 text-osint-text-secondary">{c.constituency_name}</td>
                    <td className="py-2 pr-3">
                      {c.is_winner ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">Won</span>
                      ) : c.votes_received ? (
                        <span className="text-xs text-osint-muted">{c.vote_percentage?.toFixed(1)}%</span>
                      ) : (
                        <span className="text-[10px] text-osint-muted">Pending</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {c.previous_run ? (
                        <div className="flex flex-col gap-0.5">
                          {c.previous_run.is_winner ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 w-fit">Won 2079</span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 w-fit">Lost 2079</span>
                          )}
                          {c.previous_run.party_changed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 w-fit">
                              ex-{c.previous_run.party_name}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-osint-muted/50">New</span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => addToWatchlist(c.id, 'candidate')}
                          className="p-1 text-osint-muted hover:text-yellow-400"
                          title="Add to watchlist"
                        >
                          <Plus size={12} />
                        </button>
                        <button
                          onClick={() => navigate(`/graph?entity=${c.id}`)}
                          className="p-1 text-osint-muted hover:text-osint-primary"
                          title="Open in Graph"
                        >
                          <ExternalLink size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-2 justify-center">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-2 py-1 text-xs rounded border border-osint-border text-osint-text-secondary disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-xs text-osint-muted">
              Showing {offset + 1} - {offset + candidates.length}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={candidates.length < limit}
              className="px-2 py-1 text-xs rounded border border-osint-border text-osint-text-secondary disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// =============================================================================
// PARTIES TAB
// =============================================================================

function PartiesTab() {
  const [parties, setParties] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchParties().then(r => setParties(r.parties)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState />

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {parties.map(party => (
        <div key={party.id} className="bg-osint-card border border-osint-border rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-medium text-osint-text">{party.name_en}</div>
              {party.name_ne && <div className="text-[10px] text-osint-muted">{party.name_ne}</div>}
            </div>
            <button
              onClick={() => addToWatchlist(party.id, 'party')}
              className="p-1 text-osint-muted hover:text-yellow-400"
              title="Watch party"
            >
              <Star size={12} />
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-osint-text-secondary">
            <span>{party.candidate_count} candidates</span>
            <span>{party.winner_count} winners</span>
            {party.candidate_count > 0 && (
              <span className="text-green-400">
                {((party.winner_count / party.candidate_count) * 100).toFixed(0)}% win rate
              </span>
            )}
          </div>
        </div>
      ))}
      {parties.length === 0 && (
        <p className="text-xs text-osint-muted col-span-full">No party data available yet.</p>
      )}
    </div>
  )
}

// =============================================================================
// CONSTITUENCIES TAB
// =============================================================================

function ConstituenciesTab() {
  const [constituencies, setConstituencies] = useState<Constituency[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConstituencies().then(r => setConstituencies(r.constituencies)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState />

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-osint-border text-left text-xs text-osint-muted">
            <th className="pb-2 pr-3">Constituency</th>
            <th className="pb-2 pr-3">District</th>
            <th className="pb-2 pr-3">Province</th>
            <th className="pb-2 pr-3">Candidates</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {constituencies.map(c => (
            <tr key={c.id} className="border-b border-osint-border/50 hover:bg-osint-surface/30">
              <td className="py-2 pr-3">
                <div className="text-osint-text">{c.name_en}</div>
                {c.name_ne && <div className="text-[10px] text-osint-muted">{c.name_ne}</div>}
              </td>
              <td className="py-2 pr-3 text-osint-text-secondary">{c.district}</td>
              <td className="py-2 pr-3 text-osint-text-secondary">{c.province}</td>
              <td className="py-2 pr-3 text-osint-muted">{c.candidate_count}</td>
              <td className="py-2">
                <button
                  onClick={() => addToWatchlist(c.id, 'constituency')}
                  className="p-1 text-osint-muted hover:text-yellow-400"
                  title="Watch constituency"
                >
                  <Plus size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {constituencies.length === 0 && (
        <p className="text-xs text-osint-muted mt-4">No constituency data available yet.</p>
      )}
    </div>
  )
}

// =============================================================================
// MENTIONS TAB
// =============================================================================

function MentionsTab() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null)
  const [mentions, setMentions] = useState<Mention[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchWatchlist().then(r => {
      setWatchlist(r.watchlist)
      if (r.watchlist.length > 0) {
        setSelectedEntity(r.watchlist[0].entity_id)
      }
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selectedEntity) {
      fetchEntityMentions(selectedEntity, { limit: 30 })
        .then(r => setMentions(r.mentions))
        .catch(() => setMentions([]))
    }
  }, [selectedEntity])

  if (loading) return <LoadingState />

  return (
    <div className="space-y-3">
      {/* Entity selector */}
      {watchlist.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-osint-muted">Entity:</span>
          <select
            value={selectedEntity || ''}
            onChange={e => setSelectedEntity(e.target.value)}
            className="text-sm bg-osint-card border border-osint-border rounded px-2 py-1 text-osint-text"
          >
            {watchlist.map(item => (
              <option key={item.entity_id} value={item.entity_id}>
                {item.entity_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mentions list */}
      {mentions.length === 0 ? (
        <p className="text-xs text-osint-muted">
          {watchlist.length === 0
            ? 'Add entities to your watchlist to see their mentions.'
            : 'No mentions found for the selected entity.'
          }
        </p>
      ) : (
        <div className="space-y-2">
          {mentions.map((m, i) => (
            <div key={i} className="bg-osint-card border border-osint-border rounded px-3 py-2">
              <div className="flex items-center justify-between">
                <a href={m.story_url || '#'} target="_blank" rel="noopener noreferrer"
                   className="text-sm text-osint-text hover:text-osint-primary flex items-center gap-1">
                  {m.story_title || 'Untitled story'}
                  <ExternalLink size={10} />
                </a>
                <div className="flex items-center gap-2">
                  {m.sentiment_score !== 0 && (
                    <span className={`text-[10px] ${m.sentiment_score > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {m.sentiment_score > 0 ? '+' : ''}{m.sentiment_score.toFixed(2)}
                    </span>
                  )}
                  <span className="text-[10px] text-osint-muted">{m.source_name}</span>
                </div>
              </div>
              {m.context_window && (
                <p className="text-xs text-osint-text-secondary mt-1 line-clamp-2">
                  ...{m.context_window}...
                </p>
              )}
              {m.published_at && (
                <span className="text-[10px] text-osint-muted mt-1 block">
                  {new Date(m.published_at).toLocaleString()}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// SHARED COMPONENTS
// =============================================================================

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-sm text-osint-muted">Loading...</div>
    </div>
  )
}
