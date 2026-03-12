/**
 * ElectionsWidget - Palantir-Grade Election Monitoring Dashboard
 *
 * Comprehensive election intelligence with:
 * - Tabbed interface: Results, Swing Analysis, Candidates, Historical
 * - Live results tracking with real-time updates
 * - Party standings with seat visualization
 * - Swing analysis between elections (seat changes)
 * - Anti-incumbency analysis
 * - Close races detection
 * - Anomaly detection (unusual turnout, margins)
 * - Candidate profiles with photos and details
 * - Constituency watchlist
 * - Historical comparison between elections
 */

import { memo, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Widget } from '../Widget';
import { useDashboardStore } from '../../../stores/dashboardStore';
import { useElectionStore, type CandidateWatchItem, type PartyWatchItem } from '../../../stores/electionStore';
import {
  Vote, Radio, History, ChevronRight, AlertTriangle, TrendingUp, TrendingDown,
  Plus, Eye, MapPin, Star, Loader2, Users, Zap, Target, Shield, RefreshCcw,
  AlertCircle, CheckCircle2, Clock, BarChart3, User, X, ChevronDown, Award,
  ArrowUpDown, UserCheck, Search, Filter
} from 'lucide-react';
import {
  loadElectionData,
  toNationalSummary,
  computeSwingData,
  type ElectionData,
  type RawConstituencyResult,
  type RawCandidate,
} from '../../elections/electionDataLoader';
import { getPartyColor } from '../../../lib/partyColors';

// ============================================================================
// TYPES
// ============================================================================

type TabType = 'results' | 'swing' | 'candidates' | 'historical' | 'watchlist';

interface PartySeat {
  party: string;
  seats: number;
  leading: number;
  change?: number;
  votePct?: number;
  prevSeats?: number;
}

interface SummaryData {
  declared: number;
  counting: number;
  pending: number;
  total: number;
  turnout: number;
  partySeats: PartySeat[];
  totalVotes: number;
}

interface SwingEntry {
  party: string;
  currentSeats: number;
  previousSeats: number;
  change: number;
  changePct: number;
  color: string;
}

interface CloseRace {
  constituency: string;
  district: string;
  leader: string;
  leaderParty: string;
  runner: string;
  runnerParty: string;
  margin: number;
  marginPct: number;
}

interface Anomaly {
  type: 'high_turnout' | 'low_turnout' | 'lopsided' | 'close_race';
  constituency: string;
  district: string;
  value: number;
  threshold: number;
  severity: 'amber' | 'red';
}

interface IncumbencyData {
  retained: number;
  lost: number;
  total: number;
  retentionRate: number;
  majorLosses: Array<{
    constituency: string;
    party: string;
    incumbent: string;
    winner: string;
    winnerParty: string;
  }>;
}

interface CandidateProfile {
  id: string;
  name: string;
  nameNe?: string;
  party: string;
  constituencyId: string;
  constituency: string;
  district: string;
  votes: number;
  votePct: number;
  isWinner: boolean;
  photoUrl: string | null;
  age?: number;
  gender?: string;
  education?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function computeCloseRaces(data: ElectionData): CloseRace[] {
  const races: CloseRace[] = [];

  for (const c of data.constituencies) {
    if (c.status !== 'declared' || c.candidates.length < 2) continue;

    const sorted = [...c.candidates].sort((a: RawCandidate, b: RawCandidate) => b.votes - a.votes);
    const margin = sorted[0].votes - sorted[1].votes;
    const totalVotes = sorted.reduce((s: number, x: RawCandidate) => s + x.votes, 0);
    const marginPct = totalVotes > 0 ? (margin / totalVotes) * 100 : 0;

    if (marginPct < 5) {
      races.push({
        constituency: c.name_en,
        district: c.district,
        leader: sorted[0].name_en,
        leaderParty: sorted[0].party,
        runner: sorted[1].name_en,
        runnerParty: sorted[1].party,
        margin,
        marginPct,
      });
    }
  }

  return races.sort((a, b) => a.marginPct - b.marginPct).slice(0, 15);
}

function computeAnomalies(data: ElectionData): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const constituenciesWithTurnout = data.constituencies.filter((c: RawConstituencyResult) => c.turnout_pct && c.turnout_pct > 0);
  const avgTurnout = constituenciesWithTurnout.length > 0
    ? constituenciesWithTurnout.reduce((s: number, c: RawConstituencyResult) => s + (c.turnout_pct || 0), 0) / constituenciesWithTurnout.length
    : 65;

  for (const c of data.constituencies) {
    if (c.status !== 'declared') continue;

    // High turnout anomaly
    if (c.turnout_pct && c.turnout_pct > avgTurnout + 20) {
      anomalies.push({
        type: 'high_turnout',
        constituency: c.name_en,
        district: c.district,
        value: c.turnout_pct,
        threshold: avgTurnout + 20,
        severity: c.turnout_pct > avgTurnout + 30 ? 'red' : 'amber',
      });
    }

    // Low turnout anomaly
    if (c.turnout_pct && c.turnout_pct < avgTurnout - 20) {
      anomalies.push({
        type: 'low_turnout',
        constituency: c.name_en,
        district: c.district,
        value: c.turnout_pct,
        threshold: avgTurnout - 20,
        severity: c.turnout_pct < avgTurnout - 30 ? 'red' : 'amber',
      });
    }

    // Lopsided margin (>70% vote share)
    if (c.candidates.length > 0) {
      const sorted = [...c.candidates].sort((a: RawCandidate, b: RawCandidate) => b.votes - a.votes);
      const totalVotes = sorted.reduce((s: number, x: RawCandidate) => s + x.votes, 0);
      const topPct = totalVotes > 0 ? (sorted[0].votes / totalVotes) * 100 : 0;

      if (topPct > 70) {
        anomalies.push({
          type: 'lopsided',
          constituency: c.name_en,
          district: c.district,
          value: topPct,
          threshold: 70,
          severity: topPct > 80 ? 'red' : 'amber',
        });
      }
    }
  }

  return anomalies.slice(0, 15);
}

function computeIncumbency(currentData: ElectionData, prevData: ElectionData | null): IncumbencyData {
  if (!prevData) {
    return { retained: 0, lost: 0, total: 0, retentionRate: 0, majorLosses: [] };
  }

  // Build map of previous winners by party
  const prevWinners: globalThis.Map<string, { name: string; party: string }> = new globalThis.Map();
  for (const c of prevData.constituencies) {
    const winner = c.candidates.find((x: RawCandidate) => x.is_winner);
    if (winner) {
      prevWinners.set(c.constituency_id, { name: winner.name_en, party: winner.party });
    }
  }

  let retained = 0;
  let lost = 0;
  const majorLosses: IncumbencyData['majorLosses'] = [];

  for (const c of currentData.constituencies) {
    if (c.status !== 'declared') continue;

    const prev = prevWinners.get(c.constituency_id);
    if (!prev) continue;

    const currentWinner = c.candidates.find((x: RawCandidate) => x.is_winner);
    if (!currentWinner) continue;

    if (currentWinner.party === prev.party) {
      retained++;
    } else {
      lost++;
      majorLosses.push({
        constituency: c.name_en,
        party: prev.party,
        incumbent: prev.name,
        winner: currentWinner.name_en,
        winnerParty: currentWinner.party,
      });
    }
  }

  const total = retained + lost;
  return {
    retained,
    lost,
    total,
    retentionRate: total > 0 ? (retained / total) * 100 : 0,
    majorLosses: majorLosses.slice(0, 10),
  };
}

function computeSwingEntries(currentData: ElectionData, prevData: ElectionData | null): SwingEntry[] {
  if (!prevData) return [];

  const currentSeats: Record<string, number> = {};
  const prevSeats: Record<string, number> = {};

  for (const c of currentData.constituencies) {
    if (c.status === 'declared' && c.winner_party) {
      currentSeats[c.winner_party] = (currentSeats[c.winner_party] || 0) + 1;
    }
  }

  for (const c of prevData.constituencies) {
    if (c.status === 'declared' && c.winner_party) {
      prevSeats[c.winner_party] = (prevSeats[c.winner_party] || 0) + 1;
    }
  }

  const allParties = new Set([...Object.keys(currentSeats), ...Object.keys(prevSeats)]);
  const entries: SwingEntry[] = [];

  for (const party of allParties) {
    const curr = currentSeats[party] || 0;
    const prev = prevSeats[party] || 0;
    const change = curr - prev;

    if (curr > 0 || prev > 0) {
      entries.push({
        party,
        currentSeats: curr,
        previousSeats: prev,
        change,
        changePct: prev > 0 ? ((change / prev) * 100) : (curr > 0 ? 100 : 0),
        color: getPartyColor(party),
      });
    }
  }

  return entries.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

function extractCandidates(data: ElectionData): CandidateProfile[] {
  const candidates: CandidateProfile[] = [];

  for (const c of data.constituencies) {
    for (const cand of c.candidates) {
      candidates.push({
        id: cand.id,
        name: cand.name_en_roman || cand.name_en,
        nameNe: cand.name_ne || cand.name_en,
        party: cand.party,
        constituencyId: c.constituency_id,
        constituency: c.name_en,
        district: c.district,
        votes: cand.votes,
        votePct: cand.vote_pct,
        isWinner: cand.is_winner,
        photoUrl: cand.photo_url,
        age: cand.age || undefined,
        gender: cand.gender,
        education: cand.education,
      });
    }
  }

  return candidates;
}

type ConstituencyIndex = {
  byConstituencyId: globalThis.Map<string, RawConstituencyResult>;
  candidateToConstituencyId: globalThis.Map<string, string>;
  candidateMetaById: globalThis.Map<string, { candidate: RawCandidate; constituency: RawConstituencyResult }>;
  leaderByConstituencyId: globalThis.Map<string, {
    leaderId: string;
    leaderParty: string;
    leaderVotes: number;
    runnerVotes?: number;
    marginVotes?: number;
    totalVotes: number;
  }>;
};

function buildConstituencyIndex(data: ElectionData): ConstituencyIndex {
  const byConstituencyId = new globalThis.Map<string, RawConstituencyResult>();
  const candidateToConstituencyId = new globalThis.Map<string, string>();
  const candidateMetaById = new globalThis.Map<string, { candidate: RawCandidate; constituency: RawConstituencyResult }>();
  const leaderByConstituencyId = new globalThis.Map<string, {
    leaderId: string;
    leaderParty: string;
    leaderVotes: number;
    runnerVotes?: number;
    marginVotes?: number;
    totalVotes: number;
  }>();

  for (const c of data.constituencies) {
    byConstituencyId.set(c.constituency_id, c);

    const sorted = [...c.candidates].sort((a, b) => b.votes - a.votes);
    const totalVotes = sorted.reduce((s, x) => s + (x.votes || 0), 0);

    const declaredWinner = c.status === 'declared'
      ? c.candidates.find((x) => x.is_winner) || sorted[0]
      : null;
    const leader = declaredWinner || sorted[0];
    const runner = sorted.length > 1 ? sorted[1] : undefined;

    if (leader && leader.party) {
      leaderByConstituencyId.set(c.constituency_id, {
        leaderId: leader.id,
        leaderParty: leader.party,
        leaderVotes: leader.votes || 0,
        runnerVotes: runner?.votes,
        marginVotes: runner ? (leader.votes - runner.votes) : undefined,
        totalVotes,
      });
    }

    for (const cand of c.candidates) {
      candidateToConstituencyId.set(cand.id, c.constituency_id);
      candidateMetaById.set(cand.id, { candidate: cand, constituency: c });
    }
  }

  return { byConstituencyId, candidateToConstituencyId, candidateMetaById, leaderByConstituencyId };
}

type CandidateWatchStatus = {
  status: 'won' | 'lost' | 'leading' | 'trailing' | 'pending' | 'not_found';
  votes?: number;
  votePct?: number;
  marginVotes?: number;
  marginPct?: number;
  constituencyStatus?: 'declared' | 'counting' | 'pending';
  leaderParty?: string;
};

function getCandidateWatchStatus(candidateId: string, index: ConstituencyIndex): CandidateWatchStatus {
  const meta = index.candidateMetaById.get(candidateId);
  if (!meta) return { status: 'not_found' };

  const { candidate, constituency } = meta;
  const leader = index.leaderByConstituencyId.get(constituency.constituency_id);

  const votes = candidate.votes || 0;
  const votePct = candidate.vote_pct || 0;

  if (constituency.status === 'declared') {
    const won = candidate.is_winner || (!!leader && leader.leaderId === candidateId);
    const marginVotes = won ? leader?.marginVotes : (leader ? -(leader.leaderVotes - votes) : undefined);
    const totalVotes = leader?.totalVotes || 0;
    const marginPct = marginVotes !== undefined && totalVotes > 0 ? (Math.abs(marginVotes) / totalVotes) * 100 : undefined;
    return {
      status: won ? 'won' : 'lost',
      votes,
      votePct,
      marginVotes,
      marginPct,
      constituencyStatus: 'declared',
      leaderParty: leader?.leaderParty,
    };
  }

  if (constituency.status === 'counting') {
    if (!leader || leader.leaderVotes <= 0) {
      return { status: 'pending', votes, votePct, constituencyStatus: 'counting' };
    }
    const isLeader = leader.leaderId === candidateId;
    const marginVotes = isLeader ? leader.marginVotes : -(leader.leaderVotes - votes);
    const marginPct = leader.totalVotes > 0 ? (Math.abs(marginVotes || 0) / leader.totalVotes) * 100 : undefined;
    return {
      status: isLeader ? 'leading' : 'trailing',
      votes,
      votePct,
      marginVotes,
      marginPct,
      constituencyStatus: 'counting',
      leaderParty: leader.leaderParty,
    };
  }

  return { status: 'pending', votes, votePct, constituencyStatus: 'pending' };
}

type PartyStanding = {
  party: string;
  won: number;
  leading: number;
  total: number;
  rank: number;
  isOverallLeader: boolean;
};

function computePartyStandings(data: ElectionData): globalThis.Map<string, PartyStanding> {
  const won = new globalThis.Map<string, number>();
  const leading = new globalThis.Map<string, number>();

  for (const c of data.constituencies) {
    if (c.status === 'declared') {
      const winnerParty = c.winner_party || c.candidates.find((x) => x.is_winner)?.party || null;
      if (winnerParty) won.set(winnerParty, (won.get(winnerParty) || 0) + 1);
      continue;
    }
    if (c.status === 'counting') {
      const sorted = [...c.candidates].sort((a, b) => b.votes - a.votes);
      const leader = sorted[0];
      if (leader && leader.party && (leader.votes || 0) > 0) {
        leading.set(leader.party, (leading.get(leader.party) || 0) + 1);
      }
    }
  }

  const parties = new Set<string>([...won.keys(), ...leading.keys()]);
  const rows = Array.from(parties).map((party) => {
    const w = won.get(party) || 0;
    const l = leading.get(party) || 0;
    return { party, won: w, leading: l, total: w + l };
  });

  rows.sort((a, b) => (b.total - a.total) || (b.won - a.won) || a.party.localeCompare(b.party));

  const map = new globalThis.Map<string, PartyStanding>();
  rows.forEach((r, i) => {
    map.set(r.party, {
      ...r,
      rank: i + 1,
      isOverallLeader: i === 0,
    });
  });

  return map;
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function TabBar({ activeTab, onTabChange, hasData }: {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  hasData: boolean;
}) {
  const tabs: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
    { id: 'results', label: 'Results', icon: <Vote size={12} /> },
    { id: 'swing', label: 'Swing', icon: <ArrowUpDown size={12} /> },
    { id: 'candidates', label: 'Candidates', icon: <Users size={12} /> },
    { id: 'historical', label: 'Historical', icon: <History size={12} /> },
    { id: 'watchlist', label: 'Watchlist', icon: <Star size={12} /> },
  ];

  return (
    <div style={{
      display: 'flex',
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--bg-elevated)',
      overflow: 'auto',
    }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: 10,
            fontWeight: activeTab === tab.id ? 600 : 400,
            color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-muted)',
            background: activeTab === tab.id ? 'var(--bg-active)' : 'transparent',
            border: 'none',
            borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            transition: 'all 0.2s',
            minWidth: 70,
          }}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function StatusHeader({ summary, electionYear }: { summary: SummaryData; electionYear: number }) {
  const declaredPct = summary.total > 0 ? Math.round((summary.declared / summary.total) * 100) : 0;
  const isLive = summary.counting > 0 || (summary.declared > 0 && summary.declared < summary.total);

  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
      {/* Election year banner */}
      <div style={{
        padding: '6px 12px',
        background: isLive ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-active)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
            Federal Election {electionYear} BS
          </span>
          {isLive && (
            <span style={{
              padding: '2px 6px',
              background: '#22c55e',
              color: 'white',
              fontSize: 8,
              fontWeight: 700,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              <span style={{ width: 4, height: 4, background: 'white', borderRadius: '50%', animation: 'pulse 1s infinite' }} />
              LIVE
            </span>
          )}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          {summary.totalVotes.toLocaleString()} votes cast
        </div>
      </div>

      {/* Status counts */}
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1, padding: '10px', textAlign: 'center', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#22c55e' }}>
            {summary.declared}
          </div>
          <div style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Declared</div>
        </div>
        <div style={{ flex: 1, padding: '10px', textAlign: 'center', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#eab308' }}>
            {summary.counting}
          </div>
          <div style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Counting</div>
        </div>
        <div style={{ flex: 1, padding: '10px', textAlign: 'center', borderRight: '1px solid var(--border-subtle)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--text-secondary)' }}>
            {summary.pending}
          </div>
          <div style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Pending</div>
        </div>
        <div style={{ flex: 1, padding: '10px', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#3b82f6' }}>
            {summary.turnout > 0 ? `${summary.turnout.toFixed(1)}%` : '—'}
          </div>
          <div style={{ fontSize: 8, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>Turnout</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '6px 12px 8px' }}>
        <div style={{ height: 6, background: 'var(--bg-active)', borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${declaredPct}%`,
              background: 'linear-gradient(90deg, #22c55e 0%, #3b82f6 100%)',
              transition: 'width 0.5s ease',
              borderRadius: 3,
            }}
          />
        </div>
        <div style={{ textAlign: 'center', marginTop: 4, fontSize: 9, color: 'var(--text-muted)' }}>
          {declaredPct}% results declared ({summary.declared}/{summary.total} constituencies)
        </div>
      </div>
    </div>
  );
}

function PartyStandings({
  partySeats,
  showChange,
  electionYear,
  partyStandings,
  isPartyWatched,
  onTogglePartyWatch,
}: {
  partySeats: PartySeat[];
  showChange: boolean;
  electionYear: number;
  partyStandings: globalThis.Map<string, PartyStanding>;
  isPartyWatched: (party: string, electionYear: number) => boolean;
  onTogglePartyWatch: (party: string, electionYear: number) => void;
}) {
  const maxSeats = partySeats[0]?.seats || 1;

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ padding: '0 12px 8px', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
        <BarChart3 size={10} />
        Party Standings (House of Representatives - FPTP)
      </div>
      {partySeats.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
          No results declared yet
        </div>
      ) : (
        partySeats.slice(0, 10).map((party, i) => {
          const widthPct = maxSeats > 0 ? (party.seats / maxSeats) * 100 : 0;
          const color = getPartyColor(party.party);
          const watched = isPartyWatched(party.party, electionYear);
          const standing = partyStandings.get(party.party);

          return (
            <div
              key={party.party}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '5px 12px',
                gap: 8,
              }}
            >
              <div style={{ width: 4, height: 22, borderRadius: 2, background: color }} />
              <button
                onClick={() => onTogglePartyWatch(party.party, electionYear)}
                style={{
                  padding: 2,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: watched ? '#eab308' : 'var(--text-muted)',
                }}
                title={watched ? 'Unwatch party' : 'Watch party'}
              >
                <Star size={12} style={{ fill: watched ? 'currentColor' : 'none' }} />
              </button>
              <div style={{
                width: 80,
                fontSize: 10,
                fontWeight: 500,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {party.party.replace('CPN-', '').replace('Nepali ', '')}
              </div>
              <div style={{ flex: 1, height: 8, background: 'var(--bg-active)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${widthPct}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
              <div style={{
                width: 32,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-primary)'
              }}>
                {party.seats}
              </div>
              {!!standing && (
                <div style={{ width: 28, textAlign: 'right', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} title="Leading (counting)">
                  {standing.leading > 0 ? `+${standing.leading}` : '—'}
                </div>
              )}
              {showChange && party.change !== undefined && party.change !== 0 && (
                <div style={{
                  width: 36,
                  textAlign: 'right',
                  fontSize: 9,
                  color: party.change > 0 ? '#22c55e' : '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 2,
                  fontWeight: 600,
                }}>
                  {party.change > 0 ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                  {party.change > 0 ? '+' : ''}{party.change}
                </div>
              )}
              {!showChange && party.votePct && (
                <div style={{ width: 36, textAlign: 'right', fontSize: 9, color: 'var(--text-muted)' }}>
                  {party.votePct.toFixed(1)}%
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function SwingAnalysisTab({ swingData, currentYear, prevYear }: {
  swingData: SwingEntry[];
  currentYear: number;
  prevYear: number | null;
}) {
  if (!prevYear || swingData.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        <ArrowUpDown size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <div style={{ fontSize: 12 }}>No swing data available</div>
        <div style={{ fontSize: 10, marginTop: 4 }}>Requires comparison with previous election</div>
      </div>
    );
  }

  const gainers = swingData.filter(s => s.change > 0).sort((a, b) => b.change - a.change);
  const losers = swingData.filter(s => s.change < 0).sort((a, b) => a.change - b.change);

  return (
    <div style={{ padding: 12 }}>
      <div style={{
        padding: '8px 12px',
        background: 'var(--bg-active)',
        borderRadius: 6,
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Seat changes: {currentYear} BS vs {prevYear} BS
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          {swingData.length} parties compared
        </span>
      </div>

      {/* Gainers */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 9,
          textTransform: 'uppercase',
          color: '#22c55e',
          fontWeight: 600,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <TrendingUp size={10} />
          Seats Gained ({gainers.reduce((s, g) => s + g.change, 0)} total)
        </div>
        {gainers.slice(0, 6).map(entry => (
          <div key={entry.party} style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 8px',
            background: 'rgba(34, 197, 94, 0.05)',
            borderRadius: 4,
            marginBottom: 4,
            gap: 8,
          }}>
            <div style={{ width: 4, height: 20, borderRadius: 2, background: entry.color }} />
            <div style={{ flex: 1, fontSize: 10, fontWeight: 500 }}>
              {entry.party.replace('CPN-', '')}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {entry.previousSeats} → {entry.currentSeats}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              color: '#22c55e',
              minWidth: 36,
              textAlign: 'right',
            }}>
              +{entry.change}
            </div>
          </div>
        ))}
      </div>

      {/* Losers */}
      <div>
        <div style={{
          fontSize: 9,
          textTransform: 'uppercase',
          color: '#dc2626',
          fontWeight: 600,
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <TrendingDown size={10} />
          Seats Lost ({Math.abs(losers.reduce((s, l) => s + l.change, 0))} total)
        </div>
        {losers.slice(0, 6).map(entry => (
          <div key={entry.party} style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 8px',
            background: 'rgba(220, 38, 38, 0.05)',
            borderRadius: 4,
            marginBottom: 4,
            gap: 8,
          }}>
            <div style={{ width: 4, height: 20, borderRadius: 2, background: entry.color }} />
            <div style={{ flex: 1, fontSize: 10, fontWeight: 500 }}>
              {entry.party.replace('CPN-', '')}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
              {entry.previousSeats} → {entry.currentSeats}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              color: '#dc2626',
              minWidth: 36,
              textAlign: 'right',
            }}>
              {entry.change}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidatesTab({
  candidates,
  searchQuery,
  onSearchChange,
  partyFilter,
  onPartyFilterChange,
  parties,
  electionYear,
  isCandidateWatched,
  onToggleCandidateWatch,
}: {
  candidates: CandidateProfile[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  partyFilter: string;
  onPartyFilterChange: (p: string) => void;
  parties: string[];
  electionYear: number;
  isCandidateWatched: (candidateId: string, electionYear: number) => boolean;
  onToggleCandidateWatch: (item: CandidateWatchItem, electionYear: number) => void;
}) {
  const filtered = useMemo(() => {
    let result = candidates;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.constituency.toLowerCase().includes(q) ||
        c.district.toLowerCase().includes(q)
      );
    }

    if (partyFilter) {
      result = result.filter(c => c.party === partyFilter);
    }

    // Sort by votes descending
    return result.sort((a, b) => b.votes - a.votes).slice(0, 50);
  }, [candidates, searchQuery, partyFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search & Filter */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8 }}>
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-active)',
          padding: '4px 8px',
          borderRadius: 4,
        }}>
          <Search size={12} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search candidates..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontSize: 10,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
        <select
          value={partyFilter}
          onChange={(e) => onPartyFilterChange(e.target.value)}
          style={{
            padding: '4px 8px',
            fontSize: 9,
            background: 'var(--bg-active)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <option value="">All Parties</option>
          {parties.slice(0, 10).map(p => (
            <option key={p} value={p}>{p.replace('CPN-', '').substring(0, 15)}</option>
          ))}
        </select>
      </div>

      {/* Candidate List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
            No candidates found
          </div>
        ) : (
          filtered.map((cand, i) => (
            <div
              key={cand.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                gap: 10,
              }}
            >
              {/* Photo */}
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: getPartyColor(cand.party),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}>
                {cand.photoUrl ? (
                  <img
                    src={cand.photoUrl}
                    alt={cand.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <User size={16} style={{ color: 'white' }} />
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 2,
                }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {cand.name}
                  </span>
                  {cand.isWinner && (
                    <CheckCircle2 size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
                  )}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: getPartyColor(cand.party) }} />
                  {cand.party.replace('CPN-', '').substring(0, 12)} • {cand.constituency}
                </div>
              </div>

              {/* Votes */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: cand.isWinner ? '#22c55e' : 'var(--text-primary)',
                }}>
                  {cand.votes.toLocaleString()}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  {cand.votePct.toFixed(1)}%
                </div>
              </div>

              {/* Watch */}
              <button
                onClick={() => {
                  const item: CandidateWatchItem = {
                    candidate_id: cand.id,
                    election_year: electionYear,
                    name: cand.name,
                    party: cand.party,
                    constituency_id: cand.constituencyId,
                    constituency_name: cand.constituency,
                    district: cand.district,
                    photo_url: cand.photoUrl,
                    added_at: new Date().toISOString(),
                  };
                  onToggleCandidateWatch(item, electionYear);
                }}
                style={{
                  padding: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: isCandidateWatched(cand.id, electionYear) ? '#eab308' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
                title={isCandidateWatched(cand.id, electionYear) ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                <Star size={14} style={{ fill: isCandidateWatched(cand.id, electionYear) ? 'currentColor' : 'none' }} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function HistoricalTab({
  data2074,
  data2079,
  data2082
}: {
  data2074: ElectionData | null;
  data2079: ElectionData | null;
  data2082: ElectionData | null;
}) {
  const datasets = [
    { year: 2082, data: data2082 },
    { year: 2079, data: data2079 },
    { year: 2074, data: data2074 },
  ].filter(d => d.data !== null);

  if (datasets.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        <History size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <div style={{ fontSize: 12 }}>No historical data available</div>
      </div>
    );
  }

  // Get unique parties across all elections
  const allParties = new Set<string>();
  datasets.forEach(ds => {
    if (ds.data) {
      ds.data.national_summary.party_seats.forEach(p => allParties.add(p.party));
    }
  });

  // Build comparison data
  const partyComparison: Array<{
    party: string;
    color: string;
    seats: Record<number, number>;
  }> = [];

  for (const party of allParties) {
    const seats: Record<number, number> = {};
    datasets.forEach(ds => {
      if (ds.data) {
        const partyData = ds.data.national_summary.party_seats.find(p => p.party === party);
        seats[ds.year] = partyData?.seats || 0;
      }
    });
    partyComparison.push({ party, color: getPartyColor(party), seats });
  }

  // Sort by most recent seats
  partyComparison.sort((a, b) => {
    const aRecent = a.seats[2079] || a.seats[2082] || 0;
    const bRecent = b.seats[2079] || b.seats[2082] || 0;
    return bRecent - aRecent;
  });

  return (
    <div style={{ padding: 12 }}>
      <div style={{
        padding: '8px 12px',
        background: 'var(--bg-active)',
        borderRadius: 6,
        marginBottom: 12,
        fontSize: 10,
        color: 'var(--text-secondary)',
      }}>
        <History size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
        Historical seat comparison across {datasets.length} elections
      </div>

      {/* Table header */}
      <div style={{
        display: 'flex',
        padding: '6px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 9,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
      }}>
        <div style={{ flex: 2 }}>Party</div>
        {datasets.map(ds => (
          <div key={ds.year} style={{ width: 50, textAlign: 'center' }}>{ds.year}</div>
        ))}
        <div style={{ width: 50, textAlign: 'center' }}>Trend</div>
      </div>

      {/* Party rows */}
      {partyComparison.slice(0, 12).map(party => {
        const years = datasets.map(ds => ds.year);
        const recentYear = years[0];
        const prevYear = years[1];
        const trend = party.seats[recentYear] - (party.seats[prevYear] || 0);

        return (
          <div key={party.party} style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 8px',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 4, height: 16, borderRadius: 2, background: party.color }} />
              <span style={{ fontSize: 10, fontWeight: 500 }}>
                {party.party.replace('CPN-', '').substring(0, 18)}
              </span>
            </div>
            {datasets.map(ds => (
              <div key={ds.year} style={{
                width: 50,
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: party.seats[ds.year] > 0 ? 600 : 400,
                color: party.seats[ds.year] > 0 ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>
                {party.seats[ds.year] || '—'}
              </div>
            ))}
            <div style={{
              width: 50,
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 600,
              color: trend > 0 ? '#22c55e' : trend < 0 ? '#dc2626' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}>
              {trend !== 0 && (trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />)}
              {trend !== 0 && (trend > 0 ? '+' : '')}{trend !== 0 ? trend : '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WatchlistTab({
  watchlist,
  candidateWatchlist,
  partyWatchlist,
  partyStandings,
  constituencyIndex,
  candidates,
  constituencies,
  electionYear,
  onAddCandidate,
  onRemoveCandidate,
  isCandidateWatched,
  onAddParty,
  onRemoveParty,
  isPartyWatched,
  onAdd,
  onRemove,
  onOpenCandidate,
  onOpenParty,
}: {
  watchlist: Array<{ id: string; constituency_id: string; constituency_name?: string; district?: string; alert_level: string }>;
  candidateWatchlist: CandidateWatchItem[];
  partyWatchlist: PartyWatchItem[];
  partyStandings: globalThis.Map<string, PartyStanding>;
  constituencyIndex: ConstituencyIndex;
  candidates: CandidateProfile[];
  constituencies: RawConstituencyResult[];
  electionYear: number;
  onAddCandidate: (item: CandidateWatchItem) => void;
  onRemoveCandidate: (candidateId: string, electionYear: number) => void;
  isCandidateWatched: (candidateId: string, electionYear: number) => boolean;
  onAddParty: (party: string, electionYear: number) => void;
  onRemoveParty: (party: string, electionYear: number) => void;
  isPartyWatched: (party: string, electionYear: number) => boolean;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenCandidate: (candidateId: string) => void;
  onOpenParty: (party: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'candidates' | 'parties' | 'constituencies'>('all');

  const watchlistIds = new Set(watchlist.map(w => w.constituency_id));

  const activeCandidateWatchlist = useMemo(
    () => candidateWatchlist.filter((x) => x.election_year === electionYear),
    [candidateWatchlist, electionYear]
  );

  const activePartyWatchlist = useMemo(
    () => partyWatchlist.filter((x) => x.election_year === electionYear),
    [partyWatchlist, electionYear]
  );

  const partyNames = useMemo(() => {
    const names = Array.from(partyStandings.keys());
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }, [partyStandings]);

  const searchResults = useMemo(() => {
    const qRaw = searchQuery.trim();
    if (!qRaw) return { candidates: [] as CandidateProfile[], parties: [] as string[], constituencies: [] as RawConstituencyResult[] };

    const qLower = qRaw.toLowerCase();

    const score = (text: string) => {
      const t = text.toLowerCase();
      if (t === qLower) return 1000;
      if (t.startsWith(qLower)) return 850;
      if (t.includes(qLower)) return 650;
      return 0;
    };

    const canSearchCandidates = mode === 'all' || mode === 'candidates';
    const canSearchParties = mode === 'all' || mode === 'parties';
    const canSearchConstituencies = mode === 'all' || mode === 'constituencies';

    const candScored = canSearchCandidates
      ? candidates
        .map((c) => ({
          c,
          s:
            Math.max(score(c.name), c.nameNe ? score(c.nameNe) : 0) +
            score(c.party) * 0.6 +
            score(c.district) * 0.3 +
            score(c.constituency) * 0.3,
        }))
        .filter((x) => x.s > 0)
        .sort((a, b) => (b.s - a.s) || b.c.votes - a.c.votes)
        .map((x) => x.c)
        .slice(0, 10)
      : [];

    const partyScored = canSearchParties
      ? partyNames
        .map((p) => ({ p, s: score(p) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => (b.s - a.s) || a.p.localeCompare(b.p))
        .map((x) => x.p)
        .slice(0, 10)
      : [];

    const conScored = canSearchConstituencies
      ? constituencies
        .map((c) => ({ c, s: score(c.name_en) + score(c.district) * 0.6 }))
        .filter((x) => x.s > 0)
        .sort((a, b) => (b.s - a.s) || a.c.name_en.localeCompare(b.c.name_en))
        .map((x) => x.c)
        .slice(0, 10)
      : [];

    // Global cap of 10 results across all groups (keeps UI tight)
    const flat: Array<{ t: 'c' | 'p' | 'k'; v: any }> = [
      ...candScored.map((v) => ({ t: 'c' as const, v })),
      ...partyScored.map((v) => ({ t: 'p' as const, v })),
      ...conScored.map((v) => ({ t: 'k' as const, v })),
    ].slice(0, 10);

    return {
      candidates: flat.filter((x) => x.t === 'c').map((x) => x.v as CandidateProfile),
      parties: flat.filter((x) => x.t === 'p').map((x) => x.v as string),
      constituencies: flat.filter((x) => x.t === 'k').map((x) => x.v as RawConstituencyResult),
    };
  }, [searchQuery, mode, candidates, partyNames, constituencies]);

  const sortedCandidateWatchlist = useMemo(() => {
    const priority = (s: CandidateWatchStatus['status']) =>
      (s === 'leading' || s === 'won') ? 0 : (s === 'trailing' || s === 'lost') ? 1 : 2;
    return [...activeCandidateWatchlist].sort((a, b) => {
      const sa = getCandidateWatchStatus(a.candidate_id, constituencyIndex).status;
      const sb = getCandidateWatchStatus(b.candidate_id, constituencyIndex).status;
      const pa = priority(sa);
      const pb = priority(sb);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }, [activeCandidateWatchlist, constituencyIndex]);

  const sortedPartyWatchlist = useMemo(() => {
    return [...activePartyWatchlist].sort((a, b) => {
      const ra = partyStandings.get(a.party)?.rank ?? 999;
      const rb = partyStandings.get(b.party)?.rank ?? 999;
      return (ra - rb) || a.party.localeCompare(b.party);
    });
  }, [activePartyWatchlist, partyStandings]);

  const sortedConstituencyWatchlist = useMemo(() => {
    const prio = (status?: string) => status === 'counting' ? 0 : status === 'declared' ? 1 : 2;
    return [...watchlist].sort((a, b) => {
      const ca = constituencyIndex.byConstituencyId.get(a.constituency_id);
      const cb = constituencyIndex.byConstituencyId.get(b.constituency_id);
      return (prio(ca?.status) - prio(cb?.status)) || (a.constituency_name || a.constituency_id).localeCompare(b.constituency_name || b.constituency_id);
    });
  }, [watchlist, constituencyIndex]);

  const hasAnyWatched = sortedCandidateWatchlist.length + sortedPartyWatchlist.length + sortedConstituencyWatchlist.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search to add */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {(['all', 'candidates', 'parties', 'constituencies'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '3px 8px',
                fontSize: 9,
                borderRadius: 999,
                border: '1px solid var(--border-subtle)',
                background: mode === m ? 'var(--bg-active)' : 'transparent',
                color: mode === m ? 'var(--text-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {m === 'all' ? 'All' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-active)',
          padding: '6px 10px',
          borderRadius: 4,
        }}>
          <Search size={12} style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search candidates, parties, or constituencies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontSize: 10,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>

        {/* Search results */}
        {(searchResults.candidates.length > 0 || searchResults.parties.length > 0 || searchResults.constituencies.length > 0) && (
          <div style={{
            marginTop: 8,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 4,
            maxHeight: 150,
            overflow: 'auto',
          }}>
            {searchResults.candidates.map((c) => (
              <div key={`cand-${c.id}`} style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                <User size={12} style={{ color: 'var(--text-muted)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.district} • {c.constituency} • {c.party.replace('CPN-', '')}
                  </div>
                </div>
                <button
                  onClick={() => { onAddCandidate({ candidate_id: c.id, election_year: electionYear, name: c.name, party: c.party, constituency_id: c.constituencyId, constituency_name: c.constituency, district: c.district, photo_url: c.photoUrl, added_at: new Date().toISOString() }); setSearchQuery(''); }}
                  disabled={isCandidateWatched(c.id, electionYear)}
                  style={{
                    padding: '3px 8px',
                    fontSize: 9,
                    background: isCandidateWatched(c.id, electionYear) ? 'var(--bg-active)' : '#22c55e',
                    color: isCandidateWatched(c.id, electionYear) ? 'var(--text-muted)' : 'white',
                    border: 'none',
                    borderRadius: 3,
                    cursor: isCandidateWatched(c.id, electionYear) ? 'default' : 'pointer',
                  }}
                >
                  {isCandidateWatched(c.id, electionYear) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}

            {searchResults.parties.map((p) => (
              <div key={`party-${p}`} style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                <BarChart3 size={12} style={{ color: 'var(--text-muted)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.replace('CPN-', '')}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    Rank #{partyStandings.get(p)?.rank ?? '—'} • Won {partyStandings.get(p)?.won ?? 0} • Leading {partyStandings.get(p)?.leading ?? 0}
                  </div>
                </div>
                <button
                  onClick={() => { onAddParty(p, electionYear); setSearchQuery(''); }}
                  disabled={isPartyWatched(p, electionYear)}
                  style={{
                    padding: '3px 8px',
                    fontSize: 9,
                    background: isPartyWatched(p, electionYear) ? 'var(--bg-active)' : '#22c55e',
                    color: isPartyWatched(p, electionYear) ? 'var(--text-muted)' : 'white',
                    border: 'none',
                    borderRadius: 3,
                    cursor: isPartyWatched(p, electionYear) ? 'default' : 'pointer',
                  }}
                >
                  {isPartyWatched(p, electionYear) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}

            {searchResults.constituencies.map((c) => (
              <div key={`con-${c.constituency_id}`} style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                <MapPin size={12} style={{ color: 'var(--text-muted)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 500 }}>{c.name_en}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{c.district}</div>
                </div>
                {c.winner_party && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: getPartyColor(c.winner_party) }} />
                )}
                <button
                  onClick={() => { onAdd(c.constituency_id); setSearchQuery(''); }}
                  disabled={watchlistIds.has(c.constituency_id)}
                  style={{
                    padding: '3px 8px',
                    fontSize: 9,
                    background: watchlistIds.has(c.constituency_id) ? 'var(--bg-active)' : '#22c55e',
                    color: watchlistIds.has(c.constituency_id) ? 'var(--text-muted)' : 'white',
                    border: 'none',
                    borderRadius: 3,
                    cursor: watchlistIds.has(c.constituency_id) ? 'default' : 'pointer',
                  }}
                >
                  {watchlistIds.has(c.constituency_id) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist items */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!hasAnyWatched ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Star size={24} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontSize: 11 }}>Nothing on your watchlist</div>
            <div style={{ fontSize: 10, marginTop: 4 }}>Search above to add a candidate, party, or constituency</div>
          </div>
        ) : (
          <div>
            {/* Candidates */}
            {sortedCandidateWatchlist.length > 0 && (
              <div>
                <div style={{ padding: '8px 12px', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Candidates ({sortedCandidateWatchlist.length})
                </div>
                {sortedCandidateWatchlist.map((item) => {
                  const status = getCandidateWatchStatus(item.candidate_id, constituencyIndex);
                  const badge =
                    status.status === 'won' ? { label: 'WON', color: '#22c55e' } :
                    status.status === 'lost' ? { label: 'LOST', color: 'var(--text-muted)' } :
                    status.status === 'leading' ? { label: 'LEADING', color: '#22c55e' } :
                    status.status === 'trailing' ? { label: 'TRAILING', color: '#dc2626' } :
                    status.status === 'pending' ? { label: 'PENDING', color: 'var(--text-muted)' } :
                    { label: 'NOT FOUND', color: 'var(--text-muted)' };

                  const margin = status.marginVotes !== undefined
                    ? `${status.marginVotes > 0 ? '+' : ''}${status.marginVotes.toLocaleString()}`
                    : null;

                  return (
                    <div
                      key={`${item.candidate_id}-${item.election_year}`}
                      onClick={() => onOpenCandidate(item.candidate_id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px 12px',
                        borderBottom: '1px solid var(--border-subtle)',
                        gap: 10,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: getPartyColor(item.party),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0,
                      }}>
                        {item.photo_url ? (
                          <img
                            src={item.photo_url}
                            alt={item.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <User size={14} style={{ color: 'white' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.name}
                          </div>
                          <span style={{
                            fontSize: 8,
                            padding: '2px 6px',
                            borderRadius: 999,
                            border: `1px solid ${badge.color}`,
                            color: badge.color,
                            fontWeight: 700,
                            letterSpacing: '0.4px',
                          }}>
                            {badge.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.district} • {item.constituency_name} • {item.party.replace('CPN-', '')}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, display: 'flex', gap: 10, fontFamily: 'var(--font-mono)' }}>
                          <span>{(status.votes ?? 0).toLocaleString()} ({(status.votePct ?? 0).toFixed(1)}%)</span>
                          {margin && <span>margin {margin}{status.marginPct != null ? ` (${status.marginPct.toFixed(1)}%)` : ''}</span>}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveCandidate(item.candidate_id, item.election_year); }}
                        style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Parties */}
            {sortedPartyWatchlist.length > 0 && (
              <div>
                <div style={{ padding: '8px 12px', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Parties ({sortedPartyWatchlist.length})
                </div>
                {sortedPartyWatchlist.map((item) => {
                  const s = partyStandings.get(item.party);
                  const badge = s?.isOverallLeader ? '#22c55e' : 'var(--text-muted)';
                  const badgeLabel = s?.isOverallLeader ? '#1 LEADING' : `#${s?.rank ?? '—'}`;

                  return (
                    <div
                      key={`${item.party}-${item.election_year}`}
                      onClick={() => onOpenParty(item.party)}
                      style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', gap: 10, cursor: 'pointer' }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: getPartyColor(item.party) }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.party.replace('CPN-', '')}
                          </div>
                          <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 999, border: `1px solid ${badge}`, color: badge, fontWeight: 700 }}>
                            {badgeLabel}
                          </span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                          Won {s?.won ?? 0} • Leading {s?.leading ?? 0} • Total {s?.total ?? 0}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveParty(item.party, item.election_year); }}
                        style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Constituencies */}
            {sortedConstituencyWatchlist.length > 0 && (
              <div>
                <div style={{ padding: '8px 12px', fontSize: 9, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Constituencies ({sortedConstituencyWatchlist.length})
                </div>
                {sortedConstituencyWatchlist.map((item) => {
                  const constituency = constituencyIndex.byConstituencyId.get(item.constituency_id) || constituencies.find(c => c.constituency_id === item.constituency_id);
                  const leader = constituency ? constituencyIndex.leaderByConstituencyId.get(item.constituency_id) : undefined;
                  const leaderCandidate = constituency && leader ? constituency.candidates.find((x) => x.id === leader.leaderId) : undefined;

                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', gap: 10 }}>
                      <Star size={14} style={{ color: item.alert_level === 'high' ? '#dc2626' : '#eab308', fill: item.alert_level === 'high' ? '#dc2626' : '#eab308' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)' }}>
                          {item.constituency_name || item.constituency_id}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span>{item.district || constituency?.district}</span>
                          {constituency?.status && (
                            <>
                              <span>•</span>
                              <span style={{ fontFamily: 'var(--font-mono)' }}>{constituency.status.toUpperCase()}</span>
                            </>
                          )}
                          {constituency?.status === 'counting' && leaderCandidate && (
                            <>
                              <span>•</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: getPartyColor(leaderCandidate.party) }} />
                                {leaderCandidate.name_en_roman || leaderCandidate.name_en}
                              </span>
                            </>
                          )}
                          {constituency?.status === 'declared' && constituency?.winner_party && (
                            <>
                              <span>•</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: getPartyColor(constituency.winner_party) }} />
                                {constituency.winner_party.replace('CPN-', '')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemove(item.constituency_id)}
                        style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CloseRacesPanel({ races }: { races: CloseRace[] }) {
  if (races.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{
        padding: '8px 12px',
        fontSize: 9,
        textTransform: 'uppercase',
        color: '#f97316',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(249, 115, 22, 0.05)'
      }}>
        <Target size={10} />
        Close Races ({races.length})
      </div>
      <div style={{ maxHeight: 140, overflow: 'auto' }}>
        {races.slice(0, 5).map((race, i) => (
          <div
            key={race.constituency}
            style={{
              padding: '6px 12px',
              borderBottom: i < Math.min(races.length, 5) - 1 ? '1px solid var(--border-subtle)' : 'none',
              fontSize: 10,
            }}
          >
            <div style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 3 }}>
              {race.constituency}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: getPartyColor(race.leaderParty) }} />
                <span style={{ color: 'var(--text-secondary)' }}>{race.leader.split(' ').slice(-1)[0]}</span>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>vs</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: getPartyColor(race.runnerParty) }} />
                <span style={{ color: 'var(--text-secondary)' }}>{race.runner.split(' ').slice(-1)[0]}</span>
              </div>
              <span style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-mono)',
                color: '#f97316',
                fontWeight: 600,
                fontSize: 10
              }}>
                {race.marginPct.toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnomaliesPanel({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) return null;

  const getAnomalyLabel = (a: Anomaly) => {
    switch (a.type) {
      case 'high_turnout': return `High turnout: ${a.value.toFixed(1)}%`;
      case 'low_turnout': return `Low turnout: ${a.value.toFixed(1)}%`;
      case 'lopsided': return `Lopsided: ${a.value.toFixed(1)}% vote share`;
      default: return 'Anomaly detected';
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{
        padding: '8px 12px',
        fontSize: 9,
        textTransform: 'uppercase',
        color: '#dc2626',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(220, 38, 38, 0.05)'
      }}>
        <AlertTriangle size={10} />
        Anomalies ({anomalies.length})
      </div>
      <div style={{ maxHeight: 100, overflow: 'auto' }}>
        {anomalies.slice(0, 4).map((anomaly, i) => (
          <div
            key={`${anomaly.constituency}-${anomaly.type}`}
            style={{
              padding: '5px 12px',
              borderBottom: i < Math.min(anomalies.length, 4) - 1 ? '1px solid var(--border-subtle)' : 'none',
              fontSize: 9,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{anomaly.constituency}</span>
              <span style={{ color: anomaly.severity === 'red' ? '#dc2626' : '#f97316', marginLeft: 6 }}>
                {getAnomalyLabel(anomaly)}
              </span>
            </div>
            <div style={{
              padding: '2px 5px',
              borderRadius: 3,
              fontSize: 7,
              fontWeight: 700,
              background: anomaly.severity === 'red' ? 'rgba(220, 38, 38, 0.15)' : 'rgba(249, 115, 22, 0.15)',
              color: anomaly.severity === 'red' ? '#dc2626' : '#f97316',
            }}>
              {anomaly.severity.toUpperCase()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IncumbencyPanel({ data }: { data: IncumbencyData }) {
  if (data.total === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{
        padding: '8px 12px',
        fontSize: 9,
        textTransform: 'uppercase',
        color: '#8b5cf6',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'rgba(139, 92, 246, 0.05)'
      }}>
        <RefreshCcw size={10} />
        Anti-Incumbency ({data.total} compared)
      </div>
      <div style={{ padding: '8px 12px' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{data.retained}</div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Retained</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: '#dc2626' }}>{data.lost}</div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Lost</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700, color: '#8b5cf6' }}>{data.retentionRate.toFixed(0)}%</div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>Retention</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN WIDGET
// ============================================================================

export const ElectionsWidget = memo(function ElectionsWidget() {
  const navigate = useNavigate();
  const { widgetSizes } = useDashboardStore();
  const {
    electionYear, setElectionYear, availableYears,
    watchlist: storeWatchlist, setWatchlist, addToWatchlist, removeFromWatchlist: removeFromWatchlistStore,
    candidateWatchlist,
    partyWatchlist,
    addCandidateToWatchlist,
    removeCandidateFromWatchlist,
    isCandidateWatched,
    addPartyToWatchlist,
    removePartyFromWatchlist,
    isPartyWatched,
  } = useElectionStore();

  const size = widgetSizes['elections'] || 'medium';

  const [activeTab] = useState<TabType>('watchlist');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [electionData, setElectionData] = useState<ElectionData | null>(null);
  const [prevElectionData, setPrevElectionData] = useState<ElectionData | null>(null);
  const [data2074, setData2074] = useState<ElectionData | null>(null);
  const [data2079, setData2079] = useState<ElectionData | null>(null);
  const [data2082, setData2082] = useState<ElectionData | null>(null);

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [swingData, setSwingData] = useState<SwingEntry[]>([]);
  const [closeRaces, setCloseRaces] = useState<CloseRace[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [incumbency, setIncumbency] = useState<IncumbencyData | null>(null);
  const [candidates, setCandidates] = useState<CandidateProfile[]>([]);

  // Filter states
  const [candidateSearch, setCandidateSearch] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [showYearDropdown, setShowYearDropdown] = useState(false);

  // Derived
  const parties = useMemo(() => {
    if (!summary) return [];
    return summary.partySeats.map(p => p.party);
  }, [summary]);

  const prevYear = electionYear === 2082 ? 2079 : electionYear === 2079 ? 2074 : null;
  const constituencyIndex = useMemo<ConstituencyIndex>(() => {
    if (!electionData) {
      return {
        byConstituencyId: new globalThis.Map(),
        candidateToConstituencyId: new globalThis.Map(),
        candidateMetaById: new globalThis.Map(),
        leaderByConstituencyId: new globalThis.Map(),
      };
    }
    return buildConstituencyIndex(electionData);
  }, [electionData]);

  const partyStandings = useMemo(() => {
    if (!electionData) return new globalThis.Map<string, PartyStanding>();
    return computePartyStandings(electionData);
  }, [electionData]);

  // Keep legacy components referenced (they remain in file for future use),
  // but the widget is intentionally watchlist-only for a cleaner consumer UX.
  void TabBar;
  void StatusHeader;

  // Load all election data on mount
  useEffect(() => {
    const loadAllData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Load all years in parallel
        const [d2074, d2079, d2082] = await Promise.all([
          loadElectionData(2074),
          loadElectionData(2079),
          loadElectionData(2082),
        ]);

        setData2074(d2074);
        setData2079(d2079);
        setData2082(d2082);

        // Set current year data
        const currentData = electionYear === 2082 ? d2082 : electionYear === 2079 ? d2079 : d2074;
        const previousData = electionYear === 2082 ? d2079 : electionYear === 2079 ? d2074 : null;

        if (!currentData) {
          setError('No election data available');
          setIsLoading(false);
          return;
        }

        setElectionData(currentData);
        setPrevElectionData(previousData);

        // Process data
        processElectionData(currentData, previousData);

      } catch (err) {
        console.error('[ElectionsWidget] Error loading data:', err);
        setError('Failed to load election data');
      } finally {
        setIsLoading(false);
      }
    };

    loadAllData();
  }, []);

  // Update when year changes
  useEffect(() => {
    if (!data2074 && !data2079 && !data2082) return;

    const currentData = electionYear === 2082 ? data2082 : electionYear === 2079 ? data2079 : data2074;
    const previousData = electionYear === 2082 ? data2079 : electionYear === 2079 ? data2074 : null;

    if (currentData) {
      setElectionData(currentData);
      setPrevElectionData(previousData);
      processElectionData(currentData, previousData);
    }
  }, [electionYear, data2074, data2079, data2082]);

  const processElectionData = (data: ElectionData, prevData: ElectionData | null) => {
    const national = toNationalSummary(data);

    // Compute swing
    const swingMap: globalThis.Map<string, number> = new globalThis.Map();
    if (prevData) {
      const swing = computeSwingData(data, prevData);
      swing.forEach(s => swingMap.set(s.party, s.net));
    }

    // Build party seats
    const partySeats: PartySeat[] = national.party_seats
      .sort((a, b) => b.seats - a.seats)
      .map(p => ({
        party: p.party,
        seats: p.seats,
        leading: p.leading,
        change: swingMap.get(p.party) || 0,
        votePct: p.vote_share_pct,
      }));

    setSummary({
      declared: national.declared,
      counting: national.counting,
      pending: national.pending,
      total: national.total_constituencies,
      turnout: national.turnout_pct,
      partySeats,
      totalVotes: national.total_votes_cast,
    });

    // Swing entries for swing tab
    setSwingData(computeSwingEntries(data, prevData));

    // Close races
    setCloseRaces(computeCloseRaces(data));

    // Anomalies
    setAnomalies(computeAnomalies(data));

    // Incumbency
    setIncumbency(computeIncumbency(data, prevData));

    // Candidates
    setCandidates(extractCandidates(data));
  };

  const handleAddToWatchlist = (constituencyId: string) => {
    const constituency = electionData?.constituencies.find(c => c.constituency_id === constituencyId);
    if (constituency) {
      addToWatchlist({
        id: constituencyId,
        user_id: 'local',
        constituency_id: constituencyId,
        constituency_code: constituencyId,
        constituency_name: constituency.name_en,
        district: constituency.district,
        province: constituency.province,
        alert_level: 'medium',
        is_active: true,
      });
    }
  };

  const handleRemoveFromWatchlist = (constituencyId: string) => {
    removeFromWatchlistStore(constituencyId);
  };

  // Loading state
  if (isLoading) {
    return (
      <Widget id="elections" icon={<Vote size={14} />}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
          <Loader2 size={16} className="animate-spin" />
          <span style={{ marginLeft: 8, fontSize: 12 }}>Loading election data...</span>
        </div>
      </Widget>
    );
  }

  // Error state
  if (error || !summary) {
    return (
      <Widget id="elections" icon={<Vote size={14} />}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center' }}>
          <AlertTriangle size={24} style={{ color: 'var(--status-medium)', marginBottom: 8, opacity: 0.5 }} />
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error || 'No data available'}</div>
        </div>
      </Widget>
    );
  }

  // Header actions
  const headerActions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {/* Year selector */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowYearDropdown(!showYearDropdown)}
          style={{
            padding: '3px 8px',
            fontSize: 9,
            background: 'var(--bg-active)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 3,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {electionYear} BS
          <ChevronDown size={10} />
        </button>
        {showYearDropdown && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 4,
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            minWidth: 100,
          }}>
            {availableYears.map(year => {
              return (
                <button
                  key={year}
                  onClick={() => {
                    setElectionYear(year);
                    setShowYearDropdown(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '6px 12px',
                    fontSize: 10,
                    background: year === electionYear ? 'var(--accent-primary)' : 'transparent',
                    color: year === electionYear ? 'white' : 'var(--text-secondary)',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span>{year} BS</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const isLargeView = ['large', 'hero', 'full', 'command'].includes(size);

  return (
    <Widget
      id="elections"
      icon={<Vote size={14} />}
      actions={headerActions}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Watchlist-only view (hide other tabs + status header for a clean widget) */}

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'results' && (
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: isLargeView ? 'row' : 'column' }}>
              {/* Party standings */}
              <div style={{
                flex: isLargeView ? 2 : 1,
                borderRight: isLargeView ? '1px solid var(--border-subtle)' : 'none',
                overflow: 'auto',
              }}>
                <PartyStandings
                  partySeats={summary.partySeats}
                  showChange={!!prevElectionData}
                  electionYear={electionYear}
                  partyStandings={partyStandings}
                  isPartyWatched={isPartyWatched}
                  onTogglePartyWatch={(party, year) => {
                    if (isPartyWatched(party, year)) removePartyFromWatchlist(party, year);
                    else addPartyToWatchlist(party, year);
                  }}
                />
              </div>

              {/* Right column for large views */}
              {isLargeView && (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  {incumbency && <IncumbencyPanel data={incumbency} />}
                  <CloseRacesPanel races={closeRaces} />
                  <AnomaliesPanel anomalies={anomalies} />
                </div>
              )}

              {/* Inline panels for non-large views */}
              {!isLargeView && (
                <>
                  <CloseRacesPanel races={closeRaces} />
                  <AnomaliesPanel anomalies={anomalies} />
                </>
              )}
            </div>
          )}

          {activeTab === 'swing' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SwingAnalysisTab
                swingData={swingData}
                currentYear={electionYear}
                prevYear={prevYear}
              />
            </div>
          )}

          {activeTab === 'candidates' && (
            <CandidatesTab
              candidates={candidates}
              searchQuery={candidateSearch}
              onSearchChange={setCandidateSearch}
              partyFilter={partyFilter}
              onPartyFilterChange={setPartyFilter}
              parties={parties}
              electionYear={electionYear}
              isCandidateWatched={isCandidateWatched}
              onToggleCandidateWatch={(item, year) => {
                if (isCandidateWatched(item.candidate_id, year)) removeCandidateFromWatchlist(item.candidate_id, year);
                else addCandidateToWatchlist(item);
              }}
            />
          )}

          {activeTab === 'historical' && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <HistoricalTab
                data2074={data2074}
                data2079={data2079}
                data2082={data2082}
              />
            </div>
          )}

          {activeTab === 'watchlist' && (
            <WatchlistTab
              watchlist={storeWatchlist}
              candidateWatchlist={candidateWatchlist}
              partyWatchlist={partyWatchlist}
              partyStandings={partyStandings}
              constituencyIndex={constituencyIndex}
              candidates={candidates}
              constituencies={electionData?.constituencies || []}
              electionYear={electionYear}
              onAddCandidate={addCandidateToWatchlist}
              onRemoveCandidate={removeCandidateFromWatchlist}
              isCandidateWatched={isCandidateWatched}
              onAddParty={addPartyToWatchlist}
              onRemoveParty={removePartyFromWatchlist}
              isPartyWatched={isPartyWatched}
              onAdd={handleAddToWatchlist}
              onRemove={handleRemoveFromWatchlist}
              onOpenCandidate={(candidateId) => navigate(`/dossier/candidate/${candidateId}`)}
              onOpenParty={(party) => navigate(`/elections?party=${encodeURIComponent(party)}`)}
            />
          )}
        </div>
      </div>
    </Widget>
  );
});
