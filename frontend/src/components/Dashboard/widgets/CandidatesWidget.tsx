/**
 * Candidates Widget
 *
 * Compact candidate browser:
 * - Search by name
 * - Filter by party
 * - Show key stats
 */

import { memo, useEffect, useState, useMemo } from 'react';
import { Users, Search, Award, X, GraduationCap, MapPin, User, Calendar, History, Sparkles, BookOpen, ExternalLink, TrendingUp, TrendingDown, FileEdit } from 'lucide-react';
import { Widget } from '../Widget';
import { useElectionStore } from '../../../stores/electionStore';
import { loadElectionData } from '../../elections/electionDataLoader';
import { getPartyColor, getPartyShortLabel } from '../../../lib/partyColors';
import { PROVINCES, type Province } from '../../../data/districts';
import { deriveSourceLabel } from '../../../lib/sourceLabel';
import { usePermissions } from '../../../hooks/usePermissions';
import { CorrectionSubmitModal } from '../../dev/CorrectionSubmitModal';

// Normalize name for comparison across years
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,]/g, '');
}

interface ElectoralHistoryEntry {
  year: number;
  party: string;
  constituency: string;
  votes: number;
  votePct: number;
  isWinner: boolean;
  rank: number;
}

interface CandidateInfo {
  id: string;
  constituencyId: string;
  name: string;
  nameNe?: string;
  nameRoman?: string;  // Romanized English name for search
  aliases?: string[];  // Alternative names (KP Oli, Prachanda, etc.)
  party: string;
  partyNe?: string;
  constituency: string;
  district: string;
  province: string;
  votes: number;
  votePct: number;
  isWinner: boolean;
  rank: number;
  photoUrl?: string;
  age?: number;
  gender?: string;
  education?: string;
  biography?: string;
  biographySource?: string;
  biographySourceLabel?: string;
  isNotable?: boolean;
}

export const CandidatesWidget = memo(function CandidatesWidget() {
  const { electionYear, setMapViewLevel, selectProvince, selectDistrict, selectConstituency, pinConstituency } = useElectionStore();
  const { canProvideFeedback } = usePermissions();
  const [candidates, setCandidates] = useState<CandidateInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedParty, setSelectedParty] = useState<string | null>(null);
  const [showWinnersOnly, setShowWinnersOnly] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateInfo | null>(null);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [electoralHistory, setElectoralHistory] = useState<ElectoralHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const showCandidateOnMap = (candidate: CandidateInfo) => {
    setMapViewLevel('constituency');
    if (candidate.province && (PROVINCES as readonly string[]).includes(candidate.province)) {
      selectProvince(candidate.province as Province);
    }
    if (candidate.district) selectDistrict(candidate.district);
    if (candidate.constituencyId) {
      selectConstituency(candidate.constituencyId);
      pinConstituency(candidate.constituencyId);
    }
  };

  // Load electoral history when candidate is selected
  useEffect(() => {
    if (!selectedCandidate) {
      setElectoralHistory([]);
      return;
    }

    const loadHistory = async () => {
      setHistoryLoading(true);
      const history: ElectoralHistoryEntry[] = [];
      const normalizedName = normalizeName(selectedCandidate.name);
      const normalizedNameNe = selectedCandidate.nameNe ? normalizeName(selectedCandidate.nameNe) : null;

      // Load available election years (exclude 2074 due to data quality issues)
      const years = [2079, 2082];

      for (const year of years) {
        try {
          const data = await loadElectionData(year);
          if (!data) continue;

          for (const c of data.constituencies) {
            const sortedCandidates = [...c.candidates].sort((a, b) => b.votes - a.votes);
            const matchIdx = sortedCandidates.findIndex(
              (cand) => {
                // Match by romanized name, original name, or Nepali name
                const candRoman = cand.name_en_roman ? normalizeName(cand.name_en_roman) : null;
                const candOriginal = normalizeName(cand.name_en);
                const candNe = cand.name_ne ? normalizeName(cand.name_ne) : null;

                // Check all combinations
                if (candRoman === normalizedName || candOriginal === normalizedName) return true;
                if (normalizedNameNe && (candRoman === normalizedNameNe || candOriginal === normalizedNameNe)) return true;
                if (candNe && (candNe === normalizedName || candNe === normalizedNameNe)) return true;
                return false;
              }
            );

            if (matchIdx !== -1) {
              const match = sortedCandidates[matchIdx];
              history.push({
                year,
                party: match.party,
                constituency: c.name_en,
                votes: match.votes,
                votePct: match.vote_pct,
                isWinner: match.is_winner,
                rank: matchIdx + 1,
              });
              break; // Found in this year, move to next year
            }
          }
        } catch (err) {
          console.error(`Failed to load ${year} data for history:`, err);
        }
      }

      setElectoralHistory(history.sort((a, b) => b.year - a.year));
      setHistoryLoading(false);
    };

    loadHistory();
  }, [selectedCandidate]);

  useEffect(() => {
    if (!selectedCandidate) {
      setShowCorrectionModal(false);
    }
  }, [selectedCandidate]);

  // Get unique parties
  const parties = useMemo(() => {
    const set = new Set(candidates.map(c => c.party));
    return Array.from(set).sort();
  }, [candidates]);

  // Load candidates
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const data = await loadElectionData(electionYear);
        if (data) {
          const allCandidates: CandidateInfo[] = [];
          for (const c of data.constituencies) {
            // Sort candidates by votes to compute rank
            const sortedCandidates = [...c.candidates].sort((a, b) => b.votes - a.votes);
            sortedCandidates.forEach((candidate, idx) => {
              allCandidates.push({
                id: candidate.id || `${c.constituency_id}-${candidate.name_en}`,
                constituencyId: c.constituency_id,
                name: candidate.name_en_roman || candidate.name_en,  // Prefer romanized name
                nameNe: candidate.name_ne || candidate.name_en,
                nameRoman: candidate.name_en_roman,
                aliases: candidate.aliases,
                party: candidate.party,
                partyNe: candidate.party_ne,
                constituency: c.name_en,
                district: c.district,
                province: c.province,
                votes: candidate.votes,
                votePct: candidate.vote_pct,
                isWinner: candidate.is_winner,
                rank: idx + 1,
                photoUrl: candidate.photo_url || undefined,
                age: candidate.age || undefined,
                gender: candidate.gender,
                education: candidate.education,
                biography: candidate.biography,
                biographySource: candidate.biography_source,
                biographySourceLabel: candidate.biography_source_label,
                isNotable: candidate.is_notable,
              });
            });
          }
          setCandidates(allCandidates);
        }
      } catch (err) {
        console.error('Failed to load candidates:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [electionYear]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    let result = candidates;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => {
        // Check main name fields
        if (c.name.toLowerCase().includes(q)) return true;
        if (c.nameRoman && c.nameRoman.toLowerCase().includes(q)) return true;
        if (c.nameNe?.includes(searchQuery)) return true;  // Nepali text search
        if (c.constituency.toLowerCase().includes(q)) return true;
        if (c.district.toLowerCase().includes(q)) return true;

        // Check aliases (KP Oli, Prachanda, etc.)
        if (c.aliases?.some(alias => alias.toLowerCase().includes(q))) return true;

        return false;
      });
    }

    if (selectedParty) {
      result = result.filter(c => c.party === selectedParty);
    }

    if (showWinnersOnly) {
      result = result.filter(c => c.isWinner);
    }

    return result.sort((a, b) => b.votes - a.votes).slice(0, 50);
  }, [candidates, searchQuery, selectedParty, showWinnersOnly]);

  const totalWinners = candidates.filter(c => c.isWinner).length;

  return (
    <Widget
      id="candidates"
      icon={<Users size={14} />}
      badge={candidates.length}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Search & Filters */}
        <div className="p-2 border-b border-white/5 space-y-2">
          {/* Search */}
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search candidates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 text-[10px] bg-white/5 border border-white/10 rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X size={10} />
              </button>
            )}
          </div>

          {/* Filter row */}
          <div className="flex items-center gap-2">
            <select
              value={selectedParty || ''}
              onChange={(e) => setSelectedParty(e.target.value || null)}
              className="flex-1 text-[9px] bg-white/5 border border-white/10 rounded px-2 py-1 text-slate-300"
            >
              <option value="">All Parties</option>
              {parties.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              onClick={() => setShowWinnersOnly(!showWinnersOnly)}
              className={`flex items-center gap-1 px-2 py-1 text-[9px] rounded border transition-colors ${
                showWinnersOnly
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
            >
              <Award size={10} />
              Winners
            </button>
          </div>
        </div>

        {/* Results count */}
        <div className="px-2 py-1.5 text-[9px] text-slate-500 border-b border-white/5">
          Showing {filteredCandidates.length} of {candidates.length} candidates
          {showWinnersOnly && ` (${totalWinners} winners)`}
        </div>

        {/* Candidates list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Users size={24} className="text-slate-600 mb-2" />
              <div className="text-xs text-slate-500">No candidates found</div>
              <div className="text-[10px] text-slate-600 mt-1">Try a different search</div>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filteredCandidates.map((candidate) => {
                const color = getPartyColor(candidate.party);
                return (
                  <div
                    key={candidate.id}
                    onClick={() => {
                      setSelectedCandidate(candidate);
                    }}
                    className="p-2 hover:bg-white/[0.04] transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-2">
                      {/* Party color indicator */}
                      <div
                        className="w-1 h-full min-h-[32px] rounded-full mt-0.5"
                        style={{ background: color }}
                      />
                      <div className="flex-1 min-w-0">
                        {/* Name & winner badge */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-slate-200 truncate">
                            {candidate.name}
                          </span>
                          {candidate.isWinner && (
                            <Award size={10} className="text-emerald-500 flex-shrink-0" />
                          )}
                        </div>
                        {/* Party & constituency */}
                        <div className="flex items-center gap-1 mt-0.5 text-[9px]">
                          <span style={{ color }}>{getPartyShortLabel(candidate.party)}</span>
                          <span className="text-slate-600">•</span>
                          <span className="text-slate-500 truncate">{candidate.constituency}</span>
                        </div>
                      </div>
                      {/* Votes */}
                      <div className="text-right flex-shrink-0">
                        <div className="text-[10px] font-bold font-mono text-slate-300">
                          {candidate.votes.toLocaleString()}
                        </div>
                        <div className="text-[8px] text-slate-500">
                          {candidate.votePct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Candidate Profile Modal */}
      {selectedCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setSelectedCandidate(null)}
        >
          <div
            className="bg-[#13161a] border border-white/10 rounded-xl shadow-2xl w-[380px] max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with party color - fixed */}
            <div
              className="p-4 relative flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${getPartyColor(selectedCandidate.party)}30 0%, transparent 100%)` }}
            >
              <div className="absolute top-3 right-3 flex items-center gap-1.5">
                {canProvideFeedback && (
                  <button
                    onClick={() => setShowCorrectionModal(true)}
                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                    title="Suggest correction"
                  >
                    <FileEdit size={13} className="text-white" />
                  </button>
                )}
                <button
                  onClick={() => setSelectedCandidate(null)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <X size={14} className="text-white" />
                </button>
              </div>

              <div className="flex items-start gap-3">
                {/* Photo or placeholder */}
                <div className="w-16 h-16 rounded-lg bg-slate-800 overflow-hidden flex-shrink-0 border-2 border-white/10">
                  {selectedCandidate.photoUrl ? (
                    <img
                      src={selectedCandidate.photoUrl}
                      alt={selectedCandidate.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-800">
                      <User size={28} className="text-slate-500" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white">{selectedCandidate.name}</h3>
                    {selectedCandidate.isWinner && (
                      <Award size={16} className="text-emerald-400 flex-shrink-0" />
                    )}
                  </div>
                  {selectedCandidate.nameNe && selectedCandidate.nameNe !== selectedCandidate.name && (
                    <div className="text-xs text-slate-400 mt-0.5">{selectedCandidate.nameNe}</div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <div
                      className="w-2.5 h-2.5 rounded"
                      style={{ background: getPartyColor(selectedCandidate.party) }}
                    />
                    <span className="text-xs font-medium" style={{ color: getPartyColor(selectedCandidate.party) }}>
                      {selectedCandidate.party}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Quick Stats Row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                  <div className="text-lg font-bold text-white font-mono">{selectedCandidate.votes.toLocaleString()}</div>
                  <div className="text-[9px] text-slate-500 uppercase">Votes</div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                  <div className="text-lg font-bold text-white font-mono">{selectedCandidate.votePct.toFixed(1)}%</div>
                  <div className="text-[9px] text-slate-500 uppercase">Share</div>
                </div>
                <div className={`p-2.5 rounded-lg border text-center ${
                  selectedCandidate.isWinner
                    ? 'bg-emerald-500/10 border-emerald-500/30'
                    : 'bg-white/[0.03] border-white/5'
                }`}>
                  <div className={`text-lg font-bold font-mono ${selectedCandidate.isWinner ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {selectedCandidate.isWinner ? '1st' : `#${selectedCandidate.rank}`}
                  </div>
                  <div className="text-[9px] text-slate-500 uppercase">Rank</div>
                </div>
              </div>

              {/* Constituency */}
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <MapPin size={12} className="text-slate-500" />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wide">Constituency</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      showCandidateOnMap(selectedCandidate);
                      setSelectedCandidate(null);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 text-[10px] text-slate-300 transition-colors"
                    title="Show on election map"
                  >
                    <MapPin size={10} className="text-slate-400" />
                    Show on map
                  </button>
                </div>
                <div className="text-sm text-white font-medium">{selectedCandidate.constituency}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{selectedCandidate.district}, {selectedCandidate.province}</div>
              </div>

              {/* Personal Details - Compact */}
              {(selectedCandidate.age || selectedCandidate.gender) && (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Profile</div>
                  <div className="flex flex-wrap gap-3">
                    {selectedCandidate.age && (
                      <div className="flex items-center gap-1.5">
                        <Calendar size={11} className="text-slate-500" />
                        <span className="text-[11px] text-slate-300">{selectedCandidate.age} years</span>
                      </div>
                    )}
                    {selectedCandidate.gender && (
                      <div className="flex items-center gap-1.5">
                        <User size={11} className="text-slate-500" />
                        <span className="text-[11px] text-slate-300">{selectedCandidate.gender === 'पुरुष' ? 'Male' : selectedCandidate.gender === 'महिला' ? 'Female' : selectedCandidate.gender}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Biography */}
              {selectedCandidate.biography && (
                <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500/5 to-transparent border border-blue-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <BookOpen size={12} className="text-blue-400" />
                      <span className="text-[10px] text-blue-400 uppercase tracking-wide font-medium">Biography</span>
                    </div>
                    {selectedCandidate.biographySource && (
                      <a
                        href={selectedCandidate.biographySource}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300"
                      >
                        <span>{selectedCandidate.biographySourceLabel || deriveSourceLabel(selectedCandidate.biographySource) || 'Source'}</span>
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    {selectedCandidate.biography.length > 400
                      ? selectedCandidate.biography.slice(0, 400) + '...'
                      : selectedCandidate.biography}
                  </div>
                </div>
              )}

              {/* Electoral History */}
              <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="flex items-center gap-2 mb-3">
                  <History size={12} className="text-slate-500" />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Electoral History</span>
                  {!historyLoading && electoralHistory.length > 0 && (() => {
                    // Only count elections that actually happened (votes > 0)
                    const completedElections = electoralHistory.filter(e => e.votes > 0);
                    const wins = completedElections.filter(e => e.isWinner).length;
                    const losses = completedElections.filter(e => !e.isWinner).length;
                    if (completedElections.length === 0) return null;
                    return (
                      <span className="ml-auto text-[10px] font-mono">
                        <span className="text-emerald-400 font-bold">{wins}W</span>
                        <span className="text-slate-600 mx-0.5">-</span>
                        <span className="text-red-400 font-bold">{losses}L</span>
                      </span>
                    );
                  })()}
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : electoralHistory.length === 0 ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-transparent border border-blue-500/20">
                    <Sparkles size={18} className="text-blue-400 flex-shrink-0" />
                    <div>
                      <div className="text-[11px] font-semibold text-blue-400">First-Time Candidate</div>
                      <div className="text-[10px] text-slate-500">No previous electoral record in 2079 or 2082</div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {electoralHistory.map((entry, idx) => {
                      const isCurrentYear = entry.year === electionYear;
                      const prevEntry = electoralHistory[idx + 1];
                      const partyChanged = prevEntry && prevEntry.party !== entry.party;
                      // Only show vote change if both elections have votes
                      const voteChange = prevEntry && prevEntry.votes > 0 && entry.votes > 0
                        ? entry.votes - prevEntry.votes
                        : null;
                      const isPending = entry.votes === 0;

                      return (
                        <div
                          key={entry.year}
                          className={`p-2.5 rounded-lg border transition-all ${
                            isCurrentYear
                              ? 'bg-white/[0.04] border-white/10'
                              : 'bg-white/[0.01] border-white/5'
                          }`}
                        >
                          {/* Year & Result Row */}
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-bold text-white">{entry.year} BS</span>
                              {isCurrentYear && (
                                <span className="px-1.5 py-0.5 text-[7px] bg-blue-500/20 text-blue-400 rounded font-bold">
                                  CURRENT
                                </span>
                              )}
                            </div>
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                              isPending
                                ? 'bg-amber-500/20 text-amber-400'
                                : entry.isWinner
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-red-500/10 text-red-400'
                            }`}>
                              {isPending ? (
                                <span className="text-[9px] font-bold">PENDING</span>
                              ) : entry.isWinner ? (
                                <>
                                  <Award size={10} />
                                  <span className="text-[9px] font-bold">WON</span>
                                </>
                              ) : (
                                <span className="text-[9px] font-bold">#{entry.rank}</span>
                              )}
                            </div>
                          </div>

                          {/* Party & Constituency */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div
                                className="w-2 h-2 rounded-sm"
                                style={{ background: getPartyColor(entry.party) }}
                              />
                              <span
                                className="text-[10px] font-medium"
                                style={{ color: getPartyColor(entry.party) }}
                              >
                                {entry.party}
                              </span>
                              {partyChanged && (
                                <span className="ml-1 px-1 py-0.5 text-[7px] bg-purple-500/20 text-purple-400 rounded font-bold">
                                  SWITCHED
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Votes & Location */}
                          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/5">
                            <span className="text-[10px] text-slate-500">{entry.constituency}</span>
                            <div className="flex items-center gap-2">
                              {isPending ? (
                                <span className="text-[10px] text-amber-400/70 font-mono">Awaiting results</span>
                              ) : (
                                <>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {entry.votes.toLocaleString()} ({entry.votePct.toFixed(1)}%)
                                  </span>
                                  {voteChange !== null && voteChange !== 0 && (
                                    <span className={`flex items-center text-[9px] font-mono ${
                                      voteChange > 0 ? 'text-emerald-400' : 'text-red-400'
                                    }`}>
                                      {voteChange > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                      {voteChange > 0 ? '+' : ''}{voteChange.toLocaleString()}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCandidate && showCorrectionModal && canProvideFeedback && (
        <CorrectionSubmitModal
          candidate={{
            external_id: selectedCandidate.id,
            name_en: selectedCandidate.nameRoman || selectedCandidate.name,
            name_ne: selectedCandidate.nameNe,
            name_en_roman: selectedCandidate.nameRoman,
            biography: selectedCandidate.biography,
            biography_source: selectedCandidate.biographySource,
            education: selectedCandidate.education,
            age: selectedCandidate.age,
            gender: selectedCandidate.gender,
            aliases: selectedCandidate.aliases,
            previous_positions: electoralHistory.map((entry) => `${entry.year} · ${entry.constituency} · ${entry.party}`),
          }}
          onClose={() => setShowCorrectionModal(false)}
        />
      )}
    </Widget>
  );
});
