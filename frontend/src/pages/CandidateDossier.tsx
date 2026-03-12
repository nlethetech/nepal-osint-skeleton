/**
 * CandidateDossier - Palantir-grade Candidate Intelligence Page
 *
 * Answers the question: "Who is this person really?"
 * Self-contained: loads election data directly if not in store.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  User,
  Award,
  MapPin,
  Vote,
  GraduationCap,
  Newspaper,
  History,
  Users,
  TrendingUp,
  ExternalLink,
  AlertTriangle,
  Calendar,
  Building2,
  Loader2,
  Clock,
  Briefcase,
  Flag,
  Star,
  FileText,
  Globe,
  Lock,
  Brain,
  RefreshCw,
  Shield,
  Target,
  Zap,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { useElectionStore, type CandidateResult, type ConstituencyResult } from '../stores/electionStore'
import { getPartyColor } from '../components/elections/partyColors'
import { deriveSourceLabel } from '../lib/sourceLabel'
import { usePermissions } from '../hooks/usePermissions'
import { CorrectionSubmitModal } from '../components/dev/CorrectionSubmitModal'
// Note: Static file loading removed - API is primary data source
import {
  getCandidateDossier,
  getCandidateWikiLeaks,
  getCandidateLeadershipProfile,
  type WikiLeaksDocument,
  type CandidateWikiLeaksResponse,
  type LeadershipProfileResponse,
} from '../api/elections'
import apiClient from '../api/client'

type TabId = 'summary' | 'timeline' | 'news' | 'compare' | 'parliament' | 'wikileaks' | 'profile'

interface ParliamentRecord {
  id: string
  name_en: string
  name_ne?: string
  party?: string
  chamber?: string
  performance_score?: number
  performance_percentile?: number
  performance_tier?: string
  legislative_score?: number
  legislative_percentile?: number
  participation_score?: number
  participation_percentile?: number
  accountability_score?: number
  accountability_percentile?: number
  committee_score?: number
  committee_percentile?: number
  bills_introduced?: number
  bills_passed?: number
  session_attendance_pct?: number
  questions_asked?: number
  speeches_count?: number
  committee_memberships?: number
  committee_leadership_roles?: number
  peer_group?: string
  peer_rank?: number
  peer_total?: number
  is_former_pm?: boolean
  pm_terms?: number
  notable_roles?: string | string[]  // Backend returns string, handle both
}

interface EnrichmentData {
  previous_runs?: Array<{
    election_year: number
    party_name?: string
    constituency_name?: string
    is_winner: boolean
    votes_received?: number
  }>
  mentions?: Array<{
    story_title?: string
    source_name?: string
    published_at?: string
    url?: string
  }>
  parliamentary_record?: ParliamentRecord | null
  // Election status
  election_year?: number
  is_running_2082?: boolean
}

/** Proxy external election.gov.np photo URLs */
function getProxyPhotoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.includes('election.gov.np')) {
    return `/api/v1/elections/image-proxy?url=${encodeURIComponent(url)}`
  }
  return url
}

export default function CandidateDossier() {
  const navigate = useNavigate()
  const { id: candidateId } = useParams<{ id: string }>()
  const { constituencyResults, setConstituencyResults, electionYear } = useElectionStore()
  const { canProvideFeedback } = usePermissions()

  const [activeTab, setActiveTab] = useState<TabId>('summary')
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null)
  const [enrichLoading, setEnrichLoading] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const [photoSource, setPhotoSource] = useState<'proxy' | 'direct'>('proxy')
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [showCorrectionModal, setShowCorrectionModal] = useState(false)

  // API-fetched candidate data (fallback when not in store)
  const [apiCandidate, setApiCandidate] = useState<CandidateResult | null>(null)
  const [apiConstituency, setApiConstituency] = useState<ConstituencyResult | null>(null)

  // Skip static file loading - fetch directly from API instead
  // The dossier API is the primary data source, not static files

  // Find candidate in store (check both id and external_id)
  const candidateInfo = useMemo(() => {
    if (!candidateId || constituencyResults.size === 0) return null

    for (const [, result] of constituencyResults) {
      for (const c of result.candidates) {
        // Check both internal id and external_id
        if (c.id === candidateId || (c as any).external_id === candidateId) {
          return { candidate: c, constituency: result }
        }
      }
    }
    return null
  }, [candidateId, constituencyResults])

  // Use store data or API-fetched data
  const candidate = candidateInfo?.candidate || apiCandidate
  const constituency = candidateInfo?.constituency || apiConstituency

  // Fetch from API as primary data source
  useEffect(() => {
    // Skip if already have data from store or already loading
    if (candidateInfo || !candidateId) return
    // Skip if we already have API data for this candidate
    if (apiCandidate && apiCandidate.id === candidateId) return

    // Fetch directly from API
    setDataLoading(true)
    setDataError(null)
    getCandidateDossier(candidateId)
      .then((data) => {
        // Convert API response to CandidateResult format
        const c = data.candidate
        const candidateResult: CandidateResult = {
          id: c.external_id, // Use external_id for consistency
          name_en: c.name_en,
          name_ne: c.name_ne || '',
          name_en_roman: c.name_en_roman,
          aliases: c.aliases,
          party: c.party,
          votes: c.votes,
          vote_pct: c.vote_pct,
          is_winner: c.is_winner,
          photo_url: c.photo_url,
          age: c.age,
          gender: c.gender,
          education: c.education,
          biography: c.biography,
          biography_source: c.biography_source,
          biography_source_label: c.biography_source_label,
          profile_origin: c.profile_origin,
          previous_positions: c.previous_positions,
          is_notable: c.is_notable,
          linked_entity_id: c.linked_entity_id,
          entity_link_confidence: c.entity_link_confidence,
          entity_summary: c.entity_summary,
        }
        setApiCandidate(candidateResult)

        // Create constituency result from dossier data
        const constituencyResult: ConstituencyResult = {
          constituency_id: data.constituency_code,
          name_en: data.constituency_name,
          name_ne: '',
          district: data.district,
          province: data.province,
          province_id: data.province_id,
          status: 'declared',
          total_votes: 0,
          candidates: [
            candidateResult,
            ...data.rivals.map((r) => ({
              id: r.external_id,
              name_en: r.name_en,
              name_ne: r.name_ne || '',
              name_en_roman: r.name_en_roman,
              aliases: r.aliases,
              party: r.party,
              votes: r.votes,
              vote_pct: r.vote_pct,
              is_winner: r.is_winner,
              photo_url: r.photo_url,
              age: r.age,
              gender: r.gender,
              education: r.education,
              biography: r.biography,
              biography_source: r.biography_source,
              biography_source_label: r.biography_source_label,
              profile_origin: r.profile_origin,
              previous_positions: r.previous_positions,
              is_notable: r.is_notable,
              linked_entity_id: r.linked_entity_id,
              entity_link_confidence: r.entity_link_confidence,
              entity_summary: r.entity_summary,
            })),
          ],
        }
        setApiConstituency(constituencyResult)

        // Also set enrichment data
        setEnrichment({
          previous_runs: data.previous_runs?.map((run) => ({
            election_year: run.election_year,
            party_name: run.party_name,
            constituency_name: run.constituency_name,
            is_winner: run.is_winner,
            votes_received: run.votes_received,
          })),
          parliamentary_record: data.parliamentary_record || null,
          election_year: data.election_year,
          is_running_2082: data.is_running_2082,
        })
      })
      .catch((err) => {
        console.error('[CandidateDossier] API fetch failed:', err)
        setDataError('Candidate not found')
      })
      .finally(() => setDataLoading(false))
  }, [candidateId, candidateInfo, apiCandidate])

  // Get rivals (other candidates in same constituency)
  const rivals = useMemo(() => {
    if (!constituency || !candidate) return []
    return constituency.candidates
      .filter((c) => c.id !== candidate.id)
      .sort((a, b) => b.votes - a.votes)
  }, [constituency, candidate])

  // Get candidate's rank in constituency
  const rank = useMemo(() => {
    if (!constituency || !candidate) return 0
    return (
      [...constituency.candidates]
        .sort((a, b) => b.votes - a.votes)
        .findIndex((c) => c.id === candidate.id) + 1
    )
  }, [constituency, candidate])

  // Fetch enrichment data only if candidate loaded from store (API fetch already includes enrichment)
  useEffect(() => {
    if (!candidateId || !candidateInfo) {
      // Skip if no candidate ID or if data came from API (not store)
      return
    }

    // Only fetch enrichment if we have store data but no enrichment yet
    setEnrichLoading(true)
    setPhotoFailed(false)
    setPhotoSource('proxy')

    getCandidateDossier(candidateId)
      .then((data) => {
        // Map dossier response to enrichment format
        setEnrichment({
          previous_runs: data.previous_runs?.map(run => ({
            election_year: run.election_year,
            party_name: run.party_name,
            constituency_name: run.constituency_name,
            is_winner: run.is_winner,
            votes_received: run.votes_received,
          })),
          parliamentary_record: data.parliamentary_record || null,
          election_year: data.election_year,
          is_running_2082: data.is_running_2082,
        })
      })
      .catch((err) => {
        console.error('[CandidateDossier] Dossier fetch failed:', err)
        setEnrichment(null)
      })
      .finally(() => setEnrichLoading(false))
  }, [candidateId, candidateInfo])

  // Show loading state while loading data
  if (dataLoading) {
    return (
      <div className="min-h-screen bg-osint-bg text-osint-text flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-osint-accent" />
          <p className="text-osint-muted">Loading election data...</p>
        </div>
      </div>
    )
  }

  // Show error if data failed to load
  if (dataError) {
    return (
      <div className="min-h-screen bg-osint-bg text-osint-text p-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-osint-card border border-osint-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-osint-border transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className="text-lg font-semibold">Candidate Dossier</h1>
            </div>
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-red-400" />
              <p className="text-red-400">{dataError}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 bg-osint-accent text-white rounded-lg hover:bg-osint-accent/80 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Invalid candidate ID
  if (!candidateId) {
    return (
      <div className="min-h-screen bg-osint-bg text-osint-text p-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-osint-card border border-osint-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-osint-border transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className="text-lg font-semibold">Candidate Dossier</h1>
            </div>
            <div className="text-center py-12 text-osint-muted">
              <User className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Invalid candidate ID</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Candidate not found in data
  if (!candidate || !constituency) {
    return (
      <div className="min-h-screen bg-osint-bg text-osint-text p-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-osint-card border border-osint-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-osint-border transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h1 className="text-lg font-semibold">Candidate Dossier</h1>
            </div>
            <div className="text-center py-12 text-osint-muted">
              <User className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Candidate not found</p>
              <p className="text-xs mt-2">ID: {candidateId}</p>
              <button
                onClick={() => navigate('/elections')}
                className="mt-4 px-4 py-2 bg-osint-accent text-white rounded-lg hover:bg-osint-accent/80 transition-colors"
              >
                Browse All Candidates
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const photoSrc =
    photoSource === 'proxy'
      ? getProxyPhotoUrl(candidate.photo_url)
      : candidate.photo_url
  const correctionPreviousPositions = Array.isArray(candidate.previous_positions)
    ? candidate.previous_positions.map((pos: any) => {
        if (typeof pos === 'string') return pos
        if (pos && typeof pos === 'object') {
          return [pos.year, pos.constituency || pos.constituency_name, pos.party || pos.party_name]
            .filter(Boolean)
            .join(' · ')
        }
        return ''
      }).filter(Boolean)
    : []

  const tabs: { id: TabId; label: string; icon: typeof Newspaper }[] = [
    { id: 'summary', label: 'Summary', icon: User },
    { id: 'profile', label: 'AI Profile', icon: Brain },
    { id: 'timeline', label: 'Timeline', icon: Clock },
    { id: 'news', label: 'News Intel', icon: Newspaper },
    { id: 'compare', label: 'Compare', icon: Users },
    { id: 'parliament', label: 'Parliament', icon: Building2 },
    { id: 'wikileaks', label: 'WikiLeaks', icon: Lock },
  ]

  return (
    <div className="min-h-screen bg-osint-bg text-osint-text">
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg hover:bg-osint-border transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <span className="px-2 py-0.5 rounded bg-osint-border text-xs text-osint-muted">
                Candidate Dossier
              </span>
              {candidate.is_winner && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-xs border border-green-500/30">
                  <Award size={10} />
                  Winner
                </span>
              )}
              {/* Election Status Badge */}
              {enrichment?.is_running_2082 === false && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs border border-amber-500/30">
                  <Calendar size={10} />
                  {enrichment.election_year} Data (Not Running 2082)
                </span>
              )}
              {enrichment?.is_running_2082 === true && enrichment.election_year === 2082 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs border border-blue-500/30">
                  <Vote size={10} />
                  2082 Candidate
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
              {/* Photo */}
              {candidate.photo_url && !photoFailed ? (
                <img
                  src={photoSrc}
                  alt=""
                  className="w-20 h-20 rounded-xl object-cover border-2 border-osint-border shadow-lg"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (photoSource === 'proxy') {
                      setPhotoSource('direct')
                      return
                    }
                    setPhotoFailed(true)
                  }}
                />
              ) : (
                <div className="w-20 h-20 rounded-xl bg-osint-surface border-2 border-osint-border flex items-center justify-center shadow-lg">
                  <User size={32} className="text-osint-muted" />
                </div>
              )}

              <div>
                <h1 className="text-2xl font-bold text-osint-text">
                  {candidate.name_en_roman || candidate.name_en}
                </h1>
                {candidate.name_ne && (
                  <p className="text-osint-muted mt-0.5">{candidate.name_ne}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getPartyColor(candidate.party) }}
                  />
                  <span className="text-sm text-osint-text-secondary">
                    {candidate.party}
                  </span>
                  {candidate.is_notable && (
                    <span className="text-[10px] px-2 py-0.5 bg-osint-primary/10 text-osint-primary rounded">
                      Notable
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex-shrink-0 space-y-2">
            {canProvideFeedback && (
              <button
                onClick={() => setShowCorrectionModal(true)}
                className="w-full px-3 py-2 text-xs font-medium rounded-lg border border-blue-500/30 text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
              >
                Suggest Correction
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                icon={<Vote size={14} />}
                label="Votes"
                value={candidate.votes.toLocaleString()}
              />
              <StatCard
                icon={<TrendingUp size={14} />}
                label="Vote %"
                value={`${candidate.vote_pct.toFixed(1)}%`}
              />
              <StatCard icon={<MapPin size={14} />} label="Rank" value={`#${rank}`} />
              <StatCard
                icon={<Users size={14} />}
                label="Rivals"
                value={rivals.length.toString()}
              />
            </div>
          </div>
        </div>

        {/* Constituency Info Bar */}
        <div className="bg-osint-card border border-osint-border rounded-lg p-3 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Building2 size={14} className="text-osint-muted" />
            <span className="text-osint-text font-medium">
              {constituency.name_en}
            </span>
          </div>
          <span className="text-osint-muted">•</span>
          <span className="text-osint-text-secondary">{constituency.district}</span>
          <span className="text-osint-muted">•</span>
          <span className="text-osint-text-secondary">{constituency.province}</span>
          <span className="text-osint-muted">•</span>
          <span
            className={`px-2 py-0.5 rounded text-xs ${
              constituency.status === 'declared'
                ? 'bg-green-500/20 text-green-400'
                : constituency.status === 'counting'
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-osint-surface text-osint-muted'
            }`}
          >
            {constituency.status}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-osint-border pb-0">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-osint-card border border-osint-border border-b-osint-card text-osint-text -mb-px'
                    : 'text-osint-muted hover:text-osint-text'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab Content */}
        <div className="bg-osint-card border border-osint-border rounded-lg p-4">
          {activeTab === 'summary' && (
            <SummaryTab
              candidate={candidate}
              constituency={constituency}
              enrichment={enrichment}
              enrichLoading={enrichLoading}
              rank={rank}
            />
          )}
          {activeTab === 'profile' && (
            <AIProfileTab
              candidateId={candidateId}
              candidateName={candidate.name_en}
            />
          )}
          {activeTab === 'timeline' && (
            <TimelineTab
              candidate={candidate}
              enrichment={enrichment}
              loading={enrichLoading}
            />
          )}
          {activeTab === 'news' && (
            <NewsIntelTab
              candidateId={candidateId}
              candidateName={candidate.name_en}
              candidateNameNe={candidate.name_ne}
            />
          )}
          {activeTab === 'compare' && (
            <CompareTab candidate={candidate} rivals={rivals} />
          )}
          {activeTab === 'parliament' && (
            <ParliamentTab
              record={enrichment?.parliamentary_record || null}
              loading={enrichLoading}
            />
          )}
          {activeTab === 'wikileaks' && (
            <WikiLeaksTab
              candidateId={candidateId}
              candidateName={candidate.name_en}
            />
          )}
        </div>
      </div>

      {showCorrectionModal && canProvideFeedback && (
        <CorrectionSubmitModal
          candidate={{
            external_id: (candidate as any).external_id || candidate.id,
            name_en: candidate.name_en,
            name_ne: candidate.name_ne,
            name_en_roman: candidate.name_en_roman,
            biography: candidate.biography,
            biography_source: candidate.biography_source,
            education: candidate.education,
            age: candidate.age,
            gender: candidate.gender,
            aliases: candidate.aliases,
            previous_positions: correctionPreviousPositions,
          }}
          onClose={() => setShowCorrectionModal(false)}
        />
      )}
    </div>
  )
}

/** Stat card component */
function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-osint-surface/50 border border-osint-border rounded-lg p-2.5 text-center min-w-[80px]">
      <div className="flex items-center justify-center text-osint-muted mb-0.5">
        {icon}
      </div>
      <div className="text-sm font-semibold text-osint-text">{value}</div>
      <div className="text-[10px] text-osint-muted uppercase tracking-wider">
        {label}
      </div>
    </div>
  )
}

/** Summary Tab */
function SummaryTab({
  candidate,
  constituency,
  enrichment,
  enrichLoading,
  rank,
}: {
  candidate: CandidateResult
  constituency: ConstituencyResult
  enrichment: EnrichmentData | null
  enrichLoading: boolean
  rank: number
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Column */}
      <div className="space-y-4">
        {/* Biography */}
        {candidate.biography && (
          <div className="bg-osint-surface/30 rounded-lg p-4">
            <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <User size={12} />
              Biography
            </h3>
            <div className="text-sm text-osint-text leading-relaxed">
              {candidate.biography}
            </div>
            {candidate.biography_source && (
              <a
                href={candidate.biography_source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-osint-primary hover:underline mt-3"
              >
                <ExternalLink size={10} />
                Source: {candidate.biography_source_label || deriveSourceLabel(candidate.biography_source) || 'Reference'}
              </a>
            )}
          </div>
        )}

        {/* Previous Positions */}
        {candidate.previous_positions && candidate.previous_positions.length > 0 && (
          <div className="bg-osint-surface/30 rounded-lg p-4">
            <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <History size={12} />
              Previous Election Wins
            </h3>
            <div className="space-y-2">
              {candidate.previous_positions.map((pos, i) => (
                <div key={i} className="flex items-center justify-between bg-osint-surface/50 rounded px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-osint-text">{pos.year} BS</span>
                    <span className="text-osint-text-secondary mx-2">·</span>
                    <span className="text-sm text-osint-text-secondary">{pos.constituency}</span>
                    {pos.party && (
                      <>
                        <span className="text-osint-text-secondary mx-2">·</span>
                        <span className="text-xs text-osint-muted">{pos.party}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {pos.votes && (
                      <span className="text-xs text-osint-muted tabular-nums">
                        {pos.votes.toLocaleString()} votes
                      </span>
                    )}
                    <Award size={12} className="text-green-400" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Electoral Performance */}
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Vote size={12} />
            Electoral Performance
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] text-osint-muted mb-0.5">
                Total Votes
              </div>
              <div className="text-lg font-bold text-osint-text">
                {candidate.votes.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-osint-muted mb-0.5">
                Vote Share
              </div>
              <div className="text-lg font-bold text-osint-text">
                {candidate.vote_pct.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-osint-muted mb-0.5">Rank</div>
              <div className="text-lg font-bold text-osint-text">#{rank}</div>
            </div>
            <div>
              <div className="text-[10px] text-osint-muted mb-0.5">Status</div>
              <div
                className={`text-lg font-bold ${
                  candidate.is_winner ? 'text-green-400' : 'text-osint-text'
                }`}
              >
                {candidate.is_winner ? 'Winner' : 'Candidate'}
              </div>
            </div>
          </div>

          {/* Vote bar */}
          <div className="mt-4">
            <div className="h-2 bg-osint-bg rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${candidate.vote_pct}%`,
                  backgroundColor: getPartyColor(candidate.party),
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right Column */}
      <div className="space-y-4">
        {/* Political History */}
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <History size={12} />
            Political History
          </h3>

          {enrichLoading && (
            <div className="text-xs text-osint-muted animate-pulse">
              Loading history...
            </div>
          )}

          {!enrichLoading &&
            enrichment?.previous_runs &&
            enrichment.previous_runs.length > 0 && (
              <div className="space-y-2">
                {enrichment.previous_runs.map((run, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-osint-bg/50 rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-osint-text">
                        {run.election_year}
                      </span>
                      {run.party_name && (
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: getPartyColor(run.party_name),
                          }}
                        />
                      )}
                      {run.party_name && (
                        <span className="text-xs text-osint-text-secondary">
                          {run.party_name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {run.votes_received != null && (
                        <span className="text-xs text-osint-muted tabular-nums">
                          {run.votes_received.toLocaleString()} votes
                        </span>
                      )}
                      {run.is_winner && (
                        <Award size={12} className="text-green-400" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

          {!enrichLoading &&
            (!enrichment?.previous_runs ||
              enrichment.previous_runs.length === 0) && (
              <div className="text-sm text-osint-muted">
                No previous election history found
              </div>
            )}
        </div>

        {/* Constituency Overview */}
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MapPin size={12} />
            Constituency Overview
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-osint-muted">Name</span>
              <span className="text-sm text-osint-text">
                {constituency.name_en}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-osint-muted">District</span>
              <span className="text-sm text-osint-text">
                {constituency.district}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-osint-muted">Province</span>
              <span className="text-sm text-osint-text">
                {constituency.province}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-osint-muted">Total Candidates</span>
              <span className="text-sm text-osint-text">
                {constituency.candidates.length}
              </span>
            </div>
            {constituency.turnout_pct && (
              <div className="flex justify-between">
                <span className="text-xs text-osint-muted">Turnout</span>
                <span className="text-sm text-osint-text">
                  {constituency.turnout_pct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Career Timeline Tab - Visual journey through political career */
function TimelineTab({
  candidate,
  enrichment,
  loading,
}: {
  candidate: CandidateResult
  enrichment: EnrichmentData | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-osint-accent" />
      </div>
    )
  }

  // Combine all career events into a unified timeline
  interface TimelineEvent {
    year: number
    type: 'election' | 'pm' | 'minister' | 'party_change' | 'parliament'
    title: string
    subtitle?: string
    details?: string
    isWinner?: boolean
    party?: string
    votes?: number
    icon: typeof Vote
    color: string
  }

  const events: TimelineEvent[] = []

  // Add election runs
  if (enrichment?.previous_runs) {
    enrichment.previous_runs.forEach((run) => {
      events.push({
        year: run.election_year,
        type: 'election',
        title: run.is_winner ? 'Won Election' : 'Contested Election',
        subtitle: run.constituency_name,
        details: run.votes_received ? `${run.votes_received.toLocaleString()} votes` : undefined,
        isWinner: run.is_winner,
        party: run.party_name,
        votes: run.votes_received,
        icon: Vote,
        color: run.is_winner ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-blue-400 bg-blue-500/10 border-blue-500/30',
      })
    })
  }

  // Add PM terms from parliamentary record
  const record = enrichment?.parliamentary_record
  if (record?.is_former_pm && record.pm_terms && record.pm_terms > 0) {
    // We don't have exact years, but we can indicate PM service
    events.push({
      year: 2080, // Approximate - will be sorted
      type: 'pm',
      title: `Prime Minister (${record.pm_terms} term${record.pm_terms > 1 ? 's' : ''})`,
      subtitle: 'Head of Government',
      details: record.notable_roles
        ? Array.isArray(record.notable_roles)
          ? record.notable_roles.join(', ')
          : record.notable_roles
        : undefined,
      icon: Star,
      color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    })
  }

  // Add current parliament entry
  if (record) {
    events.push({
      year: 2079, // Current term
      type: 'parliament',
      title: 'Member of Parliament',
      subtitle: record.chamber === 'hor' ? 'House of Representatives' : 'National Assembly',
      details: record.committee_memberships
        ? `${record.committee_memberships} committee${record.committee_memberships !== 1 ? 's' : ''}`
        : undefined,
      icon: Building2,
      color: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
    })
  }

  // Sort by year descending (most recent first)
  events.sort((a, b) => b.year - a.year)

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-osint-muted">
        <Clock className="w-10 h-10 opacity-50" />
        <p className="text-sm">No political career data available</p>
        <p className="text-xs">Timeline will populate as data becomes available</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-osint-surface/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-osint-text">
            {enrichment?.previous_runs?.length || 0}
          </div>
          <div className="text-xs text-osint-muted">Elections Contested</div>
        </div>
        <div className="bg-osint-surface/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">
            {enrichment?.previous_runs?.filter(r => r.is_winner).length || 0}
          </div>
          <div className="text-xs text-osint-muted">Elections Won</div>
        </div>
        <div className="bg-osint-surface/30 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-amber-400">
            {record?.pm_terms || 0}
          </div>
          <div className="text-xs text-osint-muted">PM Terms</div>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-osint-border" />

        {/* Events */}
        <div className="space-y-4">
          {events.map((event, i) => {
            const Icon = event.icon
            return (
              <div key={`${event.year}-${event.type}-${i}`} className="relative pl-16">
                {/* Year marker */}
                <div className="absolute left-0 top-0 w-12 text-right">
                  <span className="text-sm font-mono font-bold text-osint-text">
                    {event.year}
                  </span>
                </div>

                {/* Icon marker on the line */}
                <div className={`absolute left-4 top-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${event.color}`}>
                  <Icon size={10} />
                </div>

                {/* Event card */}
                <div className={`rounded-lg p-4 border ${event.color.replace('text-', 'border-').split(' ')[2]} bg-osint-surface/30`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className={`font-semibold ${event.color.split(' ')[0]}`}>
                        {event.title}
                      </h4>
                      {event.subtitle && (
                        <p className="text-sm text-osint-text-secondary mt-0.5">
                          {event.subtitle}
                        </p>
                      )}
                      {event.details && (
                        <p className="text-xs text-osint-muted mt-1">
                          {event.details}
                        </p>
                      )}
                    </div>
                    {event.party && (
                      <div className="flex items-center gap-1.5 ml-4">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getPartyColor(event.party) }}
                        />
                        <span className="text-xs text-osint-muted whitespace-nowrap">
                          {event.party}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Winner badge */}
                  {event.isWinner && (
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/20 text-green-400 text-xs">
                      <Award size={10} />
                      Elected
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Party Affiliation History */}
      {enrichment?.previous_runs && enrichment.previous_runs.length > 1 && (
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Flag size={12} />
            Party Affiliation History
          </h3>
          <div className="flex flex-wrap gap-2">
            {[...new Set(enrichment.previous_runs.map(r => r.party_name).filter(Boolean))].map((party, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-osint-bg/50">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: getPartyColor(party || '') }}
                />
                <span className="text-xs text-osint-text">{party}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vote Trajectory Chart (Simple) */}
      {enrichment?.previous_runs && enrichment.previous_runs.filter(r => r.votes_received).length > 1 && (
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <TrendingUp size={12} />
            Vote Trajectory
          </h3>
          <div className="flex items-end gap-2 h-24">
            {[...enrichment.previous_runs]
              .filter(r => r.votes_received)
              .sort((a, b) => a.election_year - b.election_year)
              .map((run, i, arr) => {
                const maxVotes = Math.max(...arr.map(r => r.votes_received || 0))
                const height = maxVotes > 0 ? ((run.votes_received || 0) / maxVotes) * 100 : 0
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="text-[10px] text-osint-muted tabular-nums">
                      {(run.votes_received || 0).toLocaleString()}
                    </div>
                    <div
                      className={`w-full rounded-t transition-all ${
                        run.is_winner ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ height: `${Math.max(height, 5)}%` }}
                    />
                    <div className="text-[10px] text-osint-muted font-mono">{run.election_year}</div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Source Attribution */}
      <div className="pt-3 border-t border-osint-border/50 text-xs text-osint-muted flex items-center gap-1">
        <AlertTriangle size={10} />
        Timeline data compiled from Election Commission records and parliamentary sources.
      </div>
    </div>
  )
}

/** News Intelligence Tab */
function NewsIntelTab({
  candidateId,
  candidateName,
  candidateNameNe,
}: {
  candidateId: string
  candidateName: string
  candidateNameNe?: string
}) {
  const [hoursFilter, setHoursFilter] = useState(720) // 30 days default
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [stories, setStories] = useState<Array<{
    story_id?: string
    story_title?: string
    story_url?: string
    url?: string
    published_at?: string
    source_name?: string
    category?: string
    severity?: string
  }>>([])
  const [loading, setLoading] = useState(false)

  // Fetch stories when filters change
  useEffect(() => {
    async function fetchStories() {
      setLoading(true)
      try {
        const { data } = await apiClient.get(`/elections/candidates/${candidateId}/stories`, {
          params: {
            hours: hoursFilter,
            limit: 100,
            ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}),
          },
        })
        setStories(data?.stories || [])
      } catch (err) {
        console.error('[NewsIntelTab] Failed to fetch stories:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchStories()
  }, [candidateId, hoursFilter, categoryFilter])

  // Calculate sentiment metrics from stories
  const sentimentMetrics = useMemo(() => {
    if (stories.length === 0) return null

    // Categorize by severity
    const severityCounts = {
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    }

    // Categorize by category
    const categoryCounts: Record<string, number> = {}

    // Group by source
    const sourceCounts: Record<string, number> = {}

    // Group by day for timeline
    const dailyCounts: Record<string, number> = {}

    stories.forEach((story) => {
      // Severity
      const sev = story.severity?.toLowerCase() || 'unknown'
      if (sev === 'high' || sev === 'critical') severityCounts.high++
      else if (sev === 'medium' || sev === 'moderate') severityCounts.medium++
      else if (sev === 'low' || sev === 'minor') severityCounts.low++
      else severityCounts.unknown++

      // Category
      const cat = story.category || 'general'
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1

      // Source
      const src = story.source_name || 'Unknown'
      sourceCounts[src] = (sourceCounts[src] || 0) + 1

      // Daily
      if (story.published_at) {
        const day = story.published_at.split('T')[0]
        dailyCounts[day] = (dailyCounts[day] || 0) + 1
      }
    })

    // Calculate overall sentiment score (simplified)
    // High severity = negative, low = positive, medium = neutral
    const total = stories.length
    const sentimentScore = Math.round(
      ((severityCounts.low * 1 + severityCounts.unknown * 0.5 + severityCounts.medium * 0 - severityCounts.high * 1) /
        Math.max(total, 1)) *
        50 +
        50
    ) // Scale to 0-100

    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    // Last 7 days activity
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const key = d.toISOString().split('T')[0]
      return { date: key, count: dailyCounts[key] || 0 }
    })

    return {
      total,
      severityCounts,
      sentimentScore,
      topSources,
      topCategories,
      last7Days,
    }
  }, [stories])

  const timeOptions = [
    { value: 168, label: '7d' },
    { value: 720, label: '30d' },
    { value: 2160, label: '90d' },
    { value: 8760, label: 'All' },
  ]

  const categoryOptions = ['all', 'political', 'economic', 'security']

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center justify-between pb-3 border-b border-osint-border/50">
        <div className="flex items-center gap-1">
          <Calendar size={14} className="text-osint-muted mr-1" />
          {timeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setHoursFilter(opt.value)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                hoursFilter === opt.value
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {categoryOptions.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 text-xs rounded transition-colors capitalize ${
                categoryFilter === cat
                  ? 'bg-osint-accent text-white'
                  : 'bg-osint-surface text-osint-muted hover:text-osint-text'
              }`}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Sentiment Summary Panel */}
      {!loading && sentimentMetrics && sentimentMetrics.total > 0 && (
        <div className="bg-osint-surface/30 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {/* Total Stories */}
            <div className="text-center">
              <div className="text-2xl font-bold text-osint-text">{sentimentMetrics.total}</div>
              <div className="text-xs text-osint-muted">Total Mentions</div>
            </div>

            {/* Sentiment Score */}
            <div className="text-center">
              <div className={`text-2xl font-bold ${
                sentimentMetrics.sentimentScore >= 60
                  ? 'text-green-400'
                  : sentimentMetrics.sentimentScore >= 40
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}>
                {sentimentMetrics.sentimentScore}
              </div>
              <div className="text-xs text-osint-muted">
                Sentiment Score
                <span className="ml-1 text-[10px]">
                  ({sentimentMetrics.sentimentScore >= 60
                    ? 'Positive'
                    : sentimentMetrics.sentimentScore >= 40
                    ? 'Neutral'
                    : 'Negative'})
                </span>
              </div>
            </div>

            {/* High Severity */}
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{sentimentMetrics.severityCounts.high}</div>
              <div className="text-xs text-osint-muted">Critical Stories</div>
            </div>

            {/* Top Source */}
            <div className="text-center">
              <div className="text-lg font-bold text-osint-text truncate">
                {sentimentMetrics.topSources[0]?.[0] || '—'}
              </div>
              <div className="text-xs text-osint-muted">
                Top Source ({sentimentMetrics.topSources[0]?.[1] || 0})
              </div>
            </div>
          </div>

          {/* Activity Sparkline - Last 7 Days */}
          <div className="pt-3 border-t border-osint-border/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-osint-muted">7-Day Activity</span>
              <span className="text-xs text-osint-muted">
                {sentimentMetrics.last7Days.reduce((sum, d) => sum + d.count, 0)} stories
              </span>
            </div>
            <div className="flex items-end gap-1 h-8">
              {sentimentMetrics.last7Days.map((day, i) => {
                const maxCount = Math.max(...sentimentMetrics.last7Days.map((d) => d.count), 1)
                const height = (day.count / maxCount) * 100
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={`w-full rounded-sm transition-all ${
                        day.count > 0 ? 'bg-osint-accent' : 'bg-osint-border'
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                      title={`${day.date}: ${day.count} stories`}
                    />
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-osint-muted">7d ago</span>
              <span className="text-[10px] text-osint-muted">Today</span>
            </div>
          </div>

          {/* Category Breakdown */}
          {sentimentMetrics.topCategories.length > 1 && (
            <div className="pt-3 border-t border-osint-border/30">
              <span className="text-xs text-osint-muted mb-2 block">Coverage by Category</span>
              <div className="flex gap-2 flex-wrap">
                {sentimentMetrics.topCategories.map(([cat, count]) => (
                  <span
                    key={cat}
                    className="px-2 py-1 rounded bg-osint-bg/50 text-xs text-osint-text capitalize"
                  >
                    {cat} <span className="text-osint-muted">({count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stories List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-osint-accent" />
        </div>
      ) : stories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-osint-muted">
          <Newspaper className="w-10 h-10 opacity-50" />
          <p className="text-sm">No news stories found for {candidateName}</p>
          <p className="text-xs">
            Stories will appear when this candidate is mentioned in the news
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {stories.map((story, i) => (
            <a
              key={story.story_id || i}
              href={story.story_url || story.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 rounded-lg bg-osint-surface/50 border border-osint-border/30 hover:border-osint-accent/50 hover:bg-osint-surface transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-osint-muted">
                  <Newspaper size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-osint-text group-hover:text-osint-accent line-clamp-2 transition-colors">
                    {story.story_title || 'Untitled Story'}
                  </h4>
                  <div className="flex items-center gap-3 mt-2 text-xs text-osint-muted">
                    {story.source_name && (
                      <span className="flex items-center gap-1">
                        <Building2 size={10} />
                        {story.source_name}
                      </span>
                    )}
                    {story.published_at && (
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />
                        {formatRelativeTime(story.published_at)}
                      </span>
                    )}
                    {story.category && (
                      <span className="px-1.5 py-0.5 rounded bg-osint-surface text-osint-muted capitalize">
                        {story.category}
                      </span>
                    )}
                  </div>
                </div>
                <ExternalLink
                  size={14}
                  className="text-osint-muted group-hover:text-osint-accent transition-colors flex-shrink-0"
                />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Source Attribution */}
      <div className="pt-3 border-t border-osint-border/50 text-xs text-osint-muted">
        <span className="flex items-center gap-1">
          <AlertTriangle size={10} />
          News mentions are automatically linked via entity recognition. Some
          matches may be imprecise.
        </span>
      </div>
    </div>
  )
}

/** Compare Tab - Enhanced visual comparison with rivals */
function CompareTab({
  candidate,
  rivals,
}: {
  candidate: CandidateResult
  rivals: CandidateResult[]
}) {
  const [selectedRival, setSelectedRival] = useState<CandidateResult | null>(
    rivals.length > 0 ? rivals[0] : null
  )
  const topRivals = rivals.slice(0, 6)

  if (topRivals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-osint-muted">
        <Users className="w-10 h-10 opacity-50" />
        <p className="text-sm">No other candidates in this constituency</p>
      </div>
    )
  }

  // Calculate comparison metrics
  const allCandidates = [candidate, ...rivals]
  const maxVotes = Math.max(...allCandidates.map((c) => c.votes))
  const totalVotes = allCandidates.reduce((sum, c) => sum + c.votes, 0)

  // Head-to-head comparison data
  const comparisonMetrics = selectedRival
    ? [
        {
          label: 'Votes',
          main: candidate.votes,
          rival: selectedRival.votes,
          mainPct: (candidate.votes / maxVotes) * 100,
          rivalPct: (selectedRival.votes / maxVotes) * 100,
          format: (v: number) => v.toLocaleString(),
        },
        {
          label: 'Vote Share',
          main: candidate.vote_pct,
          rival: selectedRival.vote_pct,
          mainPct: candidate.vote_pct,
          rivalPct: selectedRival.vote_pct,
          format: (v: number) => `${v.toFixed(1)}%`,
        },
      ]
    : []

  return (
    <div className="space-y-6">
      {/* Visual Vote Distribution */}
      <div className="bg-osint-surface/30 rounded-lg p-4">
        <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <TrendingUp size={12} />
          Vote Distribution
        </h3>
        <div className="space-y-3">
          {[candidate, ...topRivals].map((c, i) => {
            const pct = (c.votes / maxVotes) * 100
            const isMain = c.id === candidate.id
            const isSelected = c.id === selectedRival?.id
            return (
              <button
                key={c.id}
                onClick={() => !isMain && setSelectedRival(c)}
                className={`w-full text-left transition-all rounded-lg p-2 ${
                  isMain
                    ? 'bg-osint-accent/10 border border-osint-accent/30'
                    : isSelected
                    ? 'bg-blue-500/10 border border-blue-500/30'
                    : 'hover:bg-osint-surface/50 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getPartyColor(c.party) }}
                    />
                    <span
                      className={`text-sm font-medium ${
                        isMain ? 'text-osint-accent' : 'text-osint-text'
                      }`}
                    >
                      {c.name_en}
                      {isMain && (
                        <span className="ml-2 text-[10px] text-osint-accent/70">(You)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-osint-muted tabular-nums">
                      {c.votes.toLocaleString()}
                    </span>
                    <span className="text-xs font-medium text-osint-text w-12 text-right tabular-nums">
                      {c.vote_pct.toFixed(1)}%
                    </span>
                    {c.is_winner && <Award size={14} className="text-green-400" />}
                  </div>
                </div>
                <div className="h-2 bg-osint-bg rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isMain ? 'bg-osint-accent' : isSelected ? 'bg-blue-500' : 'bg-osint-muted'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            )
          })}
        </div>
        {rivals.length > 6 && (
          <div className="pt-2 text-xs text-osint-muted text-center">
            +{rivals.length - 6} more candidates not shown
          </div>
        )}
      </div>

      {/* Head-to-Head Comparison */}
      {selectedRival && (
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <Users size={12} />
            Head-to-Head: {candidate.name_en} vs {selectedRival.name_en}
          </h3>

          {/* Side by Side Cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Main Candidate */}
            <div className="bg-osint-accent/10 rounded-lg p-3 border border-osint-accent/30">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getPartyColor(candidate.party) }}
                />
                <span className="font-semibold text-osint-accent">{candidate.name_en}</span>
              </div>
              <div className="text-xs text-osint-muted mb-1">{candidate.party}</div>
              <div className="text-2xl font-bold text-osint-text">
                {candidate.votes.toLocaleString()}
              </div>
              <div className="text-sm text-osint-accent">{candidate.vote_pct.toFixed(1)}% share</div>
            </div>

            {/* Rival */}
            <div className="bg-blue-500/10 rounded-lg p-3 border border-blue-500/30">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getPartyColor(selectedRival.party) }}
                />
                <span className="font-semibold text-blue-400">{selectedRival.name_en}</span>
              </div>
              <div className="text-xs text-osint-muted mb-1">{selectedRival.party}</div>
              <div className="text-2xl font-bold text-osint-text">
                {selectedRival.votes.toLocaleString()}
              </div>
              <div className="text-sm text-blue-400">{selectedRival.vote_pct.toFixed(1)}% share</div>
            </div>
          </div>

          {/* Comparison Bars */}
          <div className="space-y-4">
            {comparisonMetrics.map((metric) => {
              const mainWins = metric.main > metric.rival
              const diff = Math.abs(metric.main - metric.rival)
              return (
                <div key={metric.label}>
                  <div className="flex items-center justify-between text-xs text-osint-muted mb-1">
                    <span>{metric.label}</span>
                    <span className={mainWins ? 'text-green-400' : 'text-red-400'}>
                      {mainWins ? '+' : '-'}
                      {metric.label === 'Vote Share'
                        ? diff.toFixed(1) + '%'
                        : diff.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-1 h-6">
                    {/* Main bar (grows from center to left) */}
                    <div className="flex-1 flex justify-end">
                      <div
                        className="bg-osint-accent rounded-l h-full transition-all"
                        style={{ width: `${metric.mainPct}%` }}
                      />
                    </div>
                    {/* Divider */}
                    <div className="w-0.5 bg-osint-border" />
                    {/* Rival bar (grows from center to right) */}
                    <div className="flex-1">
                      <div
                        className="bg-blue-500 rounded-r h-full transition-all"
                        style={{ width: `${metric.rivalPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-osint-accent font-medium">{metric.format(metric.main)}</span>
                    <span className="text-blue-400 font-medium">{metric.format(metric.rival)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Margin of Victory/Defeat */}
          <div className="mt-6 p-3 rounded-lg bg-osint-bg/50 text-center">
            {candidate.votes > selectedRival.votes ? (
              <div>
                <span className="text-green-400 font-bold text-lg">
                  +{(candidate.votes - selectedRival.votes).toLocaleString()}
                </span>
                <span className="text-xs text-osint-muted ml-2">vote lead</span>
              </div>
            ) : candidate.votes < selectedRival.votes ? (
              <div>
                <span className="text-red-400 font-bold text-lg">
                  -{(selectedRival.votes - candidate.votes).toLocaleString()}
                </span>
                <span className="text-xs text-osint-muted ml-2">vote deficit</span>
              </div>
            ) : (
              <div className="text-osint-muted">Tied</div>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-osint-border">
              <th className="py-3 px-2 text-left text-xs text-osint-muted font-medium uppercase tracking-wider">
                Candidate
              </th>
              <th className="py-3 px-2 text-left text-xs text-osint-muted font-medium uppercase tracking-wider">
                Party
              </th>
              <th className="py-3 px-2 text-right text-xs text-osint-muted font-medium uppercase tracking-wider">
                Votes
              </th>
              <th className="py-3 px-2 text-right text-xs text-osint-muted font-medium uppercase tracking-wider">
                Share
              </th>
              <th className="py-3 px-2 text-center text-xs text-osint-muted font-medium uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            <CompareRow candidate={candidate} isHighlighted={true} />
            {topRivals.map((rival) => (
              <CompareRow
                key={rival.id}
                candidate={rival}
                isHighlighted={rival.id === selectedRival?.id}
                highlightColor="blue"
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CompareRow({
  candidate,
  isHighlighted,
  highlightColor = 'accent',
}: {
  candidate: CandidateResult
  isHighlighted: boolean
  highlightColor?: 'accent' | 'blue'
}) {
  return (
    <tr
      className={`border-b border-osint-border/30 ${
        isHighlighted
          ? highlightColor === 'blue'
            ? 'bg-blue-500/10'
            : 'bg-osint-accent/10'
          : ''
      }`}
    >
      <td className="py-3 px-2">
        <div className="flex items-center gap-2">
          {isHighlighted && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                highlightColor === 'blue' ? 'bg-blue-500' : 'bg-osint-accent'
              }`}
            />
          )}
          <span
            className={`font-medium ${
              isHighlighted
                ? highlightColor === 'blue'
                  ? 'text-blue-400'
                  : 'text-osint-accent'
                : 'text-osint-text'
            }`}
          >
            {candidate.name_en}
          </span>
        </div>
      </td>
      <td className="py-3 px-2">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: getPartyColor(candidate.party) }}
          />
          <span className="text-osint-text-secondary">{candidate.party}</span>
        </div>
      </td>
      <td className="py-3 px-2 text-right tabular-nums text-osint-text">
        {candidate.votes.toLocaleString()}
      </td>
      <td className="py-3 px-2 text-right tabular-nums text-osint-text">
        {candidate.vote_pct.toFixed(1)}%
      </td>
      <td className="py-3 px-2 text-center">
        {candidate.is_winner ? (
          <span className="inline-flex items-center gap-1 text-green-400 text-xs">
            <Award size={12} />
            Winner
          </span>
        ) : (
          <span className="text-osint-muted text-xs">—</span>
        )}
      </td>
    </tr>
  )
}

/** Parliament Performance Tab */
function ParliamentTab({
  record,
  loading,
}: {
  record: ParliamentRecord | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-osint-accent" />
      </div>
    )
  }

  if (!record) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-osint-muted">
        <Building2 className="w-10 h-10 opacity-50" />
        <p className="text-sm">No parliamentary record found</p>
        <p className="text-xs">This candidate may not have served in parliament</p>
      </div>
    )
  }

  const getTierColor = (tier?: string) => {
    switch (tier) {
      case 'top10':
        return 'text-green-400 bg-green-500/10 border-green-500/30'
      case 'above_avg':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      case 'average':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30'
      case 'below_avg':
        return 'text-orange-400 bg-orange-500/10 border-orange-500/30'
      case 'bottom10':
        return 'text-red-400 bg-red-500/10 border-red-500/30'
      default:
        return 'text-osint-muted bg-osint-surface border-osint-border'
    }
  }

  const getTierLabel = (tier?: string) => {
    switch (tier) {
      case 'top10':
        return 'Top 10%'
      case 'above_avg':
        return 'Above Average'
      case 'average':
        return 'Average'
      case 'below_avg':
        return 'Below Average'
      case 'bottom10':
        return 'Bottom 10%'
      default:
        return 'Unranked'
    }
  }

  return (
    <div className="space-y-6">
      {/* Former PM Badge */}
      {record.is_former_pm && (
        <div className="bg-gradient-to-r from-amber-500/20 to-amber-600/10 rounded-lg p-4 border border-amber-500/30">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Award className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <div className="font-bold text-amber-400 text-lg">
                Former Prime Minister
              </div>
              <div className="text-sm text-osint-muted">
                Served {record.pm_terms} term{record.pm_terms !== 1 ? 's' : ''} as PM
                {record.notable_roles ? ` • ${Array.isArray(record.notable_roles) ? record.notable_roles.join(', ') : record.notable_roles}` : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Score Card */}
      <div className="bg-gradient-to-r from-osint-accent/10 to-transparent rounded-lg p-4 border border-osint-accent/20">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-osint-muted uppercase tracking-wider">
              Performance Score
            </div>
            <div className="text-3xl font-bold text-osint-accent">
              {(record.performance_score ?? 0).toFixed(1)}/100
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-osint-muted">Percentile Rank</div>
            <div className="text-2xl font-bold text-osint-text">
              Top {100 - (record.performance_percentile || 50)}%
            </div>
            <div className="text-xs text-osint-muted mt-1">
              {record.peer_rank && record.peer_total && (
                <>#{record.peer_rank} of {record.peer_total} in {record.peer_group?.replace('_', ' ').toUpperCase()}</>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${getTierColor(
              record.performance_tier
            )}`}
          >
            <Award size={10} />
            {getTierLabel(record.performance_tier)}
          </span>
        </div>
      </div>

      {/* Category Scores Grid */}
      <div className="grid grid-cols-2 gap-4">
        <ScoreCard
          title="Legislative"
          weight="30%"
          score={record.legislative_score ?? 0}
          percentile={record.legislative_percentile}
          details={`${record.bills_introduced ?? 0} bills introduced, ${record.bills_passed ?? 0} passed`}
        />
        <ScoreCard
          title="Participation"
          weight="25%"
          score={record.participation_score ?? 0}
          percentile={record.participation_percentile}
          details={`${record.session_attendance_pct?.toFixed(0) || '—'}% session attendance`}
        />
        <ScoreCard
          title="Accountability"
          weight="25%"
          score={record.accountability_score ?? 0}
          percentile={record.accountability_percentile}
          details={`${record.questions_asked ?? 0} questions asked`}
        />
        <ScoreCard
          title="Committee Work"
          weight="20%"
          score={record.committee_score ?? 0}
          percentile={record.committee_percentile}
          details={`${record.committee_memberships ?? 0} committees, ${record.committee_leadership_roles ?? 0} leadership roles`}
        />
      </div>

      {/* Key Metrics */}
      <div className="bg-osint-surface/30 rounded-lg p-4">
        <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3">
          Key Metrics
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">{record.bills_introduced ?? 0}</div>
            <div className="text-xs text-osint-muted">Bills Introduced</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">{record.bills_passed ?? 0}</div>
            <div className="text-xs text-osint-muted">Bills Passed</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">{record.questions_asked ?? 0}</div>
            <div className="text-xs text-osint-muted">Questions Asked</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">{record.speeches_count ?? 0}</div>
            <div className="text-xs text-osint-muted">Speeches (Video)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">
              {record.session_attendance_pct?.toFixed(0) || '—'}%
            </div>
            <div className="text-xs text-osint-muted">Session Attendance</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">{record.committee_memberships ?? 0}</div>
            <div className="text-xs text-osint-muted">Committees</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-osint-text">{record.committee_leadership_roles ?? 0}</div>
            <div className="text-xs text-osint-muted">Leadership Roles</div>
          </div>
        </div>
      </div>

      {/* Chamber Info */}
      <div className="text-xs text-osint-muted flex items-center gap-2">
        <Building2 size={12} />
        <span>
          Chamber: {record.chamber === 'hor' ? 'House of Representatives' : 'National Assembly'}
        </span>
      </div>
    </div>
  )
}

/** Score Card for category display */
function ScoreCard({
  title,
  weight,
  score,
  percentile,
  details,
}: {
  title: string
  weight: string
  score: number
  percentile?: number
  details: string
}) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400'
    if (score >= 50) return 'text-blue-400'
    if (score >= 30) return 'text-amber-400'
    return 'text-red-400'
  }

  return (
    <div className="bg-osint-surface/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-osint-muted uppercase tracking-wider">{title}</span>
        <span className="text-[10px] text-osint-muted">Weight: {weight}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-xl font-bold ${getScoreColor(score)}`}>
          {score.toFixed(0)}
        </span>
        <span className="text-xs text-osint-muted">/100</span>
        {percentile && (
          <span className="text-xs text-osint-muted ml-auto">
            Top {100 - percentile}%
          </span>
        )}
      </div>
      <div className="mt-2">
        <div className="h-1.5 bg-osint-bg rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${getScoreColor(score).replace('text-', 'bg-')}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      <div className="mt-2 text-xs text-osint-muted">{details}</div>
    </div>
  )
}

/** Format relative time */
function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateString
  }
}

/** WikiLeaks Tab - Diplomatic cables and leaked documents */
function WikiLeaksTab({
  candidateId,
  candidateName,
}: {
  candidateId: string
  candidateName: string
}) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<CandidateWikiLeaksResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)

    getCandidateWikiLeaks(candidateId, 25)
      .then((result) => {
        setData(result)
      })
      .catch((err) => {
        console.error('[WikiLeaksTab] Fetch failed:', err)
        setError('Failed to search WikiLeaks')
      })
      .finally(() => setLoading(false))
  }, [candidateId])

  if (loading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3 text-osint-accent" />
        <p className="text-sm text-osint-muted">Searching WikiLeaks archives...</p>
        <p className="text-xs text-osint-muted mt-1">This may take a moment</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
        <p className="text-sm text-osint-muted">{error}</p>
      </div>
    )
  }

  if (!data || data.documents.length === 0) {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={16} className="text-osint-muted" />
            <h3 className="text-sm font-medium text-osint-text">WikiLeaks Intelligence</h3>
          </div>
          <p className="text-xs text-osint-muted">
            Search diplomatic cables, leaked documents, and classified materials from WikiLeaks archives.
          </p>
        </div>

        {/* No results */}
        <div className="text-center py-12 bg-osint-surface/30 rounded-lg">
          <FileText className="w-10 h-10 mx-auto mb-3 text-osint-muted opacity-50" />
          <p className="text-sm text-osint-muted">No WikiLeaks documents found mentioning</p>
          <p className="text-sm font-medium text-osint-text mt-1">{candidateName}</p>
          <p className="text-xs text-osint-muted mt-4 max-w-md mx-auto">
            Only documents that explicitly mention the candidate's name are shown.
            This candidate does not appear in leaked diplomatic cables or WikiLeaks archives.
          </p>
        </div>

        {/* Disclaimer */}
        <div className="text-xs text-osint-muted bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <span className="font-medium text-amber-400">Note:</span> WikiLeaks primarily contains
          diplomatic cables and leaked documents from 2000-2015. Many current politicians may not
          appear in these archives.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-osint-surface/30 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-amber-400" />
            <h3 className="text-sm font-medium text-osint-text">WikiLeaks Intelligence</h3>
          </div>
          <span className="text-xs text-osint-muted">
            {data.total_results} document{data.total_results !== 1 ? 's' : ''} found
          </span>
        </div>
        <p className="text-xs text-osint-muted">
          Diplomatic cables and leaked documents mentioning this candidate
        </p>
        {data.cache_hit && (
          <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px]">
            Cached result
          </span>
        )}
      </div>

      {/* Documents List */}
      <div className="space-y-3">
        {data.documents.map((doc, index) => (
          <WikiLeaksDocCard key={index} doc={doc} />
        ))}
      </div>

      {/* Search Info */}
      <div className="text-xs text-osint-muted flex items-center justify-between">
        <span>Search query: "{data.query}"</span>
        <span>Last searched: {new Date(data.searched_at).toLocaleString()}</span>
      </div>

      {/* Disclaimer */}
      <div className="text-xs text-osint-muted bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
        <span className="font-medium text-amber-400">Disclaimer:</span> WikiLeaks content is presented
        for research and intelligence purposes. Verify all information through official sources.
        Document relevance is algorithmically determined and may include false matches.
      </div>
    </div>
  )
}

/** WikiLeaks Document Card */
function WikiLeaksDocCard({ doc }: { doc: WikiLeaksDocument }) {
  const getCollectionColor = (collection: string) => {
    if (collection.includes('Cable')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    if (collection.includes('GI')) return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    if (collection.includes('PlusD')) return 'bg-green-500/20 text-green-400 border-green-500/30'
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }

  const getRelevanceBadge = (score: number) => {
    // Scores: 1.6+ = name in title AND snippet, 1.0+ = name in title OR strong snippet match
    // 0.7+ = good partial match, 0.5+ = minimum threshold (name parts found)
    if (score >= 1.5) return { label: 'Direct Mention', color: 'bg-green-500/20 text-green-400' }
    if (score >= 1.0) return { label: 'Strong Match', color: 'bg-blue-500/20 text-blue-400' }
    if (score >= 0.7) return { label: 'Good Match', color: 'bg-cyan-500/20 text-cyan-400' }
    return { label: 'Likely Match', color: 'bg-amber-500/20 text-amber-400' }
  }

  const relevance = getRelevanceBadge(doc.relevance_score)

  return (
    <a
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-osint-surface/30 hover:bg-osint-surface/50 border border-osint-border rounded-lg p-4 transition-colors group"
    >
      {/* Title */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-sm font-medium text-osint-text group-hover:text-osint-accent transition-colors line-clamp-2">
          {doc.title}
        </h4>
        <ExternalLink size={14} className="text-osint-muted flex-shrink-0 mt-0.5" />
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border ${getCollectionColor(doc.collection)}`}>
          <Globe size={10} />
          {doc.collection}
        </span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] ${relevance.color}`}>
          {relevance.label}
        </span>
        {doc.date_created && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-osint-border rounded text-[10px] text-osint-muted">
            <Calendar size={10} />
            {new Date(doc.date_created).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
          </span>
        )}
      </div>

      {/* Snippet */}
      {doc.snippet && (
        <p className="text-xs text-osint-text-secondary line-clamp-3 leading-relaxed">
          {doc.snippet}
        </p>
      )}
    </a>
  )
}

/** AI Leadership Profile Tab - Claude Haiku-powered analysis */
function AIProfileTab({
  candidateId,
  candidateName,
}: {
  candidateId: string
  candidateName: string
}) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<LeadershipProfileResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)

  const fetchProfile = async (forceRegenerate: boolean = false) => {
    if (forceRegenerate) {
      setRegenerating(true)
    } else {
      setLoading(true)
    }
    setError(null)

    try {
      const result = await getCandidateLeadershipProfile(candidateId, forceRegenerate)
      setProfile(result)
    } catch (err) {
      console.error('[AIProfileTab] Fetch failed:', err)
      setError('Failed to generate AI profile. API key may not be configured.')
    } finally {
      setLoading(false)
      setRegenerating(false)
    }
  }

  useEffect(() => {
    fetchProfile()
  }, [candidateId])

  if (loading) {
    return (
      <div className="text-center py-12">
        <Brain className="w-10 h-10 mx-auto mb-3 text-osint-accent animate-pulse" />
        <p className="text-sm text-osint-muted">Generating AI leadership profile...</p>
        <p className="text-xs text-osint-muted mt-1">Analyzing education, news, and diplomatic records</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
        <p className="text-sm text-osint-muted">{error}</p>
        <button
          onClick={() => fetchProfile(true)}
          className="mt-4 px-4 py-2 bg-osint-accent/20 hover:bg-osint-accent/30 text-osint-accent rounded-lg text-sm"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-center py-12">
        <Brain className="w-10 h-10 mx-auto mb-3 text-osint-muted opacity-50" />
        <p className="text-sm text-osint-muted">No profile data available</p>
      </div>
    )
  }

  const confidenceColors = {
    high: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    low: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Brain size={20} className="text-osint-accent" />
            <h2 className="text-lg font-semibold text-osint-text">AI Leadership Profile</h2>
            <span className={`px-2 py-0.5 rounded text-[10px] border ${confidenceColors[profile.confidence_level]}`}>
              {profile.confidence_level.toUpperCase()} CONFIDENCE
            </span>
          </div>
          <p className="text-xs text-osint-muted">
            Generated by Claude AI • {new Date(profile.generated_at).toLocaleString()}
          </p>
        </div>
        <button
          onClick={() => fetchProfile(true)}
          disabled={regenerating}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-osint-surface hover:bg-osint-border rounded-lg text-xs text-osint-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} />
          {regenerating ? 'Regenerating...' : 'Regenerate'}
        </button>
      </div>

      {/* Executive Summary */}
      <div className="bg-gradient-to-br from-osint-accent/10 to-osint-accent/5 border border-osint-accent/20 rounded-lg p-4">
        <h3 className="text-xs text-osint-accent uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <FileText size={12} />
          Executive Summary
        </h3>
        <p className="text-sm text-osint-text leading-relaxed">
          {profile.analyst_summary}
        </p>
      </div>

      {/* Leadership Style & Position */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Target size={12} />
            Leadership Style
          </h3>
          <p className="text-lg font-semibold text-osint-text">{profile.leadership_style}</p>
        </div>
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Flag size={12} />
            Ideological Position
          </h3>
          <p className="text-lg font-semibold text-osint-text">{profile.ideological_position}</p>
        </div>
      </div>

      {/* Strengths & Concerns */}
      <div className="grid grid-cols-2 gap-4">
        {/* Strengths */}
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-green-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <CheckCircle size={12} />
            Key Strengths
          </h3>
          <ul className="space-y-2">
            {profile.key_strengths.map((strength, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-osint-text">
                <Zap size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                <span>{strength}</span>
              </li>
            ))}
            {profile.key_strengths.length === 0 && (
              <li className="text-sm text-osint-muted italic">No strengths identified</li>
            )}
          </ul>
        </div>

        {/* Concerns */}
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-red-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Key Concerns
          </h3>
          <ul className="space-y-2">
            {profile.key_concerns.map((concern, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-osint-text">
                <XCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                <span>{concern}</span>
              </li>
            ))}
            {profile.key_concerns.length === 0 && (
              <li className="text-sm text-osint-muted italic">No concerns identified</li>
            )}
          </ul>
        </div>
      </div>

      {/* Policy Priorities */}
      {profile.policy_priorities.length > 0 && (
        <div className="bg-osint-surface/30 rounded-lg p-4">
          <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Briefcase size={12} />
            Policy Priorities
          </h3>
          <div className="flex flex-wrap gap-2">
            {profile.policy_priorities.map((policy, i) => (
              <span
                key={i}
                className="px-3 py-1.5 bg-osint-accent/10 border border-osint-accent/20 rounded-full text-sm text-osint-text"
              >
                {policy}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Experience Summary */}
      <div className="bg-osint-surface/30 rounded-lg p-4">
        <h3 className="text-xs text-osint-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <History size={12} />
          Experience Summary
        </h3>
        <p className="text-sm text-osint-text leading-relaxed">
          {profile.experience_summary}
        </p>
      </div>

      {/* Controversy Summary */}
      {profile.controversy_summary && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
          <h3 className="text-xs text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Controversy Analysis
          </h3>
          <p className="text-sm text-osint-text leading-relaxed">
            {profile.controversy_summary}
          </p>
        </div>
      )}

      {/* International Perception */}
      {profile.international_perception && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <h3 className="text-xs text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Globe size={12} />
            International Perception
          </h3>
          <p className="text-sm text-osint-text leading-relaxed">
            {profile.international_perception}
          </p>
          <p className="text-[10px] text-blue-400/70 mt-2">
            Based on WikiLeaks diplomatic cables and international documents
          </p>
        </div>
      )}

      {/* Data Sources & Disclaimer */}
      <div className="pt-4 border-t border-osint-border/50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-xs text-osint-muted mb-1.5">Data Sources Used</h4>
            <div className="flex flex-wrap gap-1.5">
              {profile.data_sources.map((source, i) => (
                <span key={i} className="px-2 py-0.5 bg-osint-border rounded text-[10px] text-osint-muted">
                  {source}
                </span>
              ))}
            </div>
          </div>
          {profile.cache_hit && (
            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-[10px]">
              Cached Result
            </span>
          )}
        </div>

        <div className="mt-4 p-3 bg-osint-surface/30 rounded-lg">
          <p className="text-[10px] text-osint-muted leading-relaxed">
            <span className="font-medium text-osint-text">Disclaimer:</span> This AI-generated profile
            is for informational purposes only. It synthesizes publicly available data and should not
            be considered authoritative. Verify important claims through official sources. The AI may
            make errors in interpretation or miss relevant context.
          </p>
        </div>
      </div>
    </div>
  )
}
