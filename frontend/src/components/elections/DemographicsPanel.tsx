import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useElectionStore } from '../../stores/electionStore'

export function DemographicsPanel() {
  const { demographics } = useElectionStore()

  if (!demographics) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-osint-muted">Demographics - No data</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Age Groups */}
      <div>
        <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">Turnout by Age Group</div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={demographics.age_groups.map(g => ({
                group: g.group,
                turnout: g.registered > 0 ? +((g.voted / g.registered) * 100).toFixed(1) : 0,
              }))}
              margin={{ left: 0, right: 0, top: 5, bottom: 0 }}
            >
              <XAxis dataKey="group" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={25} />
              <Tooltip
                contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '6px', fontSize: '10px' }}
                formatter={(value: number) => [`${value}%`, 'Turnout']}
              />
              <Bar dataKey="turnout" radius={[3, 3, 0, 0]}>
                {demographics.age_groups.map((_, i) => (
                  <Cell key={i} fill={i < 2 ? '#3b82f6' : i < 4 ? '#6366f1' : '#8b5cf6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Gender */}
      <div>
        <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">Gender Breakdown</div>
        <div className="space-y-1.5">
          {demographics.gender.map(g => {
            const turnout = g.registered > 0 ? (g.voted / g.registered) * 100 : 0
            return (
              <div key={g.gender}>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="text-osint-text-secondary">{g.gender}</span>
                  <span className="text-osint-muted">{turnout.toFixed(1)}% turnout</span>
                </div>
                <div className="h-1.5 bg-osint-surface rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${turnout}%`,
                      backgroundColor: g.gender === 'Male' ? '#3b82f6' : '#ec4899',
                    }}
                  />
                </div>
                <div className="text-[9px] text-osint-muted mt-0.5">
                  {g.voted.toLocaleString()} / {g.registered.toLocaleString()} registered
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Urban vs Rural */}
      <div>
        <div className="text-[10px] text-osint-muted uppercase tracking-wider mb-2">Urban vs Rural Turnout</div>
        <div className="flex gap-3">
          {demographics.urban_rural.map(ur => (
            <div key={ur.type} className="flex-1 bg-osint-surface rounded p-2 text-center">
              <div className="text-lg font-semibold text-osint-text">{(ur.turnout_pct ?? 0).toFixed(1)}%</div>
              <div className="text-[9px] text-osint-muted">{ur.type}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
