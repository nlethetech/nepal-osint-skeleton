/**
 * GandakiSummaryCards Component
 *
 * Four summary cards showing key metrics:
 * - News Today: Count of news articles from Gandaki sources
 * - Events: Count of reported events in province
 * - Weather: Current weather in Pokhara
 * - Districts: 11 districts info
 */

import { Newspaper, AlertCircle, Cloud, MapPin } from 'lucide-react'
import { useGandakiDashboardStore, getTimeRangeHours } from '../../stores/gandakiDashboardStore'
import { GANDAKI_DISTRICTS } from '../../data/gandaki'
import { useWeatherSummary } from '../../api/hooks/useWeather'
import './GandakiSummaryCards.css'

interface SummaryCardProps {
  icon: React.ReactNode
  label: string
  value: string | number
  sublabel?: string
  loading?: boolean
}

function SummaryCard({ icon, label, value, sublabel, loading }: SummaryCardProps) {
  return (
    <div className="gandaki-summary-card">
      <div className="gandaki-summary-icon">{icon}</div>
      <div className="gandaki-summary-content">
        <span className="gandaki-summary-label">{label}</span>
        {loading ? (
          <div className="gandaki-summary-skeleton" />
        ) : (
          <span className="gandaki-summary-value">{value}</span>
        )}
        {sublabel && <span className="gandaki-summary-sublabel">{sublabel}</span>}
      </div>
    </div>
  )
}

interface GandakiSummaryCardsProps {
  newsCount?: number
  eventsCount?: number
}

export function GandakiSummaryCards({ newsCount = 0, eventsCount = 0 }: GandakiSummaryCardsProps) {
  const { timeRange, viewScope } = useGandakiDashboardStore()
  const { data: weather, isLoading: weatherLoading } = useWeatherSummary()

  // Get weather display
  const getWeatherDisplay = () => {
    if (!weather) return '--'
    return weather.condition?.condition || 'Clear'
  }

  // Time range label
  const timeLabel = timeRange === '24h' ? 'Today' : timeRange === '48h' ? '48 Hours' : timeRange === '7d' ? '7 Days' : '30 Days'
  const scopeLabel = viewScope === 'gandaki' ? 'Gandaki' : 'Nepal'

  return (
    <div className="gandaki-summary-cards">
      <SummaryCard
        icon={<Newspaper size={20} />}
        label="News"
        value={newsCount}
        sublabel={`${scopeLabel} - ${timeLabel}`}
      />
      <SummaryCard
        icon={<AlertCircle size={20} />}
        label="Events"
        value={eventsCount}
        sublabel={`Reported - ${timeLabel}`}
      />
      <SummaryCard
        icon={<Cloud size={20} />}
        label="Weather"
        value={getWeatherDisplay()}
        sublabel="Pokhara"
        loading={weatherLoading}
      />
      <SummaryCard
        icon={<MapPin size={20} />}
        label="Districts"
        value={GANDAKI_DISTRICTS.length}
        sublabel="Gandaki Province"
      />
    </div>
  )
}
