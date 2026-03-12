import { useEffect, useState } from 'react'
import {
  Shield,
  Flame,
  AlertTriangle,
  TrendingDown,
  Users,
  RefreshCw,
  MapPin,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react'
import { indicesApi, type IndexResult, type DistrictIndex, type NationalIndex } from '../api'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

const INDEX_CONFIG = {
  stability: { icon: Shield, label: 'Stability Index', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  tension: { icon: Flame, label: 'Tension Index', color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  crime: { icon: AlertTriangle, label: 'Crime Index', color: 'text-red-400', bgColor: 'bg-red-500/20' },
  economic: { icon: TrendingDown, label: 'Economic Pressure', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  youth_stress: { icon: Users, label: 'Youth Stress', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
}

const LEVEL_COLORS = {
  critical: 'bg-red-500',
  elevated: 'bg-orange-500',
  moderate: 'bg-yellow-500',
  low: 'bg-green-500',
  minimal: 'bg-blue-500',
}

function IndexGauge({ value, level }: { value: number; level: string }) {
  const color = LEVEL_COLORS[level as keyof typeof LEVEL_COLORS] || 'bg-gray-500'

  return (
    <div className="relative w-full h-4 bg-osint-border rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-700`}
        style={{ width: `${Math.min(100, value)}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-white drop-shadow-md">{value.toFixed(0)}</span>
      </div>
    </div>
  )
}

function IndexCard({
  indexKey,
  data,
}: {
  indexKey: keyof typeof INDEX_CONFIG
  data: IndexResult | null
}) {
  const config = INDEX_CONFIG[indexKey]
  const Icon = config.icon

  if (!data) {
    return (
      <div className="bg-osint-card border border-osint-border rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-osint-border rounded w-1/2" />
          <div className="h-8 bg-osint-border rounded" />
        </div>
      </div>
    )
  }

  const TrendIcon = data.trend === 'rising' ? ArrowUp : data.trend === 'falling' ? ArrowDown : Minus
  const trendColor =
    data.trend === 'rising' ? 'text-red-400' : data.trend === 'falling' ? 'text-green-400' : 'text-gray-400'

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${config.bgColor}`}>
            <Icon className={`w-5 h-5 ${config.color}`} />
          </div>
          <h3 className="font-medium text-osint-text">{config.label}</h3>
        </div>
        <div className={`flex items-center gap-1 ${trendColor}`}>
          <TrendIcon className="w-4 h-4" />
          <span className="text-sm">{Math.abs(data.trend_value).toFixed(1)}</span>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-3xl font-bold text-osint-text">{data.value.toFixed(1)}</span>
          <span className="text-osint-muted capitalize">/ 100 ({data.level})</span>
        </div>
        <IndexGauge value={data.value} level={data.level} />
      </div>

      {data.components && Object.keys(data.components).length > 0 && (
        <div className="space-y-2 pt-4 border-t border-osint-border">
          <h4 className="text-xs text-osint-muted uppercase tracking-wider">Components</h4>
          {Object.entries(data.components).slice(0, 4).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-osint-muted capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="text-osint-text">{(value as number).toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DistrictTable({ districts }: { districts: DistrictIndex[] }) {
  const [sortBy, setSortBy] = useState<keyof DistrictIndex>('composite')
  const [sortDesc, setSortDesc] = useState(true)

  const sorted = [...districts].sort((a, b) => {
    const aVal = a[sortBy] as number
    const bVal = b[sortBy] as number
    return sortDesc ? bVal - aVal : aVal - bVal
  })

  const handleSort = (key: keyof DistrictIndex) => {
    if (sortBy === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortBy(key)
      setSortDesc(true)
    }
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-osint-border">
        <h3 className="text-lg font-semibold text-osint-text">District Breakdown</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-osint-bg text-left">
              {[
                { key: 'district', label: 'District' },
                { key: 'stability', label: 'Stability' },
                { key: 'tension', label: 'Tension' },
                { key: 'crime', label: 'Crime' },
                { key: 'economic', label: 'Economic' },
                { key: 'youth_stress', label: 'Youth' },
                { key: 'composite', label: 'Composite' },
              ].map(({ key, label }) => (
                <th
                  key={key}
                  className="px-4 py-3 text-sm font-medium text-osint-muted cursor-pointer hover:text-osint-text"
                  onClick={() => handleSort(key as keyof DistrictIndex)}
                >
                  {label}
                  {sortBy === key && (sortDesc ? ' ▼' : ' ▲')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 20).map((d) => (
              <tr key={d.district} className="border-t border-osint-border hover:bg-osint-bg/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-osint-muted" />
                    <span className="text-osint-text">{d.district}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">{d.stability.toFixed(1)}</td>
                <td className="px-4 py-3 text-sm">{d.tension.toFixed(1)}</td>
                <td className="px-4 py-3 text-sm">{d.crime.toFixed(1)}</td>
                <td className="px-4 py-3 text-sm">{d.economic.toFixed(1)}</td>
                <td className="px-4 py-3 text-sm">{d.youth_stress.toFixed(1)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      LEVEL_COLORS[d.level as keyof typeof LEVEL_COLORS] || 'bg-gray-500'
                    } text-white`}
                  >
                    {d.composite.toFixed(1)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Indices() {
  const [national, setNational] = useState<NationalIndex | null>(null)
  const [districts, setDistricts] = useState<DistrictIndex[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [nationalData, districtData] = await Promise.all([
        indicesApi.getNationalIndex(),
        indicesApi.getDistrictIndices(),
      ])
      setNational(nationalData)
      setDistricts(districtData)
    } catch (err) {
      console.error('Failed to fetch indices:', err)
      setError('Failed to load OSINT indices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner message="Loading OSINT indices..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-osint-card border border-red-500/30 rounded-xl p-8 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-osint-text mb-2">Failed to Load Indices</h3>
        <p className="text-osint-muted mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 px-4 py-2 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors"
        >
          <RefreshCw size={16} />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-osint-text">OSINT Indices</h1>
          <p className="text-osint-muted mt-1">Military-grade situational awareness metrics (0-100 scale)</p>
        </div>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 px-4 py-2 bg-osint-card border border-osint-border hover:border-osint-accent rounded-lg transition-colors text-osint-text"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* National Overview */}
      {national && (
        <div className="bg-osint-card border border-osint-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-osint-text">National Composite Index</h2>
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                LEVEL_COLORS[national.level as keyof typeof LEVEL_COLORS] || 'bg-gray-500'
              } text-white`}
            >
              {national.level.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-5xl font-bold text-osint-text">{national.overall.toFixed(1)}</div>
            <div className="flex-1">
              <IndexGauge value={national.overall} level={national.level} />
            </div>
          </div>
        </div>
      )}

      {/* Individual Indices */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        <IndexCard indexKey="stability" data={national?.indices.stability || null} />
        <IndexCard indexKey="tension" data={national?.indices.tension || null} />
        <IndexCard indexKey="crime" data={national?.indices.crime || null} />
        <IndexCard indexKey="economic" data={national?.indices.economic || null} />
        <IndexCard indexKey="youth_stress" data={national?.indices.youth_stress || null} />
      </div>

      {/* Hotspots */}
      {national?.hotspots && national.hotspots.length > 0 && (
        <div className="bg-osint-card border border-osint-border rounded-xl p-6">
          <h2 className="text-lg font-semibold text-osint-text mb-4">Current Hotspots</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {national.hotspots.map((h, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 bg-osint-bg rounded-lg border border-osint-border"
              >
                <MapPin className="w-5 h-5 text-red-400" />
                <div>
                  <div className="font-medium text-osint-text">{h.location}</div>
                  <div className="text-sm text-osint-muted">
                    {h.index}: {h.value.toFixed(1)} ({h.level})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* District Table */}
      {districts.length > 0 && <DistrictTable districts={districts} />}
    </div>
  )
}
