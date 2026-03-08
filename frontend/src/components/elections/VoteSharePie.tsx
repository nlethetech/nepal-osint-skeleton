import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useElectionStore } from '../../stores/electionStore'
import { getPartyColor } from './partyColors'

export function VoteSharePie() {
  const { nationalSummary } = useElectionStore()

  if (!nationalSummary || nationalSummary.party_seats.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-osint-muted">Vote Share - No data</span>
      </div>
    )
  }

  const data = nationalSummary.party_seats
    .filter(p => p.vote_share_pct > 0)
    .sort((a, b) => b.vote_share_pct - a.vote_share_pct)
    .slice(0, 7)
    .map(p => ({
      name: p.party,
      value: p.vote_share_pct,
    }))

  // Add "Others" if there are remaining parties
  const shownPct = data.reduce((sum, d) => sum + d.value, 0)
  if (shownPct < 100) {
    data.push({ name: 'Others', value: +(100 - shownPct).toFixed(1) })
  }

  return (
    <div className="h-full flex flex-col">
      <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">National Vote Share</div>
      <div className="flex-1 min-h-0 flex items-center">
        <div className="w-1/2 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={getPartyColor(entry.name)} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '11px' }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Vote Share']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="w-1/2 space-y-1">
          {data.slice(0, 6).map(d => (
            <div key={d.name} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getPartyColor(d.name) }} />
              <span className="text-[10px] text-osint-text-secondary truncate">{d.name}</span>
              <span className="text-[10px] text-osint-muted ml-auto">{d.value.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
