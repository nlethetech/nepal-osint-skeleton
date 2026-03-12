import { useState, useMemo } from 'react'
import { MapPin, Info, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react'
import { useHotspots } from '../../hooks/useSpatialAnalysis'

interface DistrictData {
  name: string
  province: string
  value: number
  trend: 'up' | 'down' | 'stable'
  risk_level: 'critical' | 'high' | 'elevated' | 'moderate' | 'low'
  events?: number
  population?: number
}

interface ProvinceData {
  name: string
  districts: DistrictData[]
  total_value: number
  risk_level: 'critical' | 'high' | 'elevated' | 'moderate' | 'low'
}

type MetricType = 'events' | 'risk_index' | 'economic_activity' | 'trade_volume'

interface GeospatialHeatmapProps {
  metric?: MetricType
  onDistrictSelect?: (district: string) => void
  hours?: number
  data?: ProvinceData[] // Optional: pass data directly instead of fetching
}

// Province names for aggregation
const PROVINCE_DISTRICTS: Record<string, string[]> = {
  'Koshi': ['Jhapa', 'Morang', 'Sunsari', 'Ilam', 'Taplejung', 'Panchthar', 'Sankhuwasabha', 'Terhathum', 'Dhankuta', 'Bhojpur', 'Solukhumbu', 'Okhaldhunga', 'Khotang', 'Udayapur'],
  'Madhesh': ['Dhanusha', 'Saptari', 'Siraha', 'Parsa', 'Bara', 'Rautahat', 'Sarlahi', 'Mahottari'],
  'Bagmati': ['Kathmandu', 'Lalitpur', 'Bhaktapur', 'Chitwan', 'Makwanpur', 'Kavrepalanchok', 'Sindhupalchok', 'Nuwakot', 'Rasuwa', 'Dhading', 'Dolakha', 'Ramechhap', 'Sindhuli'],
  'Gandaki': ['Kaski', 'Tanahu', 'Gorkha', 'Lamjung', 'Syangja', 'Nawalparasi East', 'Parbat', 'Baglung', 'Myagdi', 'Mustang', 'Manang'],
  'Lumbini': ['Rupandehi', 'Kapilvastu', 'Dang', 'Banke', 'Bardiya', 'Gulmi', 'Arghakhanchi', 'Palpa', 'Nawalparasi West', 'Pyuthan', 'Rolpa', 'Rukum East'],
  'Karnali': ['Surkhet', 'Jumla', 'Dailekh', 'Dolpa', 'Kalikot', 'Mugu', 'Humla', 'Jajarkot', 'Salyan', 'Rukum West'],
  'Sudurpashchim': ['Kailali', 'Kanchanpur', 'Doti', 'Achham', 'Bajhang', 'Bajura', 'Darchula', 'Baitadi', 'Dadeldhura'],
}

// Find province for a district
function findProvinceForDistrict(districtName: string): string {
  const normalized = districtName.toLowerCase()
  for (const [province, districts] of Object.entries(PROVINCE_DISTRICTS)) {
    if (districts.some(d => d.toLowerCase() === normalized)) {
      return province
    }
  }
  return 'Unknown'
}

// Determine risk level from event count
function getRiskLevelFromEvents(events: number): 'critical' | 'high' | 'elevated' | 'moderate' | 'low' {
  if (events >= 50) return 'critical'
  if (events >= 30) return 'high'
  if (events >= 15) return 'elevated'
  if (events >= 5) return 'moderate'
  return 'low'
}

// Transform hotspot API data to province/district format
function transformHotspotData(clusters: any[]): ProvinceData[] {
  // Aggregate events by district
  const districtEvents: Record<string, { count: number; severity: Record<string, number> }> = {}

  for (const cluster of clusters) {
    for (const district of cluster.districts || []) {
      const normalized = district.toLowerCase()
      if (!districtEvents[normalized]) {
        districtEvents[normalized] = { count: 0, severity: {} }
      }
      districtEvents[normalized].count += cluster.member_count || 0

      // Track severity breakdown
      if (cluster.severity_breakdown) {
        for (const [sev, count] of Object.entries(cluster.severity_breakdown)) {
          districtEvents[normalized].severity[sev] =
            (districtEvents[normalized].severity[sev] || 0) + (count as number)
        }
      }
    }
  }

  // Build province data
  const provinceMap: Record<string, ProvinceData> = {}

  for (const [districtName, data] of Object.entries(districtEvents)) {
    const province = findProvinceForDistrict(districtName)
    if (!provinceMap[province]) {
      provinceMap[province] = {
        name: province,
        districts: [],
        total_value: 0,
        risk_level: 'low',
      }
    }

    const districtData: DistrictData = {
      name: districtName.charAt(0).toUpperCase() + districtName.slice(1),
      province,
      value: data.count,
      trend: 'stable', // Would need historical data to determine
      risk_level: getRiskLevelFromEvents(data.count),
      events: data.count,
    }

    provinceMap[province].districts.push(districtData)
    provinceMap[province].total_value += data.count
  }

  // Set province risk levels
  for (const province of Object.values(provinceMap)) {
    province.risk_level = getRiskLevelFromEvents(province.total_value)
    province.districts.sort((a, b) => b.value - a.value)
  }

  // Ensure all provinces are represented
  for (const provinceName of Object.keys(PROVINCE_DISTRICTS)) {
    if (!provinceMap[provinceName]) {
      provinceMap[provinceName] = {
        name: provinceName,
        districts: [],
        total_value: 0,
        risk_level: 'low',
      }
    }
  }

  return Object.values(provinceMap).sort((a, b) => b.total_value - a.total_value)
}

export function GeospatialHeatmap({
  metric = 'events',
  onDistrictSelect,
  hours = 168, // Default 7 days
  data: externalData,
}: GeospatialHeatmapProps) {
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null)
  const [hoveredDistrict, setHoveredDistrict] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  // Fetch hotspot data from API if no external data provided
  const { data: hotspotsResponse, isLoading, error } = useHotspots(
    { hours, eps_km: 10 },
    { enabled: !externalData }
  )

  // Transform API data or use external data
  const provinceData = useMemo(() => {
    if (externalData) return externalData
    if (hotspotsResponse?.clusters) {
      return transformHotspotData(hotspotsResponse.clusters)
    }
    return []
  }, [externalData, hotspotsResponse])

  const getRiskColor = (risk: string, intensity: number = 1): string => {
    const colors = {
      critical: `rgba(239, 68, 68, ${intensity})`,
      high: `rgba(249, 115, 22, ${intensity})`,
      elevated: `rgba(234, 179, 8, ${intensity})`,
      moderate: `rgba(59, 130, 246, ${intensity})`,
      low: `rgba(34, 197, 94, ${intensity})`,
    }
    return colors[risk as keyof typeof colors] || colors.moderate
  }

  const getRiskBgClass = (risk: string): string => {
    const classes = {
      critical: 'bg-severity-critical',
      high: 'bg-severity-high',
      elevated: 'bg-severity-medium',
      moderate: 'bg-entity-organization',
      low: 'bg-severity-low',
    }
    return classes[risk as keyof typeof classes] || 'bg-osint-muted'
  }

  const sortedProvinces = useMemo(() => {
    return [...provinceData].sort((a, b) => b.total_value - a.total_value)
  }, [provinceData])

  const selectedProvinceData = selectedProvince
    ? provinceData.find(p => p.name === selectedProvince)
    : null

  // Loading state
  if (isLoading && !externalData) {
    return (
      <div className="bg-osint-card border border-osint-border rounded-xl p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-osint-muted">
          <Loader2 className="animate-spin" size={20} />
          <span>Loading spatial analysis...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !externalData) {
    return (
      <div className="bg-osint-card border border-osint-border rounded-xl p-8">
        <div className="flex items-center gap-3 text-severity-high">
          <AlertTriangle size={20} />
          <span>Failed to load spatial data. Please try again.</span>
        </div>
      </div>
    )
  }

  // Empty state
  if (provinceData.length === 0) {
    return (
      <div className="bg-osint-card border border-osint-border rounded-xl p-8">
        <div className="flex items-center gap-3 text-osint-muted">
          <MapPin size={20} />
          <span>No events found in the selected time period.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <MapPin className="text-primary-400" size={20} />
            <h3 className="font-semibold text-osint-text">Geospatial Analysis</h3>
            {hotspotsResponse && (
              <span className="text-xs text-osint-muted">
                ({hotspotsResponse.total_events_analyzed} events)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="p-1.5 hover:bg-osint-border rounded transition-colors"
            >
              <Info size={16} className="text-osint-muted" />
            </button>
          </div>
        </div>

        {/* Metric Selector */}
        <div className="flex gap-2">
          {['events', 'risk_index', 'economic_activity'].map(m => (
            <button
              key={m}
              className={`px-2 py-1 text-xs rounded capitalize transition-colors ${
                metric === m
                  ? 'bg-primary-600 text-white'
                  : 'bg-osint-border text-osint-muted hover:text-osint-text'
              }`}
            >
              {m.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Province Heatmap Grid */}
      <div className="p-4">
        <div className="grid grid-cols-7 gap-1 mb-4">
          {sortedProvinces.map(province => (
            <div
              key={province.name}
              onClick={() => setSelectedProvince(
                selectedProvince === province.name ? null : province.name
              )}
              className={`relative p-3 rounded-lg cursor-pointer transition-all ${
                selectedProvince === province.name
                  ? 'ring-2 ring-primary-500'
                  : 'hover:ring-1 hover:ring-osint-border'
              }`}
              style={{
                backgroundColor: getRiskColor(province.risk_level, 0.2)
              }}
            >
              <div
                className="absolute inset-0 rounded-lg"
                style={{
                  backgroundColor: getRiskColor(province.risk_level, province.total_value / 400)
                }}
              />
              <div className="relative z-10">
                <p className="text-xs font-medium text-osint-text truncate">{province.name}</p>
                <p className="text-lg font-bold text-osint-text">{province.total_value}</p>
                <div className={`inline-block px-1 py-0.5 text-[10px] rounded text-white mt-1 ${getRiskBgClass(province.risk_level)}`}>
                  {province.risk_level}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* District Breakdown */}
        {selectedProvinceData && selectedProvinceData.districts.length > 0 && (
          <div className="border border-osint-border rounded-lg p-3 bg-osint-bg">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-osint-text">
                {selectedProvinceData.name} Province - Districts
              </h4>
              <button
                onClick={() => setSelectedProvince(null)}
                className="text-xs text-osint-muted hover:text-osint-text"
              >
                Close
              </button>
            </div>
            <div className="space-y-2">
              {selectedProvinceData.districts
                .sort((a, b) => b.value - a.value)
                .map(district => (
                  <div
                    key={district.name}
                    onClick={() => onDistrictSelect?.(district.name)}
                    onMouseEnter={() => setHoveredDistrict(district.name)}
                    onMouseLeave={() => setHoveredDistrict(null)}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      hoveredDistrict === district.name
                        ? 'bg-osint-border'
                        : 'hover:bg-osint-border/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getRiskColor(district.risk_level, 1) }}
                      />
                      <span className="text-sm text-osint-text">{district.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-osint-muted">{district.events} events</span>
                      <div className="flex items-center gap-1">
                        {district.trend === 'up' && (
                          <TrendingUp size={12} className="text-severity-critical" />
                        )}
                        {district.trend === 'down' && (
                          <TrendingUp size={12} className="text-severity-low rotate-180" />
                        )}
                        <span className="text-sm font-medium text-osint-text">{district.value}</span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* No districts message */}
        {selectedProvinceData && selectedProvinceData.districts.length === 0 && (
          <div className="border border-osint-border rounded-lg p-3 bg-osint-bg text-center text-osint-muted text-sm">
            No events recorded in {selectedProvinceData.name} Province
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-osint-muted">Risk Level:</span>
            {['critical', 'high', 'elevated', 'moderate', 'low'].map(level => (
              <div key={level} className="flex items-center gap-1">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: getRiskColor(level, 0.8) }}
                />
                <span className="text-osint-muted capitalize">{level}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hotspot Alerts */}
      {provinceData.some(p => p.risk_level === 'critical') && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 bg-severity-critical/10 text-severity-critical text-xs p-2 rounded-lg">
            <AlertTriangle size={14} />
            <span>
              Critical hotspots detected in{' '}
              {provinceData.filter(p => p.risk_level === 'critical').map(p => p.name).join(', ')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
