/**
 * Election Monitor Store (Zustand)
 *
 * Manages state for the Election Monitor Dashboard:
 * - Mode (LIVE vs HISTORICAL)
 * - Selected election year
 * - Selected constituency
 * - National summary data
 * - Constituency results map data
 * - Party seat counts
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ElectionAlert, ConstituencyWatchlistItem } from '../api/elections'
import type { Province } from '../data/districts'

export type CandidateWatchItem = {
  candidate_id: string
  election_year: number
  name: string
  party: string
  constituency_id: string
  constituency_name: string
  district: string
  photo_url?: string | null
  added_at: string
}

export type PartyWatchItem = {
  party: string
  election_year: number
  added_at: string
}

export type ElectionMode = 'live' | 'historical'
export type MapColorMode = 'party' | 'anti-incumbency'
export type ElectionMapViewLevel = 'province' | 'district' | 'constituency'

export interface PartyChange {
  candidate_id: string
  name: string
  from_party: string
  to_party: string
  was_elected_2079: boolean
  votes_2079: number
  district: string
  photo_url: string
}

export interface AnomalyFlag {
  constituency_id: string
  constituency_name: string
  district: string
  type: 'high_turnout' | 'low_turnout' | 'lopsided_margin' | 'close_race'
  severity: 'red' | 'amber'
  value: number
  threshold: number
  description: string
}

export interface ConstituencyResult {
  constituency_id: string
  name_en: string
  name_ne?: string
  district: string
  province: string
  province_id: number
  status: 'declared' | 'counting' | 'pending'
  winner_party?: string
  winner_name?: string
  winner_votes?: number
  total_votes?: number
  turnout_pct?: number
  candidates: CandidateResult[]
}

export interface CandidateResult {
  id: string
  name_en: string
  name_ne?: string
  name_en_roman?: string  // Romanized English transliteration
  aliases?: string[]  // Alternative name spellings for search
  party: string
  votes: number
  vote_pct: number
  is_winner: boolean
  photo_url?: string
  age?: number
  gender?: string
  education?: string
  biography?: string  // Short biography
  biography_source?: string  // Source URL for biography
  biography_source_label?: string
  profile_origin?: 'json' | 'override' | 'seed'
  is_notable?: boolean  // Has significant public profile
  linked_entity_id?: string
  entity_link_confidence?: number
  entity_summary?: {
    entity_id: string
    canonical_id: string
    name_en: string
    name_ne?: string
    match_confidence?: number
  }
  previous_positions?: Array<{  // Previous elected positions
    year: number
    constituency: string
    district?: string
    party?: string
    votes?: number
    vote_pct?: number
  }>
}

export interface NationalSummary {
  total_constituencies: number
  declared: number
  counting: number
  pending: number
  turnout_pct: number
  total_votes_cast: number
  total_registered_voters: number
  leading_party: string
  leading_party_seats: number
  party_seats: PartySeatCount[]
  last_updated?: string
}

export interface PartySeatCount {
  party: string
  seats: number
  won: number
  leading: number
  vote_share_pct: number
  prev_seats?: number
}

export interface SwingData {
  party: string
  gained: number
  lost: number
  net: number
}

export interface DemographicData {
  age_groups: Array<{ group: string; registered: number; voted: number }>
  gender: Array<{ gender: string; registered: number; voted: number }>
  urban_rural: Array<{ type: string; turnout_pct: number }>
}

export interface TrendData {
  year: number
  parties: Record<string, number>
}

interface ElectionState {
  // Mode & year
  mode: ElectionMode
  electionYear: number
  availableYears: number[]

  // Selection
  mapViewLevel: ElectionMapViewLevel
  selectedProvince: Province | null
  selectedDistrict: string | null
  selectedConstituencyId: string | null
  pinnedConstituencyId: string | null

  // Data
  nationalSummary: NationalSummary | null
  constituencyResults: Map<string, ConstituencyResult>
  swingData: SwingData[]
  demographics: DemographicData | null
  trendData: TrendData[]

  // Loading states
  isLoading: boolean
  isMapLoading: boolean

  // Live mode
  isLiveConnected: boolean
  lastLiveUpdate: string | null

  // Intelligence features
  partyChanges: PartyChange[]
  anomalyFlags: AnomalyFlag[]
  mapColorMode: MapColorMode
  selectedCandidateId: string | null
  tickerAlerts: ElectionAlert[]
  isTickerConnected: boolean
  antiIncumbencyData: Map<string, { retained: boolean | null }>

  // Watchlist (user-selected constituencies to track)
  watchlist: ConstituencyWatchlistItem[]
  watchlistLoading: boolean
  candidateWatchlist: CandidateWatchItem[]
  partyWatchlist: PartyWatchItem[]

  // Actions
  setMode: (mode: ElectionMode) => void
  setElectionYear: (year: number) => void
  setMapViewLevel: (level: ElectionMapViewLevel) => void
  selectProvince: (province: Province | null) => void
  selectDistrict: (district: string | null) => void
  selectConstituency: (id: string | null) => void
  pinConstituency: (id: string | null) => void
  setNationalSummary: (summary: NationalSummary) => void
  setConstituencyResults: (results: ConstituencyResult[]) => void
  updateConstituencyResult: (result: ConstituencyResult) => void
  setSwingData: (data: SwingData[]) => void
  setDemographics: (data: DemographicData) => void
  setTrendData: (data: TrendData[]) => void
  setLoading: (loading: boolean) => void
  setMapLoading: (loading: boolean) => void
  setLiveConnected: (connected: boolean) => void
  setLastLiveUpdate: (timestamp: string) => void

  // Intelligence actions
  setPartyChanges: (changes: PartyChange[]) => void
  setAnomalyFlags: (flags: AnomalyFlag[]) => void
  setMapColorMode: (mode: MapColorMode) => void
  selectCandidate: (id: string | null, standaloneData?: any) => void
  standaloneCandidateData: any | null
  setTickerAlerts: (alerts: ElectionAlert[]) => void
  addTickerAlert: (alert: ElectionAlert) => void
  setTickerConnected: (connected: boolean) => void
  setAntiIncumbencyData: (data: Map<string, { retained: boolean | null }>) => void

  // Watchlist actions
  setWatchlist: (items: ConstituencyWatchlistItem[]) => void
  addToWatchlist: (item: ConstituencyWatchlistItem) => void
  removeFromWatchlist: (constituencyId: string) => void
  updateWatchlistItem: (item: ConstituencyWatchlistItem) => void
  isOnWatchlist: (constituencyId: string) => boolean
  setWatchlistLoading: (loading: boolean) => void

  // Smart watchlist (candidates + parties)
  addCandidateToWatchlist: (item: CandidateWatchItem) => void
  removeCandidateFromWatchlist: (candidateId: string, electionYear: number) => void
  isCandidateWatched: (candidateId: string, electionYear: number) => boolean
  addPartyToWatchlist: (party: string, electionYear: number) => void
  removePartyFromWatchlist: (party: string, electionYear: number) => void
  isPartyWatched: (party: string, electionYear: number) => boolean
}

export const useElectionStore = create<ElectionState>()(
  persist(
    (set, get) => ({
  // Initial state
  mode: 'live',
  electionYear: 2082,
  availableYears: [2082, 2079, 2074],

  mapViewLevel: 'province',
  selectedProvince: null,
  selectedDistrict: null,
  selectedConstituencyId: null,
  pinnedConstituencyId: null,

  nationalSummary: null,
  constituencyResults: new Map(),
  swingData: [],
  demographics: null,
  trendData: [],

  isLoading: false,
  isMapLoading: false,

  isLiveConnected: false,
  lastLiveUpdate: null,

  // Intelligence features
  partyChanges: [],
  anomalyFlags: [],
  mapColorMode: 'party',
  selectedCandidateId: null,
  standaloneCandidateData: null,
  tickerAlerts: [],
  isTickerConnected: false,
  antiIncumbencyData: new Map(),

  // Watchlist
  watchlist: [],
  watchlistLoading: false,
  candidateWatchlist: [],
  partyWatchlist: [],

  // Actions
  setMode: (mode) => set({ mode }),
  setElectionYear: (year) => set({
    electionYear: year,
    selectedProvince: null,
    selectedDistrict: null,
    selectedConstituencyId: null,
    pinnedConstituencyId: null,
    mapViewLevel: 'province',
  }),
  setMapViewLevel: (level) => set((state) => ({
    mapViewLevel: level,
    pinnedConstituencyId: level === 'constituency' ? state.pinnedConstituencyId : null,
  })),
  selectProvince: (province) => set({ selectedProvince: province, pinnedConstituencyId: null }),
  selectDistrict: (district) => set({ selectedDistrict: district, pinnedConstituencyId: null }),
  selectConstituency: (id) => set({ selectedConstituencyId: id, pinnedConstituencyId: null }),
  pinConstituency: (id) => set({ pinnedConstituencyId: id }),

  setNationalSummary: (summary) => set({ nationalSummary: summary }),

  setConstituencyResults: (results) => {
    const map = new Map<string, ConstituencyResult>()
    for (const r of results) {
      map.set(r.constituency_id, r)
    }
    set({ constituencyResults: map })
  },

  updateConstituencyResult: (result) => set((state) => {
    const newMap = new Map(state.constituencyResults)
    newMap.set(result.constituency_id, result)
    return { constituencyResults: newMap }
  }),

  setSwingData: (data) => set({ swingData: data }),
  setDemographics: (data) => set({ demographics: data }),
  setTrendData: (data) => set({ trendData: data }),
  setLoading: (loading) => set({ isLoading: loading }),
  setMapLoading: (loading) => set({ isMapLoading: loading }),
  setLiveConnected: (connected) => set({ isLiveConnected: connected }),
  setLastLiveUpdate: (timestamp) => set({ lastLiveUpdate: timestamp }),

  // Intelligence actions
  setPartyChanges: (changes) => set({ partyChanges: changes }),
  setAnomalyFlags: (flags) => set({ anomalyFlags: flags }),
  setMapColorMode: (mode) => set({ mapColorMode: mode }),
  selectCandidate: (id, standaloneData) => set({ selectedCandidateId: id, standaloneCandidateData: standaloneData ?? null }),
  setTickerAlerts: (alerts) => set({ tickerAlerts: alerts }),
  addTickerAlert: (alert) => set((state) => ({
    tickerAlerts: [alert, ...state.tickerAlerts].slice(0, 50),
  })),
  setTickerConnected: (connected) => set({ isTickerConnected: connected }),
  setAntiIncumbencyData: (data) => set({ antiIncumbencyData: data }),

  // Watchlist actions
  setWatchlist: (items) => set({ watchlist: items }),
  addToWatchlist: (item) => set((state) => ({
    watchlist: [...state.watchlist.filter(w => w.constituency_id !== item.constituency_id), item],
  })),
  removeFromWatchlist: (constituencyId) => set((state) => ({
    watchlist: state.watchlist.filter(w => w.constituency_id !== constituencyId),
  })),
  updateWatchlistItem: (item) => set((state) => ({
    watchlist: state.watchlist.map(w =>
      w.constituency_id === item.constituency_id ? item : w
    ),
  })),
  isOnWatchlist: (constituencyId) =>
    get().watchlist.some(w => w.constituency_id === constituencyId),
  setWatchlistLoading: (loading) => set({ watchlistLoading: loading }),

  addCandidateToWatchlist: (item) => set((state) => ({
    candidateWatchlist: [
      ...state.candidateWatchlist.filter(
        (x) => !(x.candidate_id === item.candidate_id && x.election_year === item.election_year)
      ),
      item,
    ],
  })),
  removeCandidateFromWatchlist: (candidateId, electionYear) => set((state) => ({
    candidateWatchlist: state.candidateWatchlist.filter(
      (x) => !(x.candidate_id === candidateId && x.election_year === electionYear)
    ),
  })),
  isCandidateWatched: (candidateId, electionYear) =>
    get().candidateWatchlist.some((x) => x.candidate_id === candidateId && x.election_year === electionYear),

  addPartyToWatchlist: (party, electionYear) => set((state) => ({
    partyWatchlist: [
      ...state.partyWatchlist.filter((x) => !(x.party === party && x.election_year === electionYear)),
      { party, election_year: electionYear, added_at: new Date().toISOString() },
    ],
  })),
  removePartyFromWatchlist: (party, electionYear) => set((state) => ({
    partyWatchlist: state.partyWatchlist.filter((x) => !(x.party === party && x.election_year === electionYear)),
  })),
  isPartyWatched: (party, electionYear) =>
    get().partyWatchlist.some((x) => x.party === party && x.election_year === electionYear),
    }),
    {
      name: 'nepal-osint-election-monitor',
      version: 2,
      migrate: (persistedState: any, version: number) => {
        if (!persistedState) return persistedState
        if (version < 2) {
          return {
            ...persistedState,
            candidateWatchlist: persistedState.candidateWatchlist ?? [],
            partyWatchlist: persistedState.partyWatchlist ?? [],
          }
        }
        return persistedState
      },
      partialize: (state) => ({
        mode: state.mode,
        electionYear: state.electionYear,
        mapViewLevel: state.mapViewLevel,
        mapColorMode: state.mapColorMode,
        watchlist: state.watchlist,
        candidateWatchlist: state.candidateWatchlist,
        partyWatchlist: state.partyWatchlist,
      }),
    }
  )
)
