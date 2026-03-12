/**
 * GandakiWeatherPanel Component
 *
 * Current conditions for Pokhara with weather and river level info.
 * Simple icons and numbers for easy reading.
 */

import { Cloud, Sun, CloudSun, CloudRain, CloudDrizzle, CloudLightning, Snowflake, Thermometer, Droplets, Wind, AlertTriangle } from 'lucide-react'
import { useWeatherSummary } from '../../api/hooks/useWeather'
import { useRiverStations } from '../../api/hooks/useRiver'
import './GandakiWeatherPanel.css'

const WEATHER_ICONS: Record<string, { component: React.ComponentType<any>; color: string }> = {
  'sun': { component: Sun, color: '#fbbf24' },
  'cloud-sun': { component: CloudSun, color: '#94a3b8' },
  'cloud': { component: Cloud, color: '#64748b' },
  'cloud-rain': { component: CloudRain, color: '#3b82f6' },
  'cloud-drizzle': { component: CloudDrizzle, color: '#60a5fa' },
  'cloud-lightning': { component: CloudLightning, color: '#fbbf24' },
  'snowflake': { component: Snowflake, color: '#e0f2fe' },
}

function getWeatherIcon(iconCode: string) {
  return WEATHER_ICONS[iconCode] || WEATHER_ICONS['cloud']
}

export function GandakiWeatherPanel() {
  const { data: weather, isLoading: weatherLoading, isError: weatherError } = useWeatherSummary()
  const { data: rivers, isLoading: riversLoading } = useRiverStations()

  // Filter rivers to Gandaki region (Seti, Mardi, etc.)
  const gandakiRivers = (rivers || []).filter((river: any) => {
    const name = (river.name || river.station || '').toLowerCase()
    return name.includes('seti') || name.includes('mardi') || name.includes('kaligandaki') || name.includes('gandaki')
  })

  if (weatherLoading) {
    return (
      <div className="gandaki-weather-panel">
        <div className="gandaki-weather-header">
          <h3><Cloud size={16} /> Weather & Rivers</h3>
        </div>
        <div className="gandaki-weather-loading">
          <div className="gandaki-weather-skeleton large" />
          <div className="gandaki-weather-skeleton" />
          <div className="gandaki-weather-skeleton" />
        </div>
      </div>
    )
  }

  if (weatherError || !weather) {
    return (
      <div className="gandaki-weather-panel">
        <div className="gandaki-weather-header">
          <h3><Cloud size={16} /> Weather & Rivers</h3>
        </div>
        <div className="gandaki-weather-error">
          <AlertTriangle size={24} />
          <p>Weather data unavailable</p>
        </div>
      </div>
    )
  }

  const iconInfo = getWeatherIcon(weather.condition?.icon || 'cloud')
  const IconComponent = iconInfo.component

  return (
    <div className="gandaki-weather-panel">
      <div className="gandaki-weather-header">
        <h3><Cloud size={16} /> Weather & Rivers</h3>
        <span className="gandaki-weather-location">Pokhara</span>
      </div>

      <div className="gandaki-weather-content">
        {/* Current Weather */}
        <div className="gandaki-weather-current">
          <div className="gandaki-weather-icon-large">
            <IconComponent size={48} color={iconInfo.color} />
          </div>
          <div className="gandaki-weather-main">
            <span className="gandaki-weather-condition">
              {weather.condition?.condition || 'Clear'}
            </span>
            <span className="gandaki-weather-updated">
              {weather.issue_date ? new Date(weather.issue_date).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              }) : 'Today'}
            </span>
          </div>
        </div>

        {/* Special Notice */}
        {weather.special_notice && (
          <div className="gandaki-weather-notice">
            <AlertTriangle size={14} />
            <span>{weather.special_notice}</span>
          </div>
        )}

        {/* Forecast */}
        <div className="gandaki-weather-forecast">
          <h4>Today's Forecast</h4>
          <p>{weather.forecast_today_en || 'No forecast available'}</p>
        </div>

        {/* River Levels */}
        {gandakiRivers.length > 0 && (
          <div className="gandaki-weather-rivers">
            <h4><Droplets size={14} /> River Levels</h4>
            <div className="gandaki-river-list">
              {gandakiRivers.slice(0, 3).map((river: any, index: number) => (
                <div key={river.id || index} className="gandaki-river-item">
                  <span className="gandaki-river-name">{river.name || river.station}</span>
                  <span className={`gandaki-river-level ${river.status || 'normal'}`}>
                    {river.level ? `${river.level}m` : 'Normal'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Source attribution */}
        <div className="gandaki-weather-source">
          <span>Source: {weather.data_source || 'DHM Nepal'}</span>
        </div>
      </div>
    </div>
  )
}
