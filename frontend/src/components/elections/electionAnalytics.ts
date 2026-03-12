import type { ElectionData, RawCandidate, RawConstituencyResult } from './electionDataLoader';
import type { Province } from '../../data/districts';

export type MarginInfo = {
  constituencyId: string;
  marginVotes: number | null;
  marginPct: number | null;
  totalVotes: number;
  winner: RawCandidate | null;
  runnerUp: RawCandidate | null;
};

export function computeMarginsByConstituency(data: ElectionData): Map<string, MarginInfo> {
  const out = new Map<string, MarginInfo>();
  for (const c of data.constituencies) {
    const candidates = [...(c.candidates || [])].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const winner = candidates.find(x => x.is_winner) || candidates[0] || null;
    const runnerUp = candidates.length >= 2 ? candidates[1] : null;
    const totalVotes = typeof c.total_votes === 'number' ? c.total_votes : candidates.reduce((s, x) => s + (x.votes || 0), 0);
    const marginVotes = candidates.length >= 2 ? (candidates[0].votes - candidates[1].votes) : null;
    const marginPct = marginVotes !== null && totalVotes > 0 ? (marginVotes / totalVotes) * 100 : null;
    out.set(c.constituency_id, { constituencyId: c.constituency_id, marginVotes, marginPct, totalVotes, winner, runnerUp });
  }
  return out;
}

export type CloseRace = {
  constituencyId: string;
  name: string;
  district: string;
  province: Province | string;
  winnerParty: string;
  winnerName: string;
  winnerVotes: number;
  runnerUpParty: string;
  runnerUpName: string;
  runnerUpVotes: number;
  marginVotes: number;
  marginPct: number;
  totalVotes: number;
};

export function computeCloseRaces(data: ElectionData, thresholdPct: number = 5): CloseRace[] {
  const races: CloseRace[] = [];
  for (const c of data.constituencies) {
    if (c.status !== 'declared' || (c.candidates || []).length < 2) continue;
    const sorted = [...c.candidates].sort((a, b) => b.votes - a.votes);
    const winner = sorted[0];
    const runnerUp = sorted[1];
    const marginVotes = winner.votes - runnerUp.votes;
    const totalVotes = c.total_votes > 0 ? c.total_votes : sorted.reduce((s, x) => s + x.votes, 0);
    const marginPct = totalVotes > 0 ? (marginVotes / totalVotes) * 100 : 0;
    if (marginPct < thresholdPct) {
      races.push({
        constituencyId: c.constituency_id,
        name: c.name_en,
        district: c.district,
        province: c.province,
        winnerParty: winner.party,
        winnerName: winner.name_en,
        winnerVotes: winner.votes,
        runnerUpParty: runnerUp.party,
        runnerUpName: runnerUp.name_en,
        runnerUpVotes: runnerUp.votes,
        marginVotes,
        marginPct,
        totalVotes,
      });
    }
  }
  return races.sort((a, b) => a.marginPct - b.marginPct);
}

export type TurnoutAnomalyType = 'high_turnout' | 'low_turnout' | 'lopsided_margin';
export type TurnoutAnomaly = {
  constituencyId: string;
  name: string;
  district: string;
  province: Province | string;
  type: TurnoutAnomalyType;
  severity: 'red' | 'amber';
  value: number;
  description: string;
};

export function computeTurnoutAnomalies(data: ElectionData, high: number = 85, low: number = 40, winnerPct: number = 70): TurnoutAnomaly[] {
  const anomalies: TurnoutAnomaly[] = [];
  for (const c of data.constituencies) {
    if (c.status !== 'declared') continue;
    const turnout = c.turnout_pct || 0;
    if (turnout > high) {
      anomalies.push({
        constituencyId: c.constituency_id,
        name: c.name_en,
        district: c.district,
        province: c.province,
        type: 'high_turnout',
        severity: turnout > 95 ? 'red' : 'amber',
        value: turnout,
        description: `Turnout ${turnout.toFixed(1)}% - unusually high`,
      });
    }
    if (turnout > 0 && turnout < low) {
      anomalies.push({
        constituencyId: c.constituency_id,
        name: c.name_en,
        district: c.district,
        province: c.province,
        type: 'low_turnout',
        severity: turnout < 30 ? 'red' : 'amber',
        value: turnout,
        description: `Turnout ${turnout.toFixed(1)}% - below average`,
      });
    }

    const sorted = [...(c.candidates || [])].sort((a, b) => b.votes - a.votes);
    const winner = sorted[0];
    if (winner && winner.vote_pct > winnerPct) {
      anomalies.push({
        constituencyId: c.constituency_id,
        name: c.name_en,
        district: c.district,
        province: c.province,
        type: 'lopsided_margin',
        severity: winner.vote_pct > 85 ? 'red' : 'amber',
        value: winner.vote_pct,
        description: `Winner has ${winner.vote_pct.toFixed(1)}% - landslide`,
      });
    }
  }
  return anomalies;
}

export type Landslide = {
  constituencyId: string;
  name: string;
  district: string;
  province: Province | string;
  winnerParty: string;
  winnerName: string;
  winnerPct: number;
};

export function computeLandslides(data: ElectionData, winnerPct: number = 70): Landslide[] {
  const out: Landslide[] = [];
  for (const c of data.constituencies) {
    if (c.status !== 'declared') continue;
    const sorted = [...(c.candidates || [])].sort((a, b) => b.votes - a.votes);
    const winner = sorted[0];
    if (!winner) continue;
    if (winner.vote_pct >= winnerPct) {
      out.push({
        constituencyId: c.constituency_id,
        name: c.name_en,
        district: c.district,
        province: c.province,
        winnerParty: winner.party,
        winnerName: winner.name_en,
        winnerPct: winner.vote_pct,
      });
    }
  }
  return out.sort((a, b) => b.winnerPct - a.winnerPct);
}

export type IncumbencyMajorLoss = {
  constituencyId: string;
  constituency: string;
  district: string;
  province: Province | string;
  prevParty: string;
  newParty: string;
  prevWinnerName: string;
  newWinnerName: string;
  marginVotes: number;
};

export type IncumbencyResult = {
  retained: number;
  lost: number;
  total: number;
  retentionRate: number;
  majorLosses: IncumbencyMajorLoss[];
  partyRetention: Array<{ party: string; retained: number; lost: number; rate: number }>;
};

export function computeIncumbency(currentData: ElectionData, prevData: ElectionData): IncumbencyResult {
  const prevWinners = new Map<string, { party: string; name: string }>();
  for (const c of prevData.constituencies) {
    const winner = c.candidates.find((x: RawCandidate) => x.is_winner);
    if (winner) prevWinners.set(c.constituency_id, { party: winner.party, name: winner.name_en });
  }

  let retained = 0;
  let lost = 0;
  const majorLosses: IncumbencyMajorLoss[] = [];
  const partyStats = new Map<string, { retained: number; lost: number }>();

  for (const c of currentData.constituencies) {
    if (c.status !== 'declared') continue;
    const prev = prevWinners.get(c.constituency_id);
    if (!prev) continue;
    const currentWinner = c.candidates.find((x: RawCandidate) => x.is_winner);
    if (!currentWinner) continue;

    if (!partyStats.has(prev.party)) partyStats.set(prev.party, { retained: 0, lost: 0 });

    if (currentWinner.party === prev.party) {
      retained++;
      partyStats.get(prev.party)!.retained++;
    } else {
      lost++;
      partyStats.get(prev.party)!.lost++;
      const sorted = [...c.candidates].sort((a, b) => b.votes - a.votes);
      const marginVotes = sorted.length >= 2 ? sorted[0].votes - sorted[1].votes : 0;
      majorLosses.push({
        constituencyId: c.constituency_id,
        constituency: c.name_en,
        district: c.district,
        province: c.province,
        prevParty: prev.party,
        newParty: currentWinner.party,
        prevWinnerName: prev.name,
        newWinnerName: currentWinner.name_en,
        marginVotes,
      });
    }
  }

  const total = retained + lost;
  const retentionRate = total > 0 ? (retained / total) * 100 : 0;
  const partyRetention = Array.from(partyStats.entries())
    .map(([party, stats]) => ({
      party,
      retained: stats.retained,
      lost: stats.lost,
      rate: (stats.retained + stats.lost) > 0 ? (stats.retained / (stats.retained + stats.lost)) * 100 : 0,
    }))
    .sort((a, b) => (b.retained + b.lost) - (a.retained + a.lost));

  return {
    retained,
    lost,
    total,
    retentionRate,
    majorLosses: majorLosses.sort((a, b) => b.marginVotes - a.marginVotes),
    partyRetention,
  };
}

export type SwingEntry = {
  party: string;
  gained: number;
  lost: number;
  net: number;
  currentSeats: number;
  previousSeats: number;
};

export function computeSwing(currentData: ElectionData, previousData: ElectionData): SwingEntry[] {
  const currentSeats: Record<string, number> = {};
  const previousSeats: Record<string, number> = {};

  for (const r of currentData.constituencies) {
    if (r.winner_party) currentSeats[r.winner_party] = (currentSeats[r.winner_party] || 0) + 1;
  }
  for (const r of previousData.constituencies) {
    if (r.winner_party) previousSeats[r.winner_party] = (previousSeats[r.winner_party] || 0) + 1;
  }

  const allParties = new Set([...Object.keys(currentSeats), ...Object.keys(previousSeats)]);
  const swing: SwingEntry[] = [];
  for (const party of allParties) {
    const curr = currentSeats[party] || 0;
    const prev = previousSeats[party] || 0;
    const gained = Math.max(0, curr - prev);
    const lost = Math.max(0, prev - curr);
    const net = curr - prev;
    if (gained > 0 || lost > 0) {
      swing.push({ party, gained, lost, net, currentSeats: curr, previousSeats: prev });
    }
  }
  return swing.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

