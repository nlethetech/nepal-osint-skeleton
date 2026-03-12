import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useElectionStore } from '../../stores/electionStore'
import { PARTY_COLORS } from './partyColors'

const MAJOR_PARTIES = ['NC', 'UML', 'Maoist', 'RSP', 'RPP', 'JSP']

export function TrendLineChart() {
  const { trendData } = useElectionStore()

  if (trendData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-osint-muted">Trends - No data</span>
      </div>
    )
  }

  // Extract which parties appear in the data
  const partiesInData = new Set<string>()
  for (const d of trendData) {
    for (const key of Object.keys(d.parties)) {
      partiesInData.add(key)
    }
  }

  const chartData = trendData.map(d => ({
    year: `${d.year} BS`,
    ...d.parties,
  }))

  const activeParties = MAJOR_PARTIES.filter(p => partiesInData.has(p))

  return (
    <div className="h-full flex flex-col">
      <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">Seat Trends</div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: 5, right: 10, top: 5, bottom: 5 }}>
            <XAxis
              dataKey="year"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: '#f3f4f6' }}
            />
            {activeParties.map(party => (
              <Line
                key={party}
                type="monotone"
                dataKey={party}
                stroke={PARTY_COLORS[party] || '#6b7280'}
                strokeWidth={2}
                dot={{ r: 3, fill: PARTY_COLORS[party] || '#6b7280' }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
