/**
 * ProvinceRollup - Province summary analytics tab
 *
 * Aggregates constituency results by province_id (7 provinces).
 * Shows declared/total, leading party, inline stacked bar of seat distribution.
 */

import { useMemo } from 'react'
import { useElectionStore } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'

interface ProvinceAggregate {
  province_id: number
  province_name: string
  total_constituencies: number
  declared: number
  total_votes: number
  turnout_pct: number | null
  parties: Record<string, number>  // party → seats
  leading_party: string | null
}

const PROVINCE_NAMES: Record<number, string> = {
  1: 'Koshi',
  2: 'Madhesh',
  3: 'Bagmati',
  4: 'Gandaki',
  5: 'Lumbini',
  6: 'Karnali',
  7: 'Sudurpashchim',
}

export function ProvinceRollup() {
  const { constituencyResults } = useElectionStore()

  const provinces = useMemo(() => {
    const aggregates = new Map<number, ProvinceAggregate>()

    for (const [, result] of constituencyResults) {
      const pid = result.province_id
      if (!pid) continue

      if (!aggregates.has(pid)) {
        aggregates.set(pid, {
          province_id: pid,
          province_name: PROVINCE_NAMES[pid] || result.province || `Province ${pid}`,
          total_constituencies: 0,
          declared: 0,
          total_votes: 0,
          turnout_pct: null,
          parties: {},
          leading_party: null,
        })
      }

      const agg = aggregates.get(pid)!
      agg.total_constituencies++
      agg.total_votes += result.total_votes || 0

      if (result.status === 'declared') {
        agg.declared++
        if (result.winner_party) {
          agg.parties[result.winner_party] = (agg.parties[result.winner_party] || 0) + 1
        }
      }

      if (result.turnout_pct != null) {
        agg.turnout_pct = agg.turnout_pct != null
          ? (agg.turnout_pct * (agg.total_constituencies - 1) + result.turnout_pct) / agg.total_constituencies
          : result.turnout_pct
      }
    }

    // Determine leading party per province
    for (const agg of aggregates.values()) {
      let maxSeats = 0
      for (const [party, seats] of Object.entries(agg.parties)) {
        if (seats > maxSeats) {
          maxSeats = seats
          agg.leading_party = party
        }
      }
    }

    return [...aggregates.values()].sort((a, b) => a.province_id - b.province_id)
  }, [constituencyResults])

  if (provinces.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[10px] text-osint-muted">No province data available</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 overflow-y-auto max-h-full">
      {provinces.map(prov => (
        <ProvinceCard key={prov.province_id} province={prov} />
      ))}
    </div>
  )
}

function ProvinceCard({ province }: { province: ProvinceAggregate }) {
  const totalDeclared = province.declared
  const partyEntries = Object.entries(province.parties).sort((a, b) => b[1] - a[1])

  return (
    <div className="bg-osint-surface/30 border border-osint-border/50 rounded-lg p-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-osint-text">{province.province_name}</span>
          {province.leading_party && (
            <span
              className="text-[8px] px-1 py-0.5 rounded"
              style={{
                backgroundColor: `${getPartyColor(province.leading_party)}20`,
                color: getPartyColor(province.leading_party),
              }}
            >
              {province.leading_party}
            </span>
          )}
        </div>
        <span className="text-[9px] text-osint-muted tabular-nums">
          {totalDeclared}/{province.total_constituencies}
        </span>
      </div>

      {/* Stacked bar */}
      {totalDeclared > 0 && (
        <div className="h-2 rounded-full overflow-hidden flex bg-osint-bg/50 mb-1">
          {partyEntries.map(([party, seats]) => (
            <div
              key={party}
              className="h-full"
              style={{
                width: `${(seats / province.total_constituencies) * 100}%`,
                backgroundColor: getPartyColor(party),
                opacity: 0.8,
              }}
              title={`${party}: ${seats} seats`}
            />
          ))}
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-2 text-[9px] text-osint-muted">
        <span>{province.total_votes.toLocaleString()} votes</span>
        {province.turnout_pct != null && (
          <span>{province.turnout_pct.toFixed(1)}% turnout</span>
        )}
      </div>
    </div>
  )
}
