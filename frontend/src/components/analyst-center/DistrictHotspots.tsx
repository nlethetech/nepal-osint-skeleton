import { MapPin } from 'lucide-react'

interface DistrictStat {
  name: string
  count: number
  critical: number
  high: number
}

interface DistrictHotspotsProps {
  districts: DistrictStat[]
  selectedDistricts: string[]
  onDistrictClick: (district: string) => void
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

export function DistrictHotspots({ districts, selectedDistricts, onDistrictClick }: DistrictHotspotsProps) {
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--pro-border-subtle)] flex items-center gap-2">
        <MapPin size={12} className="text-[var(--pro-text-muted)]" />
        <h2 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Districts ({districts.length})
        </h2>
      </div>

      {/* District List */}
      {districts.length === 0 ? (
        <div className="p-3 text-center text-xs text-[var(--pro-text-muted)]">
          No district data
        </div>
      ) : (
        <div className="divide-y divide-[var(--pro-border-subtle)]">
          {districts.map((district) => {
            const isSelected = selectedDistricts.includes(district.name)
            // Determine severity level
            const severity =
              district.critical > 0 ? 'critical' : district.high > 0 ? 'high' : 'medium'
            return (
              <button
                key={district.name}
                onClick={() => onDistrictClick(district.name)}
                className={`
                  w-full text-left px-3 py-2 flex items-center gap-2 transition-colors
                  ${isSelected ? 'bg-[var(--pro-accent-muted)]' : 'hover:bg-[var(--pro-bg-hover)]'}
                `}
              >
                {/* Severity Dot */}
                <div className={`w-2 h-2 rounded-full ${SEVERITY_DOT[severity]}`} />

                {/* District Name */}
                <span className="flex-1 text-xs text-[var(--pro-text-primary)] truncate">
                  {district.name}
                </span>

                {/* Critical/High indicators */}
                {district.critical > 0 && (
                  <span className="text-[9px] font-mono text-red-400">
                    {district.critical}C
                  </span>
                )}
                {district.high > 0 && (
                  <span className="text-[9px] font-mono text-orange-400">
                    {district.high}H
                  </span>
                )}

                {/* Total Count */}
                <span className="text-xs font-mono text-[var(--pro-text-muted)]">
                  {district.count}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
