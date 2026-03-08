import { Calendar } from 'lucide-react'
import { useElectionStore } from '../../stores/electionStore'

export function ElectionYearSelector() {
  const { electionYear, setElectionYear, availableYears, mode } = useElectionStore()

  if (mode === 'live') return null

  // Historical mode only shows 2079 and 2074
  const historicalYears = availableYears.filter(y => y !== 2082)

  return (
    <div className="flex items-center gap-2">
      <Calendar size={12} className="text-osint-muted" />
      <select
        value={electionYear}
        onChange={(e) => setElectionYear(Number(e.target.value))}
        className="text-xs bg-osint-surface border border-osint-border rounded px-2 py-1.5 text-osint-text focus:outline-none focus:border-osint-primary"
      >
        {historicalYears.map(year => (
          <option key={year} value={year}>
            {year} BS
          </option>
        ))}
      </select>
    </div>
  )
}
