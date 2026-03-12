/**
 * GandakiDistrictList Component
 *
 * Simple scrollable list of 11 districts with news/event counts.
 * Click to select/filter other widgets.
 */

import { MapPin, Newspaper, AlertCircle } from 'lucide-react'
import { useGandakiDashboardStore } from '../../stores/gandakiDashboardStore'
import { GANDAKI_DISTRICT_DATA, type GandakiDistrict } from '../../data/gandaki'
import './GandakiDistrictList.css'

interface GandakiDistrictListProps {
  districtCounts?: Record<string, { news: number; events: number }>
}

export function GandakiDistrictList({ districtCounts = {} }: GandakiDistrictListProps) {
  const { selectedDistrict, selectDistrict } = useGandakiDashboardStore()

  const handleDistrictClick = (district: GandakiDistrict) => {
    if (selectedDistrict === district) {
      selectDistrict(null)
    } else {
      selectDistrict(district)
    }
  }

  // Sort districts alphabetically
  const sortedDistricts = [...GANDAKI_DISTRICT_DATA].sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  return (
    <div className="gandaki-district-list">
      <div className="gandaki-district-list-header">
        <h3>Districts</h3>
        <span className="gandaki-district-count">{GANDAKI_DISTRICT_DATA.length} districts</span>
      </div>

      <div className="gandaki-district-list-content">
        {sortedDistricts.map((district) => {
          const counts = districtCounts[district.name] || { news: 0, events: 0 }
          const isSelected = selectedDistrict === district.name
          const hasActivity = counts.news > 0 || counts.events > 0

          return (
            <button
              key={district.name}
              className={`gandaki-district-item ${isSelected ? 'selected' : ''} ${hasActivity ? 'has-activity' : ''}`}
              onClick={() => handleDistrictClick(district.name)}
            >
              <div className="gandaki-district-info">
                <span className="gandaki-district-name">{district.name}</span>
                <span className="gandaki-district-hq">{district.headquarters}</span>
              </div>
              <div className="gandaki-district-stats">
                {counts.news > 0 && (
                  <span className="gandaki-district-stat news">
                    <Newspaper size={12} />
                    {counts.news}
                  </span>
                )}
                {counts.events > 0 && (
                  <span className="gandaki-district-stat events">
                    <AlertCircle size={12} />
                    {counts.events}
                  </span>
                )}
                {!hasActivity && (
                  <span className="gandaki-district-stat empty">-</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {selectedDistrict && (
        <div className="gandaki-district-list-footer">
          <span>Filtered by: {selectedDistrict}</span>
          <button onClick={() => selectDistrict(null)}>Clear filter</button>
        </div>
      )}
    </div>
  )
}
