/**
 * Election Data Loader
 *
 * Loads election data via unified backend snapshot (when feature-flagged),
 * with fallback to static ECN JSON files.
 *
 * Available years:
 * - 2079 BS (2022 AD): Complete results (165 constituencies, 2411 candidates)
 * - 2082 BS (2025 AD): Nominations only (results pending)
 */

import type { ConstituencyResult, NationalSummary, SwingData, DemographicData, TrendData } from '../../stores/electionStore'
import { fetchElectionSnapshot, type ElectionSnapshotResponse } from '../../api/elections'

export interface ElectionData {
  election_year: number
  total_constituencies: number
  results: RawConstituencyResult[]
  constituencies: RawConstituencyResult[] // Alias for components using this name
  national_summary: RawNationalSummary
}

// Keep RawElectionData as internal alias
type RawElectionData = ElectionData

export interface RawConstituencyResult {
  constituency_id: string
  name_en: string
  name_ne: string
  district: string
  province: string
  province_id: number
  status: 'declared' | 'counting' | 'pending'
  winner_party: string | null
  winner_name: string | null
  winner_votes: number | null
  total_votes: number
  turnout_pct: number | null
  last_updated: string | null
  candidates: RawCandidate[]
}

export interface RawCandidate {
  id: string
  name_en: string
  name_ne?: string
  name_en_roman?: string  // Romanized English transliteration
  aliases?: string[]  // Alternative names for search (e.g., "KP Oli", "Prachanda")
  party: string
  party_ne?: string
  votes: number
  vote_pct: number
  is_winner: boolean
  photo_url: string | null
  age?: number | null
  gender?: string
  education?: string
  biography?: string
  biography_source?: string
  biography_source_label?: string
  profile_origin?: 'json' | 'override' | 'seed'
  is_notable?: boolean
  linked_entity_id?: string
  entity_link_confidence?: number
  entity_summary?: {
    entity_id: string
    canonical_id: string
    name_en: string
    name_ne?: string
    match_confidence?: number
  }
}

interface RawNationalSummary {
  total_constituencies: number
  declared: number
  counting: number
  pending: number
  turnout_pct: number
  total_votes_cast: number
  total_registered_voters: number
  leading_party: string
  leading_party_seats: number
  party_seats: Array<{ party: string; seats: number; won?: number; leading?: number; vote_share: number }>
}

interface PartyChange {
  candidate_id: string
  name: string
  from_party: string
  to_party: string
  was_elected_2079: boolean
  votes_2079: number
  district: string
  photo_url: string
}

// Cache loaded data
const dataCache: Map<string, RawElectionData> = new Map()
const partyChangesCache: Map<string, PartyChange[]> = new Map()
const UNIFIED_CANDIDATE_ENABLED =
  String(import.meta.env.VITE_FEATURE_UNIFIED_CANDIDATE ?? 'false').toLowerCase() === 'true'

function normalizeSnapshotToElectionData(snapshot: ElectionSnapshotResponse): ElectionData {
  const results = snapshot.results.map((item) => ({
    constituency_id: item.constituency_id,
    name_en: item.name_en,
    name_ne: item.name_ne || '',
    district: item.district,
    province: item.province,
    province_id: item.province_id,
    status: item.status,
    winner_party: item.winner_party || null,
    winner_name: item.winner_name || null,
    winner_votes: item.winner_votes ?? null,
    total_votes: item.total_votes || 0,
    turnout_pct: item.turnout_pct ?? null,
    last_updated: item.last_updated || null,
    candidates: item.candidates.map((candidate) => ({
      id: candidate.external_id || candidate.id,
      name_en: candidate.name_en,
      name_ne: candidate.name_ne,
      name_en_roman: candidate.name_en_roman,
      aliases: candidate.aliases,
      party: candidate.party,
      party_ne: candidate.party_ne,
      votes: candidate.votes,
      vote_pct: candidate.vote_pct,
      is_winner: candidate.is_winner,
      photo_url: candidate.photo_url || null,
      age: candidate.age ?? null,
      gender: candidate.gender,
      education: candidate.education,
      biography: candidate.biography,
      biography_source: candidate.biography_source,
      biography_source_label: candidate.biography_source_label,
      profile_origin: candidate.profile_origin,
      is_notable: candidate.is_notable,
      linked_entity_id: candidate.linked_entity_id,
      entity_link_confidence: candidate.entity_link_confidence,
      entity_summary: candidate.entity_summary,
    })),
  }))

  const summary = snapshot.national_summary
  const declared = summary?.declared ?? results.filter((r) => r.status === 'declared').length
  const counting = summary?.counting ?? results.filter((r) => r.status === 'counting').length
  const pending = summary?.pending ?? Math.max(0, results.length - declared - counting)
  const partySeats = summary?.party_seats || []

  return {
    election_year: snapshot.election_year,
    total_constituencies: snapshot.total_constituencies || results.length,
    results,
    constituencies: results,
    national_summary: {
      total_constituencies: snapshot.total_constituencies || results.length,
      declared,
      counting,
      pending,
      turnout_pct: summary?.turnout_pct ?? 0,
      total_votes_cast: summary?.total_votes_cast ?? results.reduce((acc, r) => acc + (r.total_votes || 0), 0),
      total_registered_voters: summary?.total_registered_voters ?? 0,
      leading_party: summary?.leading_party || '',
      leading_party_seats: summary?.leading_party_seats || 0,
      party_seats: partySeats.map((p: any) => ({
        party: p.party,
        seats: p.seats,
        won: p.won ?? p.seats,
        leading: p.leading ?? 0,
        vote_share: 0,
      })),
    },
  }
}

/**
 * Load election data for a given year.
 * In unified mode: API snapshot first.
 * Fallback: static JSON sourced from ECN's public API.
 */
// Live data cache with TTL for 2082
const liveCacheTTL = 30_000 // 30 seconds
const liveCacheTimestamp = new Map<string, number>()

export async function loadElectionData(year: number): Promise<RawElectionData | null> {
  const cacheKey = `${year}:${UNIFIED_CANDIDATE_ENABLED ? 'unified' : 'json'}`

  // For 2082 live data, respect TTL so we get fresh counts
  if (year === 2082) {
    const cachedTs = liveCacheTimestamp.get(cacheKey) || 0
    if (dataCache.has(cacheKey) && Date.now() - cachedTs < liveCacheTTL) {
      return dataCache.get(cacheKey)!
    }
  } else if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey)!
  }

  const availableYears = [2074, 2079, 2082]
  if (!availableYears.includes(year)) {
    console.warn(`[ElectionDataLoader] No data available for year ${year}`)
    return null
  }

  // 2082: fetch live snapshot from backend API
  if (year === 2082) {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/v1/election-results/live-snapshot', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-cache',
      })
      if (response.ok) {
        const rawData = await response.json()
        const data: ElectionData = {
          ...rawData,
          constituencies: rawData.results,
        }
        dataCache.set(cacheKey, data)
        liveCacheTimestamp.set(cacheKey, Date.now())
        console.info(`[ElectionDataLoader] Live 2082: ${rawData.national_summary?.declared || 0} declared, ${rawData.national_summary?.counting || 0} counting`)
        return data
      }
      console.warn(`[ElectionDataLoader] Live API returned ${response.status}, falling back to static JSON`)
    } catch (err) {
      console.warn('[ElectionDataLoader] Live API unavailable, falling back to static JSON', err)
    }
  }

  if (UNIFIED_CANDIDATE_ENABLED) {
    try {
      const snapshot = await fetchElectionSnapshot(year)
      const data = normalizeSnapshotToElectionData(snapshot)
      dataCache.set(cacheKey, data)
      return data
    } catch (err) {
      console.warn(
        `[ElectionDataLoader] Snapshot API unavailable for year ${year}, falling back to local JSON.`,
        err,
      )
    }
  }

  try {
    const response = await fetch(`/data/election-results-${year}.json`, {
      cache: 'no-cache',
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const rawData = await response.json()
    // Add constituencies alias for components that use that property name
    const data: ElectionData = {
      ...rawData,
      constituencies: rawData.results,
    }
    dataCache.set(cacheKey, data)
    return data
  } catch (err) {
    console.error(`[ElectionDataLoader] Failed to load data for year ${year}:`, err)
    return null
  }
}

/**
 * Load party change data (candidates who switched parties between elections).
 * @param fromYear - The previous election year
 * @param toYear - The current election year
 */
export async function loadPartyChanges(fromYear: number = 2079, toYear: number = 2082): Promise<PartyChange[]> {
  const cacheKey = `${fromYear}-${toYear}`
  if (partyChangesCache.has(cacheKey)) return partyChangesCache.get(cacheKey)!

  try {
    const response = await fetch(`/data/party-changes-${fromYear}-${toYear}.json`, {
      cache: 'no-cache',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: PartyChange[] = await response.json()
    partyChangesCache.set(cacheKey, data)
    return data
  } catch (err) {
    console.error(`[ElectionDataLoader] Failed to load party changes ${fromYear}-${toYear}:`, err)
    return []
  }
}

/**
 * Convert raw election data to store-compatible ConstituencyResult format.
 */
export function toConstituencyResults(data: RawElectionData): ConstituencyResult[] {
  return data.results.map(r => ({
    constituency_id: r.constituency_id,
    name_en: r.name_en,
    name_ne: r.name_ne,
    district: r.district,
    province: r.province,
    province_id: r.province_id,
    status: r.status,
    winner_party: r.winner_party || undefined,
    winner_name: r.winner_name || undefined,
    winner_votes: r.winner_votes || undefined,
    total_votes: r.total_votes,
    turnout_pct: r.turnout_pct || undefined,
    candidates: r.candidates.map(c => ({
      id: c.id,
      name_en: c.name_en,
      name_ne: c.name_ne,
      party: c.party,
      votes: c.votes,
      vote_pct: c.vote_pct,
      is_winner: c.is_winner,
      photo_url: c.photo_url || undefined,
      education: c.education,
    })),
  }))
}

/**
 * Convert raw national summary to store format.
 */
export function toNationalSummary(data: RawElectionData): NationalSummary {
  const s = data.national_summary
  return {
    total_constituencies: s.total_constituencies,
    declared: s.declared,
    counting: s.counting,
    pending: s.pending,
    turnout_pct: s.turnout_pct,
    total_votes_cast: s.total_votes_cast,
    total_registered_voters: s.total_registered_voters || s.total_votes_cast,
    leading_party: s.leading_party,
    leading_party_seats: s.leading_party_seats,
    party_seats: s.party_seats.map(p => ({
      party: p.party,
      seats: p.seats,
      won: p.won ?? p.seats,
      leading: p.leading ?? 0,
      vote_share_pct: p.vote_share ?? 0,
    })),
  }
}

/**
 * Compute swing data between two election years.
 * Compares seat changes per party between elections.
 */
export function computeSwingData(
  currentData: RawElectionData,
  previousData: RawElectionData | null
): SwingData[] {
  if (!previousData) return []

  const currentSeats: Record<string, number> = {}
  const previousSeats: Record<string, number> = {}

  for (const r of currentData.results) {
    if (r.winner_party) {
      currentSeats[r.winner_party] = (currentSeats[r.winner_party] || 0) + 1
    }
  }
  for (const r of previousData.results) {
    if (r.winner_party) {
      previousSeats[r.winner_party] = (previousSeats[r.winner_party] || 0) + 1
    }
  }

  const allParties = new Set([...Object.keys(currentSeats), ...Object.keys(previousSeats)])
  const swingData: SwingData[] = []

  for (const party of allParties) {
    const curr = currentSeats[party] || 0
    const prev = previousSeats[party] || 0
    const gained = Math.max(0, curr - prev)
    const lost = Math.max(0, prev - curr)
    const net = curr - prev

    if (gained > 0 || lost > 0) {
      swingData.push({ party, gained, lost, net })
    }
  }

  return swingData.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
}

/**
 * Generate demographic data from constituency results.
 */
export function computeDemographics(data: RawElectionData): DemographicData {
  let maleWinners = 0
  let femaleWinners = 0
  const ageGroups: Record<string, number> = { '25-34': 0, '35-44': 0, '45-54': 0, '55-64': 0, '65+': 0 }

  for (const r of data.results) {
    for (const c of r.candidates) {
      if (c.is_winner && c.gender) {
        if (c.gender === 'पुरुष' || c.gender === 'Male') maleWinners++
        if (c.gender === 'महिला' || c.gender === 'Female') femaleWinners++
      }
      if (c.is_winner && c.age) {
        if (c.age >= 65) ageGroups['65+']++
        else if (c.age >= 55) ageGroups['55-64']++
        else if (c.age >= 45) ageGroups['45-54']++
        else if (c.age >= 35) ageGroups['35-44']++
        else ageGroups['25-34']++
      }
    }
  }

  const totalWinners = Math.max(maleWinners + femaleWinners, 1)

  return {
    age_groups: Object.entries(ageGroups).map(([group, count]) => ({
      group,
      registered: Math.round(count * 1.5),
      voted: count,
    })),
    gender: [
      { gender: 'Male', registered: Math.round(maleWinners * 1.2), voted: maleWinners },
      { gender: 'Female', registered: Math.round(femaleWinners * 1.5), voted: femaleWinners },
    ],
    urban_rural: [
      { type: 'Urban', turnout_pct: maleWinners / totalWinners * 100 },
      { type: 'Rural', turnout_pct: femaleWinners / totalWinners * 100 },
    ],
  }
}

/**
 * Generate trend data (multi-year comparison).
 * Only 2079 has real data; others use proportional estimates from seat counts.
 */
export function computeTrendData(): TrendData[] {
  // Based on actual historical results (seats won in FPTP)
  // Keys use abbreviations to match TrendLineChart MAJOR_PARTIES
  return [
    { year: 2074, parties: { 'UML': 80, 'NC': 23, 'Maoist': 36, 'RSP': 0, 'RPP': 1, 'JSP': 0 } },
    { year: 2079, parties: { 'UML': 44, 'NC': 57, 'Maoist': 18, 'RSP': 7, 'RPP': 7, 'JSP': 7 } },
  ]
}

/**
 * Compute anti-incumbency data by comparing winners between two elections.
 * For each constituency, determines if the incumbent (2079 winner) retained the seat in 2082.
 */
export function computeAntiIncumbency(
  data2079: RawElectionData,
  data2082: RawElectionData
): Map<string, { retained: boolean | null }> {
  const result = new Map<string, { retained: boolean | null }>()

  // Build a map of 2079 winners by constituency_id
  const winners2079 = new Map<string, string>()
  for (const r of data2079.results) {
    if (r.status === 'declared' && r.winner_name) {
      winners2079.set(r.constituency_id, r.winner_name)
    }
  }

  // Compare with 2082 winners
  for (const r of data2082.results) {
    const prev = winners2079.get(r.constituency_id)
    if (!prev) {
      result.set(r.constituency_id, { retained: null })
      continue
    }

    if (r.status === 'declared' && r.winner_name) {
      // Normalize names for comparison (trim, lowercase)
      const prevNorm = prev.trim().toLowerCase()
      const currNorm = r.winner_name.trim().toLowerCase()
      result.set(r.constituency_id, { retained: prevNorm === currNorm })
    } else {
      // Not yet declared
      result.set(r.constituency_id, { retained: null })
    }
  }

  return result
}
