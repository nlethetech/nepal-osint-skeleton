import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useElectionStore } from '../../stores/electionStore'

function abbreviateParty(name: string): string {
  const abbrevs: Record<string, string> = {
    'Nepali Congress': 'NC',
    'CPN-UML': 'UML',
    'CPN-Maoist Centre': 'Maoist',
    'CPN-Unified Socialist': 'CPN-US',
    'Rastriya Swatantra Party': 'RSP',
    'RPP': 'RPP',
    'Janata Samajbadi Party': 'JSP',
    'Loktantrik Samajbadi Party': 'LSP',
    'Nagarik Unmukti Party': 'NUP',
    'Janamat Party': 'Janamat',
    'Independent': 'Ind.',
  }
  return abbrevs[name] || (name.length > 10 ? name.slice(0, 9) + '.' : name)
}

export function SwingChart() {
  const { swingData } = useElectionStore()

  if (swingData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-osint-muted">Swing Analysis - No data</span>
      </div>
    )
  }

  const data = swingData
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 8)
    .map(s => ({
      name: abbreviateParty(s.party),
      gained: s.gained,
      lost: -s.lost,
      net: s.net,
    }))

  return (
    <div className="h-full flex flex-col">
      <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">
        Seat Swing vs Previous
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 60, right: 10, top: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: '#d1d5db' }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Tooltip
              contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '11px' }}
              labelStyle={{ color: '#f3f4f6' }}
              formatter={(value: number, name: string) => [
                `${value > 0 ? '+' : ''}${value}`,
                name === 'gained' ? 'Gained' : name === 'lost' ? 'Lost' : 'Net'
              ]}
            />
            <ReferenceLine x={0} stroke="#4b5563" />
            <Bar dataKey="gained" name="gained" radius={[0, 4, 4, 0]} fill="#22c55e" />
            <Bar dataKey="lost" name="lost" radius={[4, 0, 0, 4]} fill="#ef4444" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
