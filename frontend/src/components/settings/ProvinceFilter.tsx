import { useState, useRef, useEffect } from 'react'
import { MapPin, Check, ChevronDown } from 'lucide-react'
import {
  useSettingsStore,
  PROVINCES,
  PROVINCE_COLORS,
  type Province,
  getDistrictsForProvince,
} from '../../store/slices/settingsSlice'

export function ProvinceFilter() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const {
    selectedProvinces,
    isProvinceFilterEnabled,
    toggleProvince,
    selectAllProvinces,
    getFilterLabel,
  } = useSettingsStore()

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filterLabel = getFilterLabel()
  const isFiltered = isProvinceFilterEnabled && selectedProvinces.length < PROVINCES.length

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
          transition-colors border
          ${
            isFiltered
              ? 'bg-osint-accent/10 border-osint-accent/30 text-osint-accent'
              : 'bg-osint-surface border-osint-border text-osint-text-secondary hover:text-osint-text hover:border-osint-accent/30'
          }
        `}
      >
        <MapPin size={14} />
        <span className="hidden sm:inline">{filterLabel}</span>
        <ChevronDown
          size={12}
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-osint-card border border-osint-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-osint-border bg-osint-surface/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-osint-text">Province Filter</span>
              <button
                onClick={selectAllProvinces}
                className="text-[10px] text-osint-accent hover:underline"
              >
                Select All
              </button>
            </div>
            <p className="text-[10px] text-osint-muted mt-0.5">
              Filter map events by province
            </p>
          </div>

          {/* Province List */}
          <div className="max-h-72 overflow-y-auto py-1">
            {PROVINCES.map((province) => {
              const isSelected = selectedProvinces.includes(province)
              const districtCount = getDistrictsForProvince(province).length
              const color = PROVINCE_COLORS[province]

              return (
                <button
                  key={province}
                  onClick={() => toggleProvince(province)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 text-left
                    transition-colors
                    ${isSelected ? 'bg-osint-surface/50' : 'hover:bg-osint-surface/30'}
                  `}
                >
                  {/* Checkbox */}
                  <div
                    className={`
                      w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                      transition-colors
                      ${
                        isSelected
                          ? 'bg-osint-accent border-osint-accent'
                          : 'border-osint-border'
                      }
                    `}
                  >
                    {isSelected && <Check size={10} className="text-white" />}
                  </div>

                  {/* Province Color Indicator */}
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />

                  {/* Province Name and District Count */}
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-sm ${
                        isSelected ? 'text-osint-text' : 'text-osint-text-secondary'
                      }`}
                    >
                      {province}
                    </span>
                    <span className="text-[10px] text-osint-muted ml-1.5">
                      ({districtCount} districts)
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-osint-border bg-osint-surface/30">
            <div className="text-[10px] text-osint-muted">
              {selectedProvinces.length === PROVINCES.length ? (
                'Showing all provinces'
              ) : (
                <>
                  <span className="text-osint-accent font-medium">
                    {selectedProvinces.length}
                  </span>{' '}
                  of {PROVINCES.length} provinces selected
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
