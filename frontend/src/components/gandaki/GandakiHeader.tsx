/**
 * GandakiHeader Component
 *
 * Clean, professional header for the Gandaki Province Dashboard.
 * Features scope dropdown (Gandaki/All Nepal) and time range selector.
 */

import { ChevronDown, MapPin, Home } from 'lucide-react'
import { useGandakiDashboardStore, type ViewScope } from '../../stores/gandakiDashboardStore'
import { TIME_RANGE_OPTIONS, type TimeRange } from '../../data/gandaki'
import { useNavigate } from 'react-router-dom'
import './GandakiHeader.css'

export function GandakiHeader() {
  const navigate = useNavigate()
  const { viewScope, setViewScope, timeRange, setTimeRange } = useGandakiDashboardStore()

  return (
    <header className="gandaki-header">
      <div className="gandaki-header-left">
        <button
          className="gandaki-home-btn"
          onClick={() => navigate('/')}
          title="Back to main dashboard"
        >
          <Home size={18} />
        </button>
        <div className="gandaki-header-title">
          <div className="gandaki-header-icon">
            <MapPin size={20} />
          </div>
          <div className="gandaki-header-text">
            <h1>Gandaki Province</h1>
            <span className="gandaki-header-subtitle">Provincial Dashboard</span>
          </div>
        </div>
      </div>

      <div className="gandaki-header-controls">
        {/* Scope Dropdown */}
        <div className="gandaki-dropdown">
          <label className="gandaki-dropdown-label">View</label>
          <div className="gandaki-select-wrapper">
            <select
              value={viewScope}
              onChange={(e) => setViewScope(e.target.value as ViewScope)}
              className="gandaki-select"
            >
              <option value="gandaki">Gandaki</option>
              <option value="all-nepal">All Nepal</option>
            </select>
            <ChevronDown size={14} className="gandaki-select-icon" />
          </div>
        </div>

        {/* Time Range Dropdown */}
        <div className="gandaki-dropdown">
          <label className="gandaki-dropdown-label">Period</label>
          <div className="gandaki-select-wrapper">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="gandaki-select"
            >
              {TIME_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="gandaki-select-icon" />
          </div>
        </div>
      </div>
    </header>
  )
}
