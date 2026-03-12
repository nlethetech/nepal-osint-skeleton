import { Radio, Wifi } from 'lucide-react'
import { useElectionStore, type ElectionMode } from '../../stores/electionStore'

export function ElectionModeToggle() {
  const { mode, setMode, setElectionYear, electionYear, isLiveConnected } = useElectionStore()

  const handleModeChange = (newMode: ElectionMode) => {
    setMode(newMode)
    if (newMode === 'live') {
      setElectionYear(2082)
    } else if (newMode === 'historical' && electionYear === 2082) {
      setElectionYear(2079)
    }
  }

  const modes: { id: ElectionMode; label: string; icon: typeof Radio }[] = [
    { id: 'live', label: 'LIVE', icon: Wifi },
    { id: 'historical', label: 'HISTORICAL', icon: Radio },
  ]

  return (
    <div className="flex items-center gap-1 bg-osint-surface border border-osint-border rounded-lg p-0.5">
      {modes.map(m => {
        const Icon = m.icon
        const isActive = mode === m.id
        return (
          <button
            key={m.id}
            onClick={() => handleModeChange(m.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              isActive
                ? m.id === 'live'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-osint-primary/20 text-osint-primary border border-osint-primary/30'
                : 'text-osint-text-secondary hover:text-osint-text'
            }`}
          >
            <Icon size={12} />
            {m.label}
            {m.id === 'live' && isActive && isLiveConnected && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            )}
          </button>
        )
      })}
    </div>
  )
}
