/**
 * Anomaly Detection Utilities
 *
 * Pure functions to detect statistical anomalies in election results:
 * - High/low turnout (std dev based)
 * - Lopsided margins (winner vote share thresholds)
 * - Close races (margin thresholds)
 */

import type { ConstituencyResult } from '../../stores/electionStore'
import type { AnomalyFlag } from '../../stores/electionStore'

export function computeAnomalies(results: ConstituencyResult[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = []

  // Only consider declared constituencies with turnout data
  const declared = results.filter(r => r.status === 'declared' && r.turnout_pct != null)
  if (declared.length < 5) return flags

  // Compute turnout stats
  const turnouts = declared.map(r => r.turnout_pct!)
  const mean = turnouts.reduce((a, b) => a + b, 0) / turnouts.length
  const variance = turnouts.reduce((a, b) => a + (b - mean) ** 2, 0) / turnouts.length
  const stdDev = Math.sqrt(variance)

  for (const r of declared) {
    // Turnout anomalies
    if (r.turnout_pct != null && stdDev > 0) {
      const zScore = (r.turnout_pct - mean) / stdDev

      if (zScore > 3) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'high_turnout',
          severity: 'red',
          value: r.turnout_pct,
          threshold: mean + 3 * stdDev,
          description: `Turnout ${r.turnout_pct.toFixed(1)}% is >3σ above mean (${mean.toFixed(1)}%)`,
        })
      } else if (zScore > 2) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'high_turnout',
          severity: 'amber',
          value: r.turnout_pct,
          threshold: mean + 2 * stdDev,
          description: `Turnout ${r.turnout_pct.toFixed(1)}% is >2σ above mean (${mean.toFixed(1)}%)`,
        })
      } else if (zScore < -2) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'low_turnout',
          severity: 'amber',
          value: r.turnout_pct,
          threshold: mean - 2 * stdDev,
          description: `Turnout ${r.turnout_pct.toFixed(1)}% is >2σ below mean (${mean.toFixed(1)}%)`,
        })
      }
    }

    // Margin anomalies (require candidates with votes)
    if (r.candidates.length >= 2) {
      const sorted = [...r.candidates].sort((a, b) => b.votes - a.votes)
      const winnerPct = sorted[0].vote_pct
      const totalVotes = r.total_votes || sorted.reduce((s, c) => s + c.votes, 0)
      const margin = totalVotes > 0
        ? ((sorted[0].votes - sorted[1].votes) / totalVotes) * 100
        : 0

      // Lopsided margin
      if (winnerPct > 85) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'lopsided_margin',
          severity: 'red',
          value: winnerPct,
          threshold: 85,
          description: `Winner secured ${winnerPct.toFixed(1)}% of votes (>85% threshold)`,
        })
      } else if (winnerPct > 70) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'lopsided_margin',
          severity: 'amber',
          value: winnerPct,
          threshold: 70,
          description: `Winner secured ${winnerPct.toFixed(1)}% of votes (>70% threshold)`,
        })
      }

      // Close race
      if (margin < 0.5 && margin >= 0) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'close_race',
          severity: 'red',
          value: margin,
          threshold: 0.5,
          description: `Margin of only ${margin.toFixed(2)}% between top 2 candidates`,
        })
      } else if (margin < 2) {
        flags.push({
          constituency_id: r.constituency_id,
          constituency_name: r.name_en,
          district: r.district,
          type: 'close_race',
          severity: 'amber',
          value: margin,
          threshold: 2,
          description: `Tight race with ${margin.toFixed(2)}% margin between top 2`,
        })
      }
    }
  }

  // Sort: red first, then amber; within same severity by value distance from threshold
  return flags.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'red' ? -1 : 1
    return Math.abs(b.value - b.threshold) - Math.abs(a.value - a.threshold)
  })
}
