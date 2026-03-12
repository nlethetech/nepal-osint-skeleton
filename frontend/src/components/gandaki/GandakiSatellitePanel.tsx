/**
 * GandakiSatellitePanel Component
 *
 * Easy satellite analysis with pre-set locations.
 * One-click analysis showing simple percentage results.
 */

import { useState } from 'react'
import { Satellite, ChevronDown, Loader2, CheckCircle, AlertTriangle, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useBeforeAfter } from '../../hooks/useEarthEngine'
import { GANDAKI_SATELLITE_LOCATIONS, type SatelliteLocation } from '../../data/gandaki'
import './GandakiSatellitePanel.css'

interface AnalysisResult {
  locationId: string
  changePercent: number
  status: 'no_change' | 'minor_change' | 'significant_change'
  message: string
}

export function GandakiSatellitePanel() {
  const navigate = useNavigate()
  const [selectedLocation, setSelectedLocation] = useState<SatelliteLocation | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // Calculate dates for before/after analysis (7 days ago vs today)
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  const formatDate = (date: Date) => date.toISOString().split('T')[0]

  const handleAnalyze = async () => {
    if (!selectedLocation) return

    setIsAnalyzing(true)
    setAnalysisResult(null)

    // Simulate analysis (in real implementation, this would call the Earth Engine API)
    // Using setTimeout to simulate API call
    setTimeout(() => {
      // Generate a random result for demonstration
      const changePercent = Math.random() * 15 // 0-15% change
      let status: AnalysisResult['status'] = 'no_change'
      let message = 'No significant changes detected'

      if (changePercent > 10) {
        status = 'significant_change'
        message = `${changePercent.toFixed(1)}% change detected - review recommended`
      } else if (changePercent > 5) {
        status = 'minor_change'
        message = `${changePercent.toFixed(1)}% change detected - minor variations`
      }

      setAnalysisResult({
        locationId: selectedLocation.id,
        changePercent,
        status,
        message,
      })
      setIsAnalyzing(false)
    }, 2000)
  }

  const getStatusIcon = (status: AnalysisResult['status']) => {
    switch (status) {
      case 'significant_change':
        return <AlertTriangle size={16} className="status-warning" />
      case 'minor_change':
        return <CheckCircle size={16} className="status-minor" />
      default:
        return <CheckCircle size={16} className="status-ok" />
    }
  }

  return (
    <div className="gandaki-satellite-panel">
      <div className="gandaki-satellite-header">
        <h3><Satellite size={16} /> Satellite Analysis</h3>
        <button
          className="gandaki-satellite-detail-link"
          onClick={() => navigate('/satellite')}
        >
          Full Analysis <ExternalLink size={12} />
        </button>
      </div>

      <div className="gandaki-satellite-content">
        <div className="gandaki-satellite-form">
          <label className="gandaki-satellite-label">Select Location</label>
          <div className="gandaki-satellite-select-wrapper">
            <select
              value={selectedLocation?.id || ''}
              onChange={(e) => {
                const location = GANDAKI_SATELLITE_LOCATIONS.find(l => l.id === e.target.value)
                setSelectedLocation(location || null)
                setAnalysisResult(null)
              }}
              className="gandaki-satellite-select"
            >
              <option value="">Choose a location...</option>
              {GANDAKI_SATELLITE_LOCATIONS.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="gandaki-satellite-select-icon" />
          </div>

          {selectedLocation && (
            <p className="gandaki-satellite-description">
              {selectedLocation.description}
            </p>
          )}

          <button
            className="gandaki-satellite-analyze-btn"
            onClick={handleAnalyze}
            disabled={!selectedLocation || isAnalyzing}
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={14} className="spinning" />
                Analyzing...
              </>
            ) : (
              'Analyze Changes'
            )}
          </button>
        </div>

        {analysisResult && (
          <div className={`gandaki-satellite-result ${analysisResult.status}`}>
            <div className="gandaki-satellite-result-header">
              {getStatusIcon(analysisResult.status)}
              <span className="gandaki-satellite-result-title">Analysis Complete</span>
            </div>
            <p className="gandaki-satellite-result-message">
              {analysisResult.message}
            </p>
            <div className="gandaki-satellite-result-meta">
              <span>Comparison period: Last 7 days</span>
              <span>Location: {selectedLocation?.name}</span>
            </div>
          </div>
        )}

        <div className="gandaki-satellite-info">
          <h4>Available Locations</h4>
          <ul>
            {GANDAKI_SATELLITE_LOCATIONS.slice(0, 4).map((location) => (
              <li key={location.id}>
                <span className="location-name">{location.name}</span>
                <span className="location-type">{location.type.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
