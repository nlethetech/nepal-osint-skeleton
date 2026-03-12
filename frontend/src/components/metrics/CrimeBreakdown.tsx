/**
 * Crime Breakdown Component
 * Shows crime statistics with real-time updates and compact dashboard mode
 */
import { useEffect, useState, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { getCrimeStats, getCrimeIncidents, type CrimeStats, type CrimeIncidentWithStory } from '../../api/analytics'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { X, ExternalLink, AlertTriangle, FileText, MapPin, Clock, RefreshCw, Skull, Siren } from 'lucide-react'

interface CrimeBreakdownProps {
  refreshKey?: number
  compact?: boolean
  autoRefresh?: boolean
  refreshInterval?: number
}

// Data validation - cap unrealistic values
function validateCrimeStats(stats: CrimeStats[]): CrimeStats[] {
  return stats.map(stat => ({
    ...stat,
    fatalities: Math.min(stat.fatalities, 100),
    injuries: Math.min(stat.injuries, 500),
    murders: Math.min(stat.murders, 50),
  }))
}

// Crime type styling
const crimeTypeConfig: Record<string, { color: string; bgColor: string; label: string }> = {
  murder: { color: 'text-red-400', bgColor: 'bg-red-500/20', label: 'Murder' },
  assault: { color: 'text-orange-400', bgColor: 'bg-orange-500/20', label: 'Assault' },
  robbery: { color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', label: 'Robbery' },
  other: { color: 'text-indigo-400', bgColor: 'bg-indigo-500/20', label: 'Other Crime' },
}

function getCrimeConfig(type: string) {
  return crimeTypeConfig[type] || crimeTypeConfig.other
}

interface StoryModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  crimeType?: string
  district?: string
}

function StoryModal({ isOpen, onClose, title, crimeType, district }: StoryModalProps) {
  const [incidents, setIncidents] = useState<CrimeIncidentWithStory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    async function fetchIncidents() {
      try {
        setLoading(true)
        setError(null)
        const data = await getCrimeIncidents(7, crimeType, district, 50)
        setIncidents(data)
      } catch (err) {
        setError('Failed to load incidents')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchIncidents()
  }, [isOpen, crimeType, district])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-osint-card border border-osint-border rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-osint-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-osint-text">{title}</h2>
              <p className="text-sm text-osint-muted">
                {incidents.length} incidents with source stories
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-osint-border rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-osint-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner message="Loading incidents..." />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-osint-muted">{error}</div>
          ) : incidents.length === 0 ? (
            <div className="text-center py-12 text-osint-muted">
              No incidents found with this criteria
            </div>
          ) : (
            <div className="space-y-3">
              {incidents.map((incident) => {
                const config = getCrimeConfig(incident.crime_type)
                return (
                  <div
                    key={incident.id}
                    className="bg-osint-bg border border-osint-border rounded-lg p-4 hover:border-osint-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1">
                        <a
                          href={incident.story_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-osint-text hover:text-osint-accent font-medium flex items-start gap-2 group"
                        >
                          <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-osint-muted group-hover:text-osint-accent" />
                          <span>{incident.story_title}</span>
                          {incident.story_url && (
                            <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </a>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${config.bgColor} ${config.color}`}>
                        {config.label}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-4 text-sm text-osint-muted mb-3">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4" />
                        <span>{incident.district || 'Unknown'}</span>
                      </div>
                      {incident.story_published_at && (
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>{new Date(incident.story_published_at).toLocaleDateString()}</span>
                        </div>
                      )}
                      {incident.story_source && (
                        <span className="text-osint-muted/70">{incident.story_source}</span>
                      )}
                    </div>

                    <div className="flex gap-4 text-sm">
                      {incident.fatalities > 0 && (
                        <span className="text-red-400">
                          {incident.fatalities} fatalities
                        </span>
                      )}
                      {incident.injuries > 0 && (
                        <span className="text-orange-400">
                          {incident.injuries} injuries
                        </span>
                      )}
                      <span className="text-osint-muted/70">
                        {Math.round(incident.confidence * 100)}% confidence
                      </span>
                    </div>

                    {incident.extracted_text && (
                      <div className="mt-3 text-sm text-osint-muted/80 italic border-l-2 border-osint-border pl-3">
                        "{incident.extracted_text.slice(0, 200)}
                        {incident.extracted_text.length > 200 ? '...' : ''}"
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-osint-border p-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-osint-bg hover:bg-osint-border rounded-lg text-osint-text transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function CrimeBreakdown({
  refreshKey = 0,
  compact = false,
  autoRefresh = true,
  refreshInterval = 60000,
}: CrimeBreakdownProps) {
  const [data, setData] = useState<CrimeStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalConfig, setModalConfig] = useState<{
    title: string
    crimeType?: string
    district?: string
  }>({ title: 'Crime Incidents' })

  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setIsRefreshing(true)
    try {
      const result = await getCrimeStats(7)
      const validated = validateCrimeStats(result)
      setData(validated.slice(0, compact ? 5 : 10))
      setError(null)
    } catch (err) {
      setError('Failed to load crime data')
      console.error(err)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [compact])

  useEffect(() => {
    fetchData(true)
  }, [fetchData, refreshKey])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => {
      fetchData(false)
    }, refreshInterval)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshInterval, fetchData])

  const openModal = (title: string, crimeType?: string, district?: string) => {
    setModalConfig({ title, crimeType, district })
    setModalOpen(true)
  }

  if (loading && data.length === 0) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} flex items-center justify-center min-h-[200px]`}>
        <LoadingSpinner message="Loading crime statistics..." />
      </div>
    )
  }

  if (error && data.length === 0) {
    return (
      <div className={`bg-osint-card rounded-lg border border-osint-border ${compact ? 'p-4' : 'p-6'} text-center text-osint-muted`}>
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-red-500" />
        {error}
      </div>
    )
  }

  // Summary stats
  const totalIncidents = data.reduce((sum, d) => sum + d.total_incidents, 0)
  const totalMurders = data.reduce((sum, d) => sum + d.murders, 0)
  const totalFatalities = data.reduce((sum, d) => sum + d.fatalities, 0)

  const cardClass = compact
    ? "bg-osint-card rounded-lg border border-osint-border p-4"
    : "bg-osint-card rounded-xl border border-osint-border p-6"

  return (
    <>
      <div className={cardClass}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-osint-text flex items-center gap-2`}>
            <Siren className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-red-500`} />
            Crime Statistics (7 Days)
          </h2>
          <button
            onClick={() => fetchData(false)}
            disabled={isRefreshing}
            className="p-1 rounded hover:bg-osint-border transition-colors"
            title="Refresh data"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-osint-muted ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary Row - Clickable */}
        <div className={`grid grid-cols-3 gap-${compact ? '2' : '4'} mb-4`}>
          <button
            onClick={() => openModal('All Crime Incidents')}
            className={`bg-red-500/10 rounded-lg ${compact ? 'p-2' : 'p-3'} text-center hover:bg-red-500/20 transition-colors cursor-pointer border border-red-500/20`}
          >
            <div className={`${compact ? 'text-lg' : 'text-2xl'} font-bold text-red-400`}>{totalIncidents}</div>
            <div className="text-[10px] text-osint-muted uppercase">Total Incidents</div>
            {!compact && <div className="text-[10px] text-osint-accent mt-1">Click to view</div>}
          </button>
          <button
            onClick={() => openModal('Murder Incidents', 'murder')}
            className={`bg-red-600/10 rounded-lg ${compact ? 'p-2' : 'p-3'} text-center hover:bg-red-600/20 transition-colors cursor-pointer border border-red-600/20`}
          >
            <div className={`${compact ? 'text-lg' : 'text-2xl'} font-bold text-red-500 flex items-center justify-center gap-1`}>
              <Skull className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
              {totalMurders}
            </div>
            <div className="text-[10px] text-osint-muted uppercase">Murders</div>
            {!compact && <div className="text-[10px] text-osint-accent mt-1">Click to view</div>}
          </button>
          <button
            onClick={() => openModal('All Crime Fatalities')}
            className={`bg-orange-500/10 rounded-lg ${compact ? 'p-2' : 'p-3'} text-center hover:bg-orange-500/20 transition-colors cursor-pointer border border-orange-500/20`}
          >
            <div className={`${compact ? 'text-lg' : 'text-2xl'} font-bold text-orange-400`}>{totalFatalities}</div>
            <div className="text-[10px] text-osint-muted uppercase">Fatalities</div>
            {!compact && <div className="text-[10px] text-osint-accent mt-1">Click to view</div>}
          </button>
        </div>

        {/* Chart */}
        <div className={compact ? 'h-40' : 'h-64'}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: compact ? 60 : 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis type="number" stroke="#71717a" tick={{ fill: '#71717a', fontSize: compact ? 10 : 11 }} />
              <YAxis
                type="category"
                dataKey="district"
                stroke="#71717a"
                tick={{ fill: '#a1a1aa', fontSize: compact ? 10 : 11 }}
                width={compact ? 55 : 75}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a24',
                  border: '1px solid #2a2a3a',
                  borderRadius: '8px',
                }}
                content={({ payload, label }) => {
                  if (!payload || !payload.length) return null
                  return (
                    <div className="bg-osint-card border border-osint-border rounded-lg p-3 shadow-xl">
                      <p className="font-medium text-osint-text mb-2">{label}</p>
                      <p className="text-sm text-osint-muted">
                        {payload[0]?.value} incidents
                      </p>
                      <p className="text-xs text-osint-accent mt-1">Click to view stories</p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="total_incidents"
                fill="#ef4444"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(barData) => {
                  if (barData?.district) {
                    openModal(`Crime in ${barData.district}`, undefined, barData.district)
                  }
                }}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.murders > 0 ? '#dc2626' : '#ef4444'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Crime Type Legend */}
        {!compact && (
          <div className="mt-4 pt-4 border-t border-osint-border">
            <div className="flex flex-wrap gap-4 text-sm">
              <button
                onClick={() => openModal('Murder Cases', 'murder')}
                className="flex items-center gap-2 hover:text-osint-accent transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-red-600"></span>
                <span className="text-osint-muted hover:text-osint-text">Murder</span>
              </button>
              <button
                onClick={() => openModal('Assault Cases', 'assault')}
                className="flex items-center gap-2 hover:text-osint-accent transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                <span className="text-osint-muted hover:text-osint-text">Assault</span>
              </button>
              <button
                onClick={() => openModal('Robbery Cases', 'robbery')}
                className="flex items-center gap-2 hover:text-osint-accent transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                <span className="text-osint-muted hover:text-osint-text">Robbery</span>
              </button>
              <button
                onClick={() => openModal('Other Crimes', 'other')}
                className="flex items-center gap-2 hover:text-osint-accent transition-colors"
              >
                <span className="w-3 h-3 rounded-full bg-indigo-500"></span>
                <span className="text-osint-muted hover:text-osint-text">Other</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <StoryModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalConfig.title}
        crimeType={modalConfig.crimeType}
        district={modalConfig.district}
      />
    </>
  )
}
