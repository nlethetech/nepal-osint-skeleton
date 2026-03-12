/**
 * AlertTicker - Live election alert horizontal scroller
 *
 * Displays election alerts in a horizontally scrolling ticker bar.
 * Fetches initial alerts from backend, subscribes to WebSocket for live updates.
 * Falls back gracefully when backend is unavailable.
 */

import { useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import { useElectionStore } from '../../stores/electionStore'
import { fetchWatchlistAlerts } from '../../api/elections'

export function AlertTicker() {
  const { tickerAlerts, isTickerConnected, setTickerAlerts, setTickerConnected } = useElectionStore()

  // Fetch initial alerts on mount
  useEffect(() => {
    let cancelled = false

    async function loadAlerts() {
      try {
        const { alerts } = await fetchWatchlistAlerts(20)
        if (!cancelled) {
          setTickerAlerts(alerts)
          setTickerConnected(true)
        }
      } catch {
        if (!cancelled) {
          setTickerConnected(false)
        }
      }
    }

    loadAlerts()
    return () => { cancelled = true }
  }, [setTickerAlerts, setTickerConnected])

  // Fallback when no backend
  if (!isTickerConnected || tickerAlerts.length === 0) {
    return (
      <div className="h-7 bg-osint-surface/50 border-b border-osint-border flex items-center justify-center gap-1.5 overflow-hidden">
        <WifiOff size={10} className="text-osint-muted" />
        <span className="text-[9px] text-osint-muted">Connect backend to enable live alerts</span>
      </div>
    )
  }

  return (
    <div className="h-7 bg-osint-surface/50 border-b border-osint-border overflow-hidden relative">
      <div className="absolute whitespace-nowrap animate-scroll-left flex items-center h-full gap-6">
        {tickerAlerts.map((alert, i) => (
          <span key={alert.id || i} className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              alert.severity === 'critical' ? 'bg-red-500' :
              alert.severity === 'high' ? 'bg-amber-500' :
              'bg-blue-400'
            }`} />
            <span className="text-[10px] text-osint-text-secondary">{alert.title}</span>
            {alert.created_at && (
              <span className="text-[9px] text-osint-muted">
                {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
