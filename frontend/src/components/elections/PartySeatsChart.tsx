import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useElectionStore } from '../../stores/electionStore'
import { PARTY_COLORS } from './partyColors'

export function PartySeatsChart() {
  const { nationalSummary } = useElectionStore()

  if (!nationalSummary || nationalSummary.party_seats.length === 0) {
    return <EmptyChart label="Party Seats" />
  }

  const data = nationalSummary.party_seats
    .sort((a, b) => b.seats - a.seats)
    .slice(0, 8)
    .map(p => ({
      name: abbreviateParty(p.party),
      fullName: p.party,
      seats: p.seats,
      leading: p.leading,
      total: p.seats + p.leading,
    }))

  return (
    <div className="h-full flex flex-col">
      <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">Party Seats Won</div>
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
              itemStyle={{ color: '#9ca3af' }}
            />
            <Bar dataKey="seats" name="Won" radius={[0, 4, 4, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={PARTY_COLORS[entry.fullName] || '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

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

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="text-xs text-osint-muted">{label} - No data</span>
    </div>
  )
}
