/**
 * CandidateDeepDive - Premium candidate intelligence card
 *
 * Triggered when selectedCandidateId is set (via CandidateTable click or OmniSearch).
 * Shows candidate photo, stats, party history, and fetches enrichment from backend.
 */

import { useMemo, useEffect, useState } from 'react'
import {
  X, User, Award, MapPin, Vote, GraduationCap, ExternalLink,
  Briefcase, Calendar, BookOpen, ChevronRight, Shield, Landmark, FileEdit,
} from 'lucide-react'
import { useElectionStore } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'
import { fetchCandidateDossier } from '../../api/elections'
import { usePermissions } from '../../hooks/usePermissions'
import { CorrectionSubmitModal } from '../dev/CorrectionSubmitModal'

function getProxyPhotoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  if (url.includes('election.gov.np')) {
    return `/api/v1/elections/image-proxy?url=${encodeURIComponent(url)}`
  }
  return url
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
  }>
}

interface DossierData {
  candidate: {
    id: string
    external_id: string
    name_en: string
    name_ne?: string
    name_en_roman?: string
    party: string
    party_ne?: string
    votes: number
    vote_pct: number
    rank: number
    is_winner: boolean
    is_notable?: boolean
    photo_url?: string
    age?: number
    gender?: string
    education?: string
    biography?: string
    biography_source?: string
    biography_source_label?: string
    profile_origin?: 'json' | 'override' | 'seed'
    aliases?: string[]
    previous_positions?: any
    linked_entity_id?: string
    entity_link_confidence?: number
  }
  constituency_code: string
  constituency_name: string
  district: string
  province: string
  province_id: number
  rivals: any[]
  previous_runs: Array<{
    election_year: number
    party_name?: string
    constituency_name?: string
    is_winner: boolean
    votes_received?: number
  }>
  story_count: number
  constituency_rank: number
  election_year: number
  is_running_2082: boolean
  parliamentary_record?: {
    mp_id?: string
    performance_score?: number
    performance_tier?: string
    performance_percentile?: number
    bills_introduced?: number
    bills_passed?: number
    session_attendance_pct?: number
    sessions_attended?: number
    sessions_total?: number
    questions_asked?: number
    is_minister?: boolean
    is_former_pm?: boolean
    pm_terms?: number
    notable_roles?: string
    ministry_portfolio?: string
  }
}

export function CandidateDeepDive() {
  const { selectedCandidateId, selectCandidate, constituencyResults, standaloneCandidateData } = useElectionStore()
  const { canProvideFeedback } = usePermissions()
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null)
  const [dossier, setDossier] = useState<DossierData | null>(null)
  const [loading, setLoading] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const [photoSource, setPhotoSource] = useState<'direct' | 'proxy'>('proxy')
  const [showCorrectionModal, setShowCorrectionModal] = useState(false)

  useEffect(() => {
    setPhotoFailed(false)
    setPhotoSource('proxy')
    setDossier(null)
    setEnrichment(null)
  }, [selectedCandidateId])

  const storeCandidate = useMemo(() => {
    if (!selectedCandidateId) return null
    for (const [, result] of constituencyResults) {
      for (const c of result.candidates) {
        if (c.id === selectedCandidateId) {
          return { candidate: c, constituency: result }
        }
      }
    }
    return null
  }, [selectedCandidateId, constituencyResults])

  const isStandaloneMode = !storeCandidate && !!standaloneCandidateData

  useEffect(() => {
    if (!selectedCandidateId || !isStandaloneMode) return
    if (!standaloneCandidateData?.external_id) return

    setLoading(true)
    fetchCandidateDossier(standaloneCandidateData.external_id)
      .then(data => setDossier(data as DossierData))
      .catch(() => setDossier(null))
      .finally(() => setLoading(false))
  }, [selectedCandidateId, isStandaloneMode, standaloneCandidateData?.external_id])

  useEffect(() => {
    if (!selectedCandidateId || isStandaloneMode) return

    setLoading(true)
    fetchCandidateDossier(selectedCandidateId)
      .then((data) => {
        const dossierData = data as DossierData
        setDossier(dossierData)
        setEnrichment({
          previous_runs: dossierData.previous_runs,
        })
      })
      .catch(() => {
        setDossier(null)
        setEnrichment(null)
      })
      .finally(() => setLoading(false))
  }, [selectedCandidateId, isStandaloneMode])

  if (!selectedCandidateId) return null
  if (!storeCandidate && !standaloneCandidateData) return null

  const candidate = dossier?.candidate ?? (storeCandidate ? storeCandidate.candidate : {
    id: standaloneCandidateData?.id,
    external_id: standaloneCandidateData?.external_id,
    name_en: standaloneCandidateData?.name_en,
    name_ne: standaloneCandidateData?.name_ne,
    name_en_roman: standaloneCandidateData?.name_en_roman || standaloneCandidateData?.name_en,
    party: standaloneCandidateData?.party,
    votes: standaloneCandidateData?.votes ?? 0,
    vote_pct: standaloneCandidateData?.vote_pct ?? 0,
    is_winner: standaloneCandidateData?.is_winner ?? false,
    is_notable: standaloneCandidateData?.is_notable,
    photo_url: standaloneCandidateData?.photo_url,
  }) as any

  const constituencyName = dossier?.constituency_name ?? storeCandidate?.constituency?.name_en ?? standaloneCandidateData?.constituency_name ?? ''
  const district = dossier?.district ?? storeCandidate?.constituency?.district ?? standaloneCandidateData?.district ?? ''
  const province = dossier?.province ?? storeCandidate?.constituency?.province ?? ''

  const rank = dossier?.constituency_rank
    ?? (storeCandidate?.constituency?.candidates?.length
      ? [...storeCandidate.constituency.candidates].sort((a: any, b: any) => b.votes - a.votes).findIndex((c: any) => c.id === candidate.id) + 1
      : standaloneCandidateData?.rank ?? candidate.rank ?? 0)

  const previousRuns = dossier?.previous_runs ?? enrichment?.previous_runs ?? []
  const previousPositions = storeCandidate?.candidate?.previous_positions
  const parlRecord = dossier?.parliamentary_record
  const partyColor = getPartyColor(candidate.party)
  const photoSrc = photoSource === 'proxy' ? getProxyPhotoUrl(candidate.photo_url) : candidate.photo_url
  const displayName = candidate.name_en_roman || candidate.name_en
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

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center"
      onClick={() => selectCandidate(null)}
      style={{ animation: 'diveBackdropIn 200ms ease-out forwards' }}
    >
      <div
        className="relative w-full max-w-[440px] mx-4 rounded-2xl overflow-hidden shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'diveCardIn 250ms cubic-bezier(0.16,1,0.3,1) forwards' }}
      >
        {/* Party-colored accent bar */}
        <div className="h-1" style={{ background: `linear-gradient(90deg, ${partyColor}, ${partyColor}88)` }} />

        {/* Card body */}
        <div className="bg-bp-bg border-x border-b border-bp-border">
          {/* Header: Close button */}
          <div className="flex items-center justify-between px-5 pt-4 pb-0">
            <div className="flex items-center gap-2">
              {candidate.is_winner && (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                  <Award size={10} />
                  WINNER
                </span>
              )}
              {candidate.is_notable && !candidate.is_winner && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                  Notable
                </span>
              )}
              {parlRecord?.is_former_pm && (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                  <Shield size={10} />
                  Former PM
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {canProvideFeedback && (
                <button
                  onClick={() => setShowCorrectionModal(true)}
                  className="p-1.5 text-bp-text-muted hover:text-blue-300 rounded-lg hover:bg-bp-card transition-colors"
                  title="Suggest correction"
                >
                  <FileEdit size={14} />
                </button>
              )}
              <button
                onClick={() => selectCandidate(null)}
                className="p-1.5 text-bp-text-muted hover:text-bp-text-secondary rounded-lg hover:bg-bp-card transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Hero: Photo + Name + Party */}
          <div className="px-5 pt-3 pb-4">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                {candidate.photo_url && !photoFailed ? (
                  <img
                    src={photoSrc}
                    alt=""
                    className="w-[72px] h-[72px] rounded-xl object-cover"
                    style={{ boxShadow: `0 0 0 2px ${partyColor}44, 0 8px 16px rgba(0,0,0,0.3)` }}
                    referrerPolicy="no-referrer"
                    onError={() => {
                      if (photoSource === 'proxy') { setPhotoSource('direct'); return }
                      setPhotoFailed(true)
                    }}
                  />
                ) : (
                  <div
                    className="w-[72px] h-[72px] rounded-xl bg-bp-card flex items-center justify-center"
                    style={{ boxShadow: `0 0 0 2px ${partyColor}44` }}
                  >
                    <User size={28} className="text-bp-text-muted" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <h2 className="text-lg font-bold text-bp-text leading-tight tracking-tight">
                  {displayName}
                </h2>
                {candidate.name_ne && candidate.name_ne !== displayName && (
                  <p className="text-[11px] text-bp-text-muted mt-0.5">{candidate.name_ne}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold"
                    style={{
                      backgroundColor: partyColor + '18',
                      color: partyColor,
                      border: `1px solid ${partyColor}30`,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: partyColor }} />
                    {candidate.party}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="px-5 pb-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-bp-card rounded-xl p-3 text-center border border-bp-border">
                <Vote size={14} className="mx-auto text-bp-text-muted mb-1" />
                <div className="text-base font-bold text-bp-text tabular-nums">{candidate.votes?.toLocaleString() ?? '0'}</div>
                <div className="text-[9px] text-bp-text-muted uppercase tracking-wider font-semibold mt-0.5">Votes</div>
              </div>
              <div className="bg-bp-card rounded-xl p-3 text-center border border-bp-border">
                <Award size={14} className="mx-auto text-bp-text-muted mb-1" />
                <div className="text-base font-bold text-bp-text tabular-nums">{(candidate.vote_pct ?? 0).toFixed(1)}%</div>
                <div className="text-[9px] text-bp-text-muted uppercase tracking-wider font-semibold mt-0.5">Share</div>
              </div>
              <div className="bg-bp-card rounded-xl p-3 text-center border border-bp-border">
                <MapPin size={14} className="mx-auto text-bp-text-muted mb-1" />
                <div className="text-base font-bold text-bp-text tabular-nums">#{rank}</div>
                <div className="text-[9px] text-bp-text-muted uppercase tracking-wider font-semibold mt-0.5">Rank</div>
              </div>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="max-h-[45vh] overflow-y-auto">
            <div className="px-5 pb-5 space-y-3">

              {/* Constituency */}
              {constituencyName && (
                <Section icon={<MapPin size={12} />} title="Constituency">
                  <div className="text-sm text-bp-text-secondary font-medium">{constituencyName}</div>
                  <div className="text-[11px] text-bp-text-muted mt-0.5">
                    {[district, province].filter(Boolean).join(' \u00B7 ')}
                  </div>
                </Section>
              )}

              {/* Profile: Age, Gender, Education */}
              {(candidate.age || candidate.gender) && (
                <Section icon={<User size={12} />} title="Profile">
                  <div className="flex flex-wrap items-center gap-2">
                    {candidate.age && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-bp-surface text-bp-text-secondary border border-bp-border">
                        {candidate.age} yrs
                      </span>
                    )}
                    {candidate.gender && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-bp-surface text-bp-text-secondary border border-bp-border">
                        {candidate.gender}
                      </span>
                    )}
                  </div>
                </Section>
              )}

              {/* Biography */}
              {candidate.biography && (
                <Section icon={<BookOpen size={12} />} title="Biography">
                  <p className="text-[11px] text-bp-text-secondary leading-relaxed">{candidate.biography}</p>
                  {candidate.biography_source && (
                    <a
                      href={candidate.biography_source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 mt-2 transition-colors"
                    >
                      <ExternalLink size={9} />
                      Source
                    </a>
                  )}
                </Section>
              )}

              {/* Parliamentary Record */}
              {parlRecord && (
                <Section icon={<Landmark size={12} />} title="Parliamentary Record">
                  {parlRecord.is_minister && parlRecord.ministry_portfolio && (
                    <div className="flex items-center gap-2 mb-2 text-[11px] text-amber-400 font-semibold">
                      <Briefcase size={11} />
                      <span>Minister — {parlRecord.ministry_portfolio}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    {parlRecord.performance_score != null && (
                      <MiniStat
                        value={parlRecord.performance_score.toFixed(1)}
                        label="Score"
                        tier={parlRecord.performance_tier}
                      />
                    )}
                    {parlRecord.session_attendance_pct != null && (
                      <MiniStat
                        value={`${parlRecord.session_attendance_pct.toFixed(0)}%`}
                        label="Attendance"
                      />
                    )}
                    {parlRecord.bills_introduced != null && (
                      <MiniStat
                        value={String(parlRecord.bills_introduced)}
                        label="Bills"
                      />
                    )}
                    {parlRecord.questions_asked != null && parlRecord.questions_asked > 0 && (
                      <MiniStat
                        value={String(parlRecord.questions_asked)}
                        label="Questions"
                      />
                    )}
                  </div>
                </Section>
              )}

              {/* Electoral History: Previous Positions */}
              {previousPositions && previousPositions.length > 0 && (
                <Section icon={<Calendar size={12} />} title="Electoral History">
                  <div className="space-y-1.5">
                    {previousPositions.map((pos: any, i: number) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-bp-text-secondary tabular-nums font-medium">{pos.year} BS</span>
                          <ChevronRight size={10} className="text-bp-text-muted" />
                          <span className="text-[11px] text-bp-text-secondary truncate max-w-[140px]">{pos.constituency}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {pos.votes && (
                            <span className="text-[10px] text-bp-text-muted tabular-nums">{pos.votes.toLocaleString()}</span>
                          )}
                          <Award size={10} className="text-emerald-400" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Electoral History: Previous Runs (from dossier) */}
              {previousRuns.length > 0 && (
                <Section icon={<Calendar size={12} />} title="Previous Runs">
                  <div className="space-y-1.5">
                    {previousRuns.map((run, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-bp-text-secondary tabular-nums font-medium">{run.election_year} BS</span>
                          {run.party_name && (
                            <>
                              <ChevronRight size={10} className="text-bp-text-muted" />
                              <span className="text-[10px] text-bp-text-muted">{run.party_name}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {run.votes_received != null && (
                            <span className="text-[10px] text-bp-text-muted tabular-nums">{run.votes_received.toLocaleString()}</span>
                          )}
                          {run.is_winner && <Award size={10} className="text-emerald-400" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* News Mentions */}
              {enrichment?.mentions && enrichment.mentions.length > 0 && (
                <Section icon={<BookOpen size={12} />} title="News Mentions">
                  <div className="space-y-1.5">
                    {enrichment.mentions.slice(0, 5).map((m, i) => (
                      <div key={i} className="bg-bp-card rounded-lg px-3 py-2 border border-bp-border">
                        <div className="text-[11px] text-bp-text-secondary line-clamp-1 font-medium">{m.story_title || 'Untitled'}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {m.source_name && <span className="text-[10px] text-bp-text-muted">{m.source_name}</span>}
                          {m.published_at && (
                            <span className="text-[10px] text-bp-text-muted">
                              {new Date(m.published_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center gap-2 py-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#6b7b8d] animate-pulse" />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#6b7b8d] animate-pulse" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#6b7b8d] animate-pulse" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes diveBackdropIn {
          from { background: rgba(0,0,0,0); backdrop-filter: blur(0); }
          to { background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); }
        }
        @keyframes diveCardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {showCorrectionModal && canProvideFeedback && (
        <CorrectionSubmitModal
          candidate={{
            external_id: candidate.external_id || candidate.id,
            name_en: candidate.name_en || displayName,
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

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bp-card/60 rounded-xl p-3.5 border border-bp-border">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-bp-text-muted">{icon}</span>
        <span className="text-[10px] font-bold text-bp-text-muted uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  )
}

function MiniStat({ value, label, tier }: { value: string; label: string; tier?: string }) {
  const tierColor = tier === 'top10' ? 'text-emerald-400'
    : tier === 'top25' ? 'text-blue-400'
    : tier === 'bottom10' ? 'text-red-400'
    : 'text-bp-text-secondary'

  return (
    <div className="bg-bp-bg rounded-lg p-2 text-center border border-bp-border">
      <div className={`text-sm font-bold tabular-nums ${tierColor}`}>{value}</div>
      <div className="text-[8px] text-bp-text-muted uppercase tracking-wider font-semibold mt-0.5">{label}</div>
    </div>
  )
}
