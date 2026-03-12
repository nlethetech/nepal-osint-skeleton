/**
 * GandakiDashboard Page
 *
 * Provincial dashboard for Gandaki Province administration.
 * Clean, professional, easy to navigate with focus on monitoring
 * news, events, weather, and satellite imagery.
 */

import { useState, useCallback } from 'react'
import {
  GandakiHeader,
  GandakiSummaryCards,
  GandakiMapWidget,
  GandakiDistrictList,
  GandakiNewsFeed,
  GandakiEventsPanel,
  GandakiSatellitePanel,
  GandakiWeatherPanel,
} from '../components/gandaki'
import { useGandakiDashboardStore } from '../stores/gandakiDashboardStore'
import './GandakiDashboard.css'

export default function GandakiDashboard() {
  const { selectedDistrict, isMapExpanded } = useGandakiDashboardStore()
  const [newsCount, setNewsCount] = useState(0)
  const [eventsCount, setEventsCount] = useState(0)

  // Track counts for summary cards
  const handleNewsCountChange = useCallback((count: number) => {
    setNewsCount(count)
  }, [])

  const handleEventsCountChange = useCallback((count: number) => {
    setEventsCount(count)
  }, [])

  // Placeholder district counts (in real implementation, derive from data)
  const districtCounts: Record<string, { news: number; events: number }> = {}

  return (
    <div className="gandaki-dashboard">
      {/* Header */}
      <GandakiHeader />

      {/* Summary Cards */}
      <GandakiSummaryCards newsCount={newsCount} eventsCount={eventsCount} />

      {/* Main Content */}
      <main className="gandaki-dashboard-main">
        {/* Row 1: Map and District List */}
        <div className="gandaki-row gandaki-row-map">
          <div className="gandaki-col gandaki-col-8">
            <GandakiMapWidget districtCounts={districtCounts} />
          </div>
          <div className="gandaki-col gandaki-col-4">
            <GandakiDistrictList districtCounts={districtCounts} />
          </div>
        </div>

        {/* Row 2: News Feed and Events */}
        <div className="gandaki-row">
          <div className="gandaki-col gandaki-col-6">
            <GandakiNewsFeed onNewsCountChange={handleNewsCountChange} />
          </div>
          <div className="gandaki-col gandaki-col-6">
            <GandakiEventsPanel onEventsCountChange={handleEventsCountChange} />
          </div>
        </div>

        {/* Row 3: Satellite and Weather */}
        <div className="gandaki-row">
          <div className="gandaki-col gandaki-col-6">
            <GandakiSatellitePanel />
          </div>
          <div className="gandaki-col gandaki-col-6">
            <GandakiWeatherPanel />
          </div>
        </div>
      </main>

      {/* Map expanded overlay */}
      {isMapExpanded && <div className="gandaki-overlay" />}
    </div>
  )
}
