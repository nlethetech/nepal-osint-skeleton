import { useRef, useState, useCallback, useMemo, useEffect, ReactNode, lazy, Suspense } from 'react'
import { useCommandCenterStore, type PanelContentType } from '../../stores/commandCenterStore'
import { PanelFrame, PanelSelector } from './panels/PanelFrame'

// Panel content components - these will be lazy loaded
import { SituationalTab } from '../analyst-center/tabs/SituationalTab'
import { CollaborationTab } from '../analyst-center/tabs/CollaborationTab'
import { InvestigationTab } from '../analyst-center/tabs/InvestigationTab'

// Entity Intelligence components
import { EntityNetworkPanel as EntityNetworkGraph } from '../entity-intelligence/EntityNetworkPanel'
import { EntityProfilePanel as EntityProfile } from '../entity-intelligence/EntityProfilePanel'

// Map components
import { LayerControlPanel as LayerControl } from '../map/LayerControlPanel'
import { SatelliteImageryPanel } from '../map/SatelliteImageryPanel'
import type { SatelliteLayerType } from '../../api/earthEngine'

// Leaflet for interactive map
import { MapContainer, TileLayer, Circle, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Damage Assessment / PWTT Spatial Analysis
import { SpatialTab } from '../damage-assessment/tabs/SpatialTab'
import { listAssessments, runPWTTAnalysis, quickAnalyze, fetchThreePanelImage, type Assessment, type QuickAnalyzeResult, type ThreePanelImageParams } from '../../api/damageAssessment'

// Story feed
import { StoryFeed } from '../analyst-center/StoryFeed'
import { CaseBoardPanel } from '../analyst-center/CaseBoardPanel'
import { CaseInvestigationPanel } from '../cases/CaseInvestigationPanel'
import { VerificationQueuePanel } from '../analyst-center/VerificationQueuePanel'
import { ActivityStreamPanel } from '../analyst-center/ActivityStreamPanel'
import { LeaderboardPanel } from '../analyst-center/LeaderboardPanel'

// Map component
import { LiveUAMap } from '../map/LiveUAMap'

interface WorkspaceContainerProps {
  panel1Content?: ReactNode
  panel2Content?: ReactNode
}

// Default panel content renderer
function DefaultPanelContent({ type }: { type: PanelContentType }) {
  switch (type) {
    case 'story-feed':
      return (
        <div className="h-full flex flex-col">
          <StoryFeedPanel />
        </div>
      )
    case 'intel-map':
      return <IntelMapPanel />
    case 'case-board':
      return <CommandCenterCaseBoardPanel />
    case 'evidence-timeline':
      return <CommandCenterEvidenceTimelinePanel />
    case 'verification-queue':
      return <VerificationQueuePanel />
    case 'activity-stream':
      return <ActivityStreamPanel />
    case 'leaderboard':
      return <LeaderboardPanel />
    case 'damage-assessment':
      return <DamageAssessmentPanel />
    case 'spatial-analysis':
      return <SpatialAnalysisPanel />
    case 'pwtt-viewer':
      return <PWTTViewerPanel />
    case 'entity-network':
      return <EntityNetworkPanel />
    case 'mentions-feed':
      return <MentionsFeedPanel />
    case 'entity-profile':
      return <EntityProfilePanel />
    case 'layer-control':
      return <LayerControlPanel />
    default:
      return (
        <div className="flex items-center justify-center h-full text-[var(--pro-text-muted)]">
          Panel content not available
        </div>
      )
  }
}

export function WorkspaceContainer({ panel1Content, panel2Content }: WorkspaceContainerProps) {
  const {
    panel1,
    panel2,
    splitRatio,
    isSinglePanelMode,
    setSplitRatio,
    setPanel1Content,
    setPanel2Content,
    isLoading,
    refreshAll,
  } = useCommandCenterStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return

    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const newRatio = (e.clientX - rect.left) / rect.width

    setSplitRatio(newRatio)
  }, [isDragging, setSplitRatio])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Add global mouse listeners when dragging
  useState(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  })

  if (isSinglePanelMode) {
    return (
      <div className="h-full p-2">
        <PanelFrame
          title={panel1.title}
          contentType={panel1.content}
          isLoading={isLoading}
          onRefresh={refreshAll}
          headerActions={
            <PanelSelector
              currentContent={panel1.content}
              onSelect={setPanel1Content}
            />
          }
        >
          {panel1Content || <DefaultPanelContent type={panel1.content} />}
        </PanelFrame>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="flex h-full p-2 gap-2"
      onMouseMove={isDragging ? (e) => handleMouseMove(e.nativeEvent) : undefined}
      onMouseUp={isDragging ? handleMouseUp : undefined}
      onMouseLeave={isDragging ? handleMouseUp : undefined}
    >
      {/* Panel 1 */}
      <div style={{ width: `${splitRatio * 100}%` }} className="min-w-0">
        <PanelFrame
          title={panel1.title}
          contentType={panel1.content}
          isLoading={isLoading}
          onRefresh={refreshAll}
          headerActions={
            <PanelSelector
              currentContent={panel1.content}
              onSelect={setPanel1Content}
            />
          }
        >
          {panel1Content || <DefaultPanelContent type={panel1.content} />}
        </PanelFrame>
      </div>

      {/* Resizer */}
      <div
        className={`
          w-1 cursor-col-resize hover:bg-[var(--pro-accent)] transition-colors rounded
          ${isDragging ? 'bg-[var(--pro-accent)]' : 'bg-transparent hover:bg-[var(--pro-border-subtle)]'}
        `}
        onMouseDown={handleMouseDown}
      />

      {/* Panel 2 */}
      <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="min-w-0">
        <PanelFrame
          title={panel2.title}
          contentType={panel2.content}
          isLoading={isLoading}
          onRefresh={refreshAll}
          headerActions={
            <PanelSelector
              currentContent={panel2.content}
              onSelect={setPanel2Content}
            />
          }
        >
          {panel2Content || <DefaultPanelContent type={panel2.content} />}
        </PanelFrame>
      </div>
    </div>
  )
}

// Placeholder panel components - these will be replaced with actual implementations
function StoryFeedPanel() {
  const {
    stories,
    selectedStoryId,
    selectStory,
    currentPage,
    pageSize,
    totalStories,
    setPage,
    isLoading,
    setWorkspaceMode,
    setShowNewCaseModal,
    setNewCaseLinkedClusterId,
  } = useCommandCenterStore()

  return (
    <StoryFeed
      stories={stories}
      selectedStoryId={selectedStoryId}
      onSelectStory={selectStory}
      onCreateCaseFromCluster={(clusterId) => {
        setWorkspaceMode('investigation')
        setNewCaseLinkedClusterId(clusterId)
        setShowNewCaseModal(true)
      }}
      isLoading={isLoading}
      currentPage={currentPage}
      pageSize={pageSize}
      totalStories={totalStories}
      onPageChange={setPage}
    />
  )
}

function IntelMapPanel() {
  const { filters, selectStory } = useCommandCenterStore()

  const handleEventSelect = useCallback((event: any) => {
    if (event?.id) {
      selectStory(event.id)
    }
  }, [selectStory])

  return (
    <div className="h-full">
      <LiveUAMap
        initialHours={filters.hours}
        enableRealtime={true}
        showFilters={true}
        showTimeline={true}
        showLiveFeed={false}
        onEventSelect={handleEventSelect}
      />
    </div>
  )
}

function CommandCenterCaseBoardPanel() {
  const {
    selectedCaseId,
    selectCase,
    showNewCaseModal,
    setShowNewCaseModal,
    newCaseLinkedClusterId,
  } = useCommandCenterStore()

  return (
    <CaseBoardPanel
      selectedCaseId={selectedCaseId}
      onSelectCase={(id) => selectCase(id)}
      onRequestNewCase={() => setShowNewCaseModal(true)}
      newCaseModalOpen={showNewCaseModal}
      onNewCaseModalOpenChange={setShowNewCaseModal}
      newCaseLinkedClusterId={newCaseLinkedClusterId}
    />
  )
}

function CommandCenterEvidenceTimelinePanel() {
  const { selectedCaseId, selectCase } = useCommandCenterStore()

  if (!selectedCaseId) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-sm text-[var(--pro-text-muted)]">Select a case</div>
          <div className="text-xs text-[var(--pro-text-disabled)] mt-1">
            Choose a case from Case Board to view evidence, comments, and publish workflow.
          </div>
        </div>
      </div>
    )
  }

  return (
    <CaseInvestigationPanel
      caseId={selectedCaseId}
      onCloseCase={() => selectCase(null)}
    />
  )
}

function DamageAssessmentPanel() {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRunningAnalysis, setIsRunningAnalysis] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch assessments on mount
  useEffect(() => {
    const fetchAssessments = async () => {
      try {
        setIsLoading(true)
        const result = await listAssessments({ limit: 50 })
        setAssessments(result.items)
        // Auto-select most recent assessment if available
        if (result.items.length > 0) {
          setSelectedAssessment(result.items[0])
        }
      } catch (err) {
        console.error('Failed to fetch assessments:', err)
        setError('Failed to load assessments')
      } finally {
        setIsLoading(false)
      }
    }
    fetchAssessments()
  }, [])

  const handleRunAnalysis = async () => {
    if (!selectedAssessment) return
    setIsRunningAnalysis(true)
    try {
      await runPWTTAnalysis(selectedAssessment.id)
      // Refresh assessment list to get updated data
      const result = await listAssessments({ limit: 50 })
      setAssessments(result.items)
      const updated = result.items.find(a => a.id === selectedAssessment.id)
      if (updated) setSelectedAssessment(updated)
    } catch (err) {
      console.error('PWTT analysis failed:', err)
    } finally {
      setIsRunningAnalysis(false)
    }
  }

  // If we have a selected assessment, show the SpatialTab
  if (selectedAssessment) {
    return (
      <div className="h-full flex flex-col bg-[var(--pro-bg-base)]">
        {/* Assessment Selector */}
        <div className="flex-shrink-0 px-3 py-2 border-b border-[var(--pro-border)] bg-[var(--pro-bg-elevated)]">
          <div className="flex items-center gap-2">
            <select
              value={selectedAssessment.id}
              onChange={(e) => {
                const assessment = assessments.find(a => a.id === e.target.value)
                if (assessment) setSelectedAssessment(assessment)
              }}
              className="flex-1 px-2 py-1.5 text-xs bg-[var(--pro-bg-base)] border border-[var(--pro-border)] rounded text-[var(--pro-text)] focus:outline-none focus:border-[var(--pro-accent)]"
            >
              {assessments.map(a => (
                <option key={a.id} value={a.id}>
                  {a.event_name} ({new Date(a.event_date).toLocaleDateString()})
                </option>
              ))}
            </select>
            <button
              onClick={() => setSelectedAssessment(null)}
              className="px-2 py-1.5 text-xs text-[var(--pro-text-muted)] hover:text-[var(--pro-text)] hover:bg-[var(--pro-bg-hover)] rounded transition-colors"
            >
              List
            </button>
          </div>
        </div>
        {/* SpatialTab with PWTT Analysis */}
        <div className="flex-1 overflow-hidden">
          <SpatialTab
            assessment={selectedAssessment}
            onRunAnalysis={handleRunAnalysis}
            isRunningAnalysis={isRunningAnalysis}
          />
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--pro-bg-base)]">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-[var(--pro-accent)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <div className="text-xs text-[var(--pro-text-muted)]">Loading assessments...</div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-[var(--pro-bg-base)]">
        <div className="text-center p-4">
          <div className="text-xs text-[var(--pro-text-critical)] mb-2">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-[var(--pro-accent)] hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Assessment list / empty state
  return (
    <div className="h-full overflow-y-auto bg-[var(--pro-bg-base)] p-4">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-[var(--pro-text)] mb-1">PWTT Damage Assessments</h3>
        <p className="text-xs text-[var(--pro-text-muted)]">
          Pixel-wise T-test satellite damage analysis using Sentinel-1 SAR
        </p>
      </div>

      {assessments.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-xs text-[var(--pro-text-muted)] mb-4">
            No damage assessments found
          </div>
          <p className="text-xs text-[var(--pro-text-disabled)]">
            Create an assessment from the Damage Assessment page to begin PWTT analysis
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assessments.map(assessment => (
            <button
              key={assessment.id}
              onClick={() => setSelectedAssessment(assessment)}
              className="w-full p-3 text-left bg-[var(--pro-bg-elevated)] hover:bg-[var(--pro-bg-hover)] border border-[var(--pro-border)] rounded-lg transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-[var(--pro-text)]">
                    {assessment.event_name}
                  </div>
                  <div className="text-xs text-[var(--pro-text-muted)] mt-0.5">
                    {assessment.event_type} • {new Date(assessment.event_date).toLocaleDateString()}
                  </div>
                </div>
                <span className={`px-1.5 py-0.5 text-xs rounded ${
                  assessment.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                  assessment.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {assessment.status}
                </span>
              </div>
              {assessment.damage_percentage !== undefined && (
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="text-[var(--pro-text-critical)]">
                    {assessment.damage_percentage.toFixed(1)}% damaged
                  </span>
                  {assessment.confidence_score && (
                    <span className="text-[var(--pro-text-muted)]">
                      {(assessment.confidence_score * 100).toFixed(0)}% confidence
                    </span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EntityNetworkPanel() {
  const { selectedEntityId } = useCommandCenterStore()

  return (
    <div className="h-full">
      <EntityNetworkGraph
        entityId={selectedEntityId || undefined}
        onNodeClick={(entityId) => {
          useCommandCenterStore.getState().selectEntity(entityId)
        }}
      />
    </div>
  )
}

function MentionsFeedPanel() {
  const { keyActors } = useCommandCenterStore()

  return (
    <div className="h-full p-4">
      <div className="text-[var(--pro-text-muted)] text-sm">Mentions Feed</div>
      <div className="text-[var(--pro-text-disabled)] text-xs mt-1">
        {keyActors.length} actors tracked
      </div>
    </div>
  )
}

function EntityProfilePanel() {
  const { selectedEntityId } = useCommandCenterStore()

  if (!selectedEntityId) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-[var(--pro-text-muted)] text-sm">Entity Profile</div>
          <div className="text-[var(--pro-text-disabled)] text-xs mt-1">
            Select an entity to view profile
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full">
      <EntityProfile
        entityId={selectedEntityId}
        onEntityClick={(id) => useCommandCenterStore.getState().selectEntity(id)}
      />
    </div>
  )
}

function LayerControlPanel() {
  return (
    <div className="h-full">
      <LayerControl />
    </div>
  )
}

// Map click handler component
function HotspotMapClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onLocationSelect(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Component to fly to location when it changes
function FlyToLocation({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([lat, lng], map.getZoom(), { duration: 0.5 })
  }, [map, lat, lng])
  return null
}

// PWTT Spatial Analysis Panel - Interactive Map Hotspot Checker
function SpatialAnalysisPanel() {
  // Shared PWTT state from store
  const { pwtt, setPwttParams, setPwttImageUrl, setPwttGenerating, setPwttError } = useCommandCenterStore()

  // Local state
  const [centerLat, setCenterLat] = useState<number>(pwtt.params?.centerLat || 27.7172)
  const [centerLng, setCenterLng] = useState<number>(pwtt.params?.centerLng || 85.324)
  const [radiusKm, setRadiusKm] = useState<number>(pwtt.params?.radiusKm || 1.0)
  const [eventDate, setEventDate] = useState<string>(pwtt.params?.eventDate || new Date().toISOString().split('T')[0])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<QuickAnalyzeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showResults, setShowResults] = useState(false)

  // Satellite tile URL
  const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

  const handleLocationSelect = useCallback((lat: number, lng: number) => {
    setCenterLat(lat)
    setCenterLng(lng)
    setResult(null)
    setShowResults(false)
  }, [])

  const handleQuickAnalyze = async () => {
    setIsAnalyzing(true)
    setError(null)
    setResult(null)

    // Update shared state
    const params = { centerLat, centerLng, radiusKm, eventDate }
    setPwttParams(params)
    setPwttGenerating(true)

    try {
      // Run quick analyze for stats
      const res = await quickAnalyze({
        center_lat: centerLat,
        center_lng: centerLng,
        radius_km: radiusKm,
        event_date: eventDate,
        baseline_days: 365,
        post_event_days: 60,
      })
      setResult(res)
      setShowResults(true)

      // Also fetch three-panel image for the viewer panel
      try {
        const blob = await fetchThreePanelImage({
          center_lat: centerLat,
          center_lng: centerLng,
          radius_km: radiusKm,
          event_date: eventDate,
          baseline_days: 365,
          post_event_days: 60,
        })
        const url = URL.createObjectURL(blob)
        setPwttImageUrl(url)
      } catch (imgErr: any) {
        console.error('Three-panel image generation failed:', imgErr)
        // Set error state so user knows why image isn't showing
        const errMsg = imgErr.response?.data?.detail || imgErr.message || 'Three-panel image generation failed'
        setPwttError(errMsg)
      }
    } catch (err: any) {
      console.error('Quick analysis failed:', err)
      const errMsg = err.response?.data?.detail || err.message || 'Analysis failed'
      setError(errMsg)
      setPwttError(errMsg)
    } finally {
      setIsAnalyzing(false)
      setPwttGenerating(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-[var(--pro-bg-base)]">
      {/* Map Container */}
      <div className="flex-1 relative">
        <MapContainer
          center={[centerLat, centerLng]}
          zoom={14}
          className="h-full w-full"
          zoomControl={false}
        >
          {/* Satellite Imagery Base Layer */}
          <TileLayer
            url={SATELLITE_URL}
            attribution="Esri, Maxar, Earthstar Geographics"
            maxZoom={18}
          />

          {/* Click handler */}
          <HotspotMapClickHandler onLocationSelect={handleLocationSelect} />

          {/* Fly to location */}
          <FlyToLocation lat={centerLat} lng={centerLng} />

          {/* Radius Circle */}
          <Circle
            center={[centerLat, centerLng]}
            radius={radiusKm * 1000}
            pathOptions={{
              color: '#f97316',
              fillColor: '#f97316',
              fillOpacity: 0.15,
              weight: 2,
              dashArray: '8, 4',
            }}
          />

          {/* Center marker */}
          <Circle
            center={[centerLat, centerLng]}
            radius={50}
            pathOptions={{
              color: '#ef4444',
              fillColor: '#ef4444',
              fillOpacity: 0.8,
              weight: 2,
            }}
          />

          {/* Result damage overlay if available */}
          {result?.damage_tile_url && (
            <TileLayer
              url={result.damage_tile_url}
              opacity={0.7}
            />
          )}
        </MapContainer>

        {/* Map Instructions Overlay */}
        <div className="absolute top-3 left-3 right-3 z-[1000] pointer-events-none">
          <div className="bg-black/70 backdrop-blur-sm text-white px-3 py-2 rounded-lg text-xs inline-block pointer-events-auto">
            Click map to set hotspot location
          </div>
        </div>

        {/* Coordinates Display */}
        <div className="absolute bottom-3 left-3 z-[1000] bg-black/70 backdrop-blur-sm text-white px-3 py-2 rounded-lg text-xs font-mono">
          {centerLat.toFixed(5)}, {centerLng.toFixed(5)}
        </div>

        {/* Results Panel (slides up from bottom) */}
        {showResults && result && (
          <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-[var(--pro-bg-surface)]/95 backdrop-blur-sm border-t border-[var(--pro-border)] p-4 max-h-[50%] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-[var(--pro-text)]">PWTT Analysis Results</h4>
              <button
                onClick={() => setShowResults(false)}
                className="text-[var(--pro-text-muted)] hover:text-[var(--pro-text)] text-xs"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 text-xs mb-3">
              <div className="p-2 bg-[var(--pro-bg-elevated)] rounded text-center">
                <div className="text-[var(--pro-text-muted)] text-[10px]">Damage</div>
                <div className={`font-bold ${result.damage_percentage > 5 ? 'text-red-400' : 'text-green-400'}`}>
                  {result.damage_percentage.toFixed(1)}%
                </div>
              </div>
              <div className="p-2 bg-[var(--pro-bg-elevated)] rounded text-center">
                <div className="text-[var(--pro-text-muted)] text-[10px]">Area</div>
                <div className="text-[var(--pro-text)] font-medium">{result.total_area_km2.toFixed(2)} km²</div>
              </div>
              <div className="p-2 bg-[var(--pro-bg-elevated)] rounded text-center">
                <div className="text-[var(--pro-text-muted)] text-[10px]">Confidence</div>
                <div className="text-[var(--pro-text)] font-medium">{(result.confidence_score * 100).toFixed(0)}%</div>
              </div>
              <div className="p-2 bg-[var(--pro-bg-elevated)] rounded text-center">
                <div className="text-[var(--pro-text-muted)] text-[10px]">Images</div>
                <div className="text-[var(--pro-text)] font-medium">{result.baseline_images_count}+{result.post_images_count}</div>
              </div>
            </div>

            {/* Severity breakdown */}
            <div className="flex gap-2 text-[10px]">
              <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">
                Critical: {result.critical_area_km2.toFixed(4)} km²
              </span>
              <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">
                Severe: {result.severe_area_km2.toFixed(4)} km²
              </span>
              <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                Moderate: {result.moderate_area_km2.toFixed(4)} km²
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Controls Panel */}
      <div className="flex-shrink-0 border-t border-[var(--pro-border)] bg-[var(--pro-bg-elevated)] p-3">
        <div className="flex items-center gap-3">
          {/* Radius Slider */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-[var(--pro-text-muted)]">Radius</label>
              <span className="text-[10px] text-[var(--pro-text)] font-medium">{radiusKm.toFixed(1)} km</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={radiusKm}
              onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-[var(--pro-bg-base)] rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
          </div>

          {/* Date Picker */}
          <div className="w-32">
            <label className="block text-[10px] text-[var(--pro-text-muted)] mb-1">Event Date</label>
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full px-2 py-1 text-xs bg-[var(--pro-bg-base)] border border-[var(--pro-border)] rounded text-[var(--pro-text)] focus:outline-none focus:border-[var(--pro-accent)]"
            />
          </div>

          {/* Analyze Button */}
          <div className="w-32">
            <label className="block text-[10px] text-transparent mb-1">Action</label>
            <button
              onClick={handleQuickAnalyze}
              disabled={isAnalyzing}
              className="w-full py-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5"
            >
              {isAnalyzing ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Run PWTT'
              )}
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

// PWTT Three-Panel Viewer - Displays Pre/Post/PWTT comparison image from shared state
function PWTTViewerPanel() {
  // Get shared PWTT state from store
  const { pwtt } = useCommandCenterStore()

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Image Display Area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden p-4">
        {pwtt.imageUrl ? (
          <img
            src={pwtt.imageUrl}
            alt="PWTT Three-Panel Analysis"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <div className="text-center p-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-500/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-[var(--pro-text)] text-sm font-medium mb-2">
              PWTT Three-Panel Viewer
            </div>
            <div className="text-[var(--pro-text-muted)] text-xs mb-1">
              Pre Destruction | Post Destruction | PWTT Heatmap
            </div>
            <div className="text-[var(--pro-text-disabled)] text-[10px] mt-4">
              Run PWTT analysis in the right panel to generate image
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {pwtt.isGenerating && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
              <div className="text-white text-sm font-medium">Generating PWTT Analysis...</div>
              <div className="text-white/50 text-xs mt-2">Processing Sentinel-1 SAR imagery</div>
              {pwtt.params && (
                <div className="text-white/40 text-[10px] mt-3 font-mono">
                  {pwtt.params.centerLat.toFixed(4)}, {pwtt.params.centerLng.toFixed(4)} | {pwtt.params.radiusKm} km
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Info Bar */}
      {pwtt.params && pwtt.imageUrl && (
        <div className="flex-shrink-0 border-t border-[var(--pro-border)] bg-[var(--pro-bg-elevated)] px-4 py-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-4 text-[var(--pro-text-muted)]">
              <span className="font-mono">{pwtt.params.centerLat.toFixed(4)}, {pwtt.params.centerLng.toFixed(4)}</span>
              <span>Radius: {pwtt.params.radiusKm} km</span>
              <span>Date: {pwtt.params.eventDate}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-[10px]">
                Generated
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {pwtt.error && (
        <div className="flex-shrink-0 border-t border-red-500/30 bg-red-500/10 px-4 py-2">
          <div className="text-xs text-red-400">{pwtt.error}</div>
        </div>
      )}
    </div>
  )
}
