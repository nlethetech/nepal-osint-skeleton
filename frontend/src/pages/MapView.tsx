/**
 * MapView - LiveUAMap-style intelligence map page
 * ================================================
 *
 * Production-grade map view featuring:
 * - Individual event markers with category icons
 * - District polygon boundaries (GeoJSON)
 * - Real-time WebSocket event streaming
 * - Category and severity filtering
 * - Timeline scrubbing with playback
 * - Event detail sidebars
 * - Full responsive design
 */

import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LiveUAMap } from '../components/map/LiveUAMap'
import type { MapEvent } from '../components/map/EventMarkersLayer'

// =============================================================================
// COMPONENT
// =============================================================================

export default function MapView() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Full screen state
  const [isFullScreen, setIsFullScreen] = useState(false)

  // Get selected event from URL params
  const selectedEventId = searchParams.get('event') || undefined
  const districtsParam = searchParams.get('districts') || undefined
  const initialDistricts = districtsParam
    ? districtsParam.split(',').map(s => decodeURIComponent(s.trim())).filter(Boolean)
    : undefined

  // Handle event selection - update URL
  const handleEventSelect = useCallback((event: MapEvent | null) => {
    if (event) {
      setSearchParams({ event: event.id })
    } else {
      setSearchParams({})
    }
  }, [setSearchParams])

  // Toggle fullscreen
  const handleFullScreenToggle = useCallback(() => {
    setIsFullScreen(prev => !prev)
  }, [])

  return (
    <div className={`h-full flex flex-col ${isFullScreen ? 'fixed inset-0 z-50 bg-osint-bg' : ''}`}>
      <LiveUAMap
        initialHours={6}
        initialDistricts={initialDistricts}
        enableRealtime={true}
        showFilters={true}
        showTimeline={true}
        showLiveFeed={true}
        selectedEventId={selectedEventId}
        onEventSelect={handleEventSelect}
        isFullScreen={isFullScreen}
        onFullScreenToggle={handleFullScreenToggle}
      />
    </div>
  )
}
