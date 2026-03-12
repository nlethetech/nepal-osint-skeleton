/**
 * Nepal OSINT Platform - ML Analysis Dashboard
 * Interactive text analysis with NER, events, scoring
 *
 * ENHANCED with:
 * - NATO Admiralty confidence ratings (A1-F6)
 * - Multi-model ensemble voting consensus
 * - Deception detection for social media
 * - Corroboration status for high-severity events
 */
import { useState, useEffect } from 'react'
import {
  Brain,
  Zap,
  Users,
  Calendar,
  TrendingUp,
  AlertTriangle,
  Activity,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  BarChart3,
  Shield
} from 'lucide-react'
import { analysisApi, PipelineResponse, MLStatus, ClusterInfo, AnomalyAlert, LLMAnalyzeResponse, LLMStatus } from '../api/analysis'
import { Badge } from '../components/common/Badge'
import {
  AdmiraltyBadge,
  DeceptionWarning,
  CorroborationBadge,
} from '../components/common/AdmiraltyBadge'

// Entity type colors
const entityColors: Record<string, string> = {
  PERSON: 'bg-blue-100 text-blue-800 border-blue-300',
  ORG: 'bg-green-100 text-green-800 border-green-300',
  GPE: 'bg-purple-100 text-purple-800 border-purple-300',
  LOC: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  EVENT: 'bg-red-100 text-red-800 border-red-300',
  DATE: 'bg-gray-100 text-gray-800 border-gray-300'
}

// Severity colors
const severityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500'
}

export default function Analysis() {
  const [text, setText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<PipelineResponse | null>(null)
  const [llmResults, setLlmResults] = useState<LLMAnalyzeResponse | null>(null)
  const [mlStatus, setMlStatus] = useState<MLStatus | null>(null)
  const [llmStatus, setLlmStatus] = useState<LLMStatus | null>(null)
  const [clusters, setClusters] = useState<ClusterInfo[]>([])
  const [anomalies, setAnomalies] = useState<AnomalyAlert[]>([])
  const [activeTab, setActiveTab] = useState<'analyze' | 'clusters' | 'anomalies'>('analyze')
  const [useLLM, setUseLLM] = useState(true) // Default to LLM analysis
  const [error, setError] = useState<string | null>(null)

  // Fetch ML and LLM status on mount
  useEffect(() => {
    fetchStatus()
    fetchLLMStatus()
    fetchClusters()
    fetchAnomalies()
  }, [])

  const fetchStatus = async () => {
    try {
      const status = await analysisApi.getStatus()
      setMlStatus(status)
    } catch (err) {
      console.error('Failed to fetch ML status:', err)
    }
  }

  const fetchLLMStatus = async () => {
    try {
      const status = await analysisApi.getLLMStatus()
      setLlmStatus(status)
      // Auto-enable LLM if available
      if (status.available) {
        setUseLLM(true)
      }
    } catch (err) {
      console.error('Failed to fetch LLM status:', err)
      setUseLLM(false)
    }
  }

  const fetchClusters = async () => {
    try {
      const response = await analysisApi.getClusters(72)
      setClusters(response.clusters)
    } catch (err) {
      console.error('Failed to fetch clusters:', err)
    }
  }

  const fetchAnomalies = async () => {
    try {
      const response = await analysisApi.getAnomalies(24)
      setAnomalies(response.anomalies)
    } catch (err) {
      console.error('Failed to fetch anomalies:', err)
    }
  }

  const runAnalysis = async () => {
    if (!text.trim()) return
    setAnalyzing(true)
    setError(null)
    setResults(null)
    setLlmResults(null)

    try {
      if (useLLM && llmStatus?.available) {
        // Use LLM-powered analysis (Palantir-grade)
        const response = await analysisApi.runLLMAnalysis({
          text,
          include_threats: true,
          include_brief: false
        })
        setLlmResults(response)
      } else {
        // Fallback to basic ML pipeline
        const response = await analysisApi.runPipeline({
          text,
          run_ner: true,
          run_events: true,
          run_scoring: true
        })
        setResults(response)
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-600" />
              ML Analysis Pipeline
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              NER, Event Extraction, Impact Scoring, Clustering, Anomaly Detection
            </p>
          </div>

          {/* LLM & ML Status */}
          <div className="flex items-center gap-4">
            {/* LLM Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseLLM(!useLLM)}
                disabled={!llmStatus?.available}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  useLLM && llmStatus?.available ? 'bg-purple-600' : 'bg-gray-300'
                } ${!llmStatus?.available ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    useLLM && llmStatus?.available ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-gray-700">
                {useLLM && llmStatus?.available ? 'LLM Mode' : 'Basic ML'}
              </span>
            </div>

            {/* LLM Status */}
            {llmStatus && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100">
                {llmStatus.available ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
                <span className="text-xs text-gray-600">
                  {llmStatus.available ? `Ollama (${llmStatus.model})` : 'LLM Offline'}
                </span>
              </div>
            )}

            {/* ML Status */}
            {mlStatus && (
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {Object.entries(mlStatus.components).map(([name, available]) => (
                    <div
                      key={name}
                      className={`w-2 h-2 rounded-full ${available ? 'bg-green-500' : 'bg-red-500'}`}
                      title={name}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mt-4">
          <button
            onClick={() => setActiveTab('analyze')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'analyze'
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <Zap className="w-4 h-4 inline mr-2" />
            Analyze Text
          </button>
          <button
            onClick={() => setActiveTab('clusters')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'clusters'
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <BarChart3 className="w-4 h-4 inline mr-2" />
            Story Clusters
            {clusters.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-purple-200 text-purple-800 text-xs rounded-full">
                {clusters.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('anomalies')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              activeTab === 'anomalies'
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            Anomalies
            {anomalies.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-red-200 text-red-800 text-xs rounded-full">
                {anomalies.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Analyze Tab */}
        {activeTab === 'analyze' && (
          <div className="max-w-6xl mx-auto">
            {/* Input */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter text to analyze (English or Nepali)
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste news article, press release, or any text for analysis...

Example: The Ministry of Home Affairs announced today that three people were injured in a landslide near Sindhupalchok district. Nepal Police has been deployed to assist with rescue operations. The incident occurred following heavy rainfall in the region."
                className="w-full h-40 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-sm text-gray-500">
                  {text.length} characters
                </span>
                <button
                  onClick={runAnalysis}
                  disabled={analyzing || !text.trim()}
                  className="flex items-center gap-2 bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Analyze
                    </>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                {error}
              </div>
            )}

            {/* LLM Results (Palantir-grade) - ENHANCED */}
            {llmResults && (
              <div className="space-y-6">
                {/* Classification Header with Admiralty Rating */}
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg p-4 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold flex items-center gap-2">
                        <Brain className="w-5 h-5" />
                        LLM Intelligence Analysis
                      </h3>
                      <p className="text-purple-200 text-sm mt-1">
                        Powered by Ollama - Multi-Model Ensemble OSINT
                      </p>
                      {/* Ensemble Consensus Indicator */}
                      {llmResults.ensemble_used && (
                        <div className="flex items-center gap-2 mt-2 text-purple-100">
                          <Shield className="w-4 h-4" />
                          <span className="text-sm">
                            Consensus: {Math.round((llmResults.agreement_score || 0) * 100)}%
                            ({llmResults.models_participated?.length || 1} models)
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-3 mb-1">
                        <div className="text-2xl font-bold uppercase">
                          {llmResults.story_type || 'Unclassified'}
                        </div>
                        {/* Admiralty Rating Badge */}
                        {llmResults.admiralty_rating && (
                          <AdmiraltyBadge
                            rating={llmResults.admiralty_rating}
                            size="lg"
                            showTooltip={true}
                          />
                        )}
                      </div>
                      <div className="text-purple-200 text-sm">
                        {Math.round(llmResults.confidence * 100)}% confidence
                      </div>
                      {/* Corroboration Status */}
                      {llmResults.corroboration_status && (
                        <div className="mt-1">
                          <CorroborationBadge
                            status={llmResults.corroboration_status}
                            supportingCount={llmResults.supporting_sources || 0}
                            contradictingCount={llmResults.contradicting_sources || 0}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Deception Warning (for social media sources) */}
                {llmResults.deception_score && llmResults.deception_score >= 0.4 && (
                  <DeceptionWarning
                    score={llmResults.deception_score}
                    credibilityLevel={llmResults.credibility_level || 'unknown'}
                    redFlags={llmResults.deception_red_flags || []}
                  />
                )}

                <div className="grid grid-cols-2 gap-6">
                  {/* Entities */}
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <Users className="w-5 h-5 text-blue-600" />
                      Extracted Entities
                      <span className="ml-auto px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                        {llmResults.entities.length}
                      </span>
                    </h3>
                    {llmResults.entities.length > 0 ? (
                      <div className="space-y-2">
                        {llmResults.entities.map((entity, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                            <div>
                              <span className="font-medium text-gray-900">{entity.name}</span>
                              <span className={`ml-2 px-2 py-0.5 text-xs rounded ${entityColors[entity.type] || 'bg-gray-100 text-gray-700'}`}>
                                {entity.type}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500 capitalize">{entity.role}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No entities detected</p>
                    )}
                  </div>

                  {/* Events - ENHANCED with Admiralty ratings */}
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-orange-600" />
                      Extracted Events (5W1H)
                      <span className="ml-auto px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
                        {llmResults.events.length}
                      </span>
                    </h3>
                    {llmResults.events.length > 0 ? (
                      <div className="space-y-3">
                        {llmResults.events.map((event, i) => (
                          <div key={i} className="p-3 bg-gray-50 rounded-lg border-l-4 border-orange-400">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant={event.severity === 'critical' ? 'destructive' : event.severity === 'major' ? 'default' : 'secondary'}>
                                {event.type}
                              </Badge>
                              <Badge variant="outline">{event.severity}</Badge>
                              {/* Event-level Admiralty rating */}
                              {event.admiralty_rating && (
                                <AdmiraltyBadge
                                  rating={event.admiralty_rating}
                                  size="sm"
                                />
                              )}
                              {/* Corroboration badge for verified events */}
                              {event.corroboration_status && (
                                <CorroborationBadge
                                  status={event.corroboration_status}
                                  supportingCount={event.supporting_sources || 0}
                                />
                              )}
                              <span className="text-xs text-gray-500 ml-auto">
                                {Math.round(event.confidence * 100)}% conf
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 mb-2">{event.what || event.description}</p>
                            <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                              {event.where && <span>📍 {event.where}</span>}
                              {event.when && <span>🕐 {event.when}</span>}
                              {event.who && event.who.length > 0 && (
                                <span className="col-span-2">👥 {event.who.join(', ')}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No events detected</p>
                    )}
                  </div>
                </div>

                {/* Threat Assessment */}
                {llmResults.threat_assessment && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      Threat Assessment
                      <Badge
                        variant={
                          llmResults.threat_assessment.overall_threat_level === 'critical' ||
                          llmResults.threat_assessment.overall_threat_level === 'severe'
                            ? 'destructive'
                            : llmResults.threat_assessment.overall_threat_level === 'elevated' ||
                              llmResults.threat_assessment.overall_threat_level === 'high'
                              ? 'default'
                              : 'secondary'
                        }
                        className="ml-2"
                      >
                        {llmResults.threat_assessment.overall_threat_level.toUpperCase()}
                      </Badge>
                    </h3>

                    {/* Threat Dimensions */}
                    <div className="grid grid-cols-5 gap-3 mb-4">
                      {Object.entries(llmResults.threat_assessment.dimensions).map(([dim, data]) => (
                        <div key={dim} className="p-3 bg-gray-50 rounded-lg text-center">
                          <div className="text-xs text-gray-500 uppercase mb-1">{dim}</div>
                          <div className={`text-lg font-bold ${
                            data.level === 'critical' || data.level === 'severe' ? 'text-red-600' :
                            data.level === 'elevated' || data.level === 'high' ? 'text-orange-600' :
                            data.level === 'guarded' ? 'text-yellow-600' : 'text-green-600'
                          }`}>
                            {data.level.toUpperCase()}
                          </div>
                          <div className="text-xs text-gray-400">{data.trend}</div>
                        </div>
                      ))}
                    </div>

                    {/* Priority Alerts */}
                    {llmResults.threat_assessment.priority_alerts && llmResults.threat_assessment.priority_alerts.length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Priority Alerts</h4>
                        <div className="space-y-2">
                          {llmResults.threat_assessment.priority_alerts.map((alert, i) => (
                            <div key={i} className="flex items-start gap-2 p-2 bg-red-50 rounded border border-red-200">
                              <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-medium text-red-700 uppercase">{alert.dimension}</span>
                                <p className="text-sm text-gray-700">{alert.description}</p>
                              </div>
                              <Badge variant="outline" className="ml-auto text-xs">{alert.urgency}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommended Actions */}
                    {llmResults.threat_assessment.recommended_actions && llmResults.threat_assessment.recommended_actions.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Recommended Actions</h4>
                        <div className="space-y-1">
                          {llmResults.threat_assessment.recommended_actions.map((action, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                              <span className="text-gray-700">{action.action}</span>
                              <Badge variant="outline" className="ml-auto text-xs">{action.urgency}</Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Keywords and Themes */}
                {(llmResults.keywords.length > 0 || llmResults.themes.length > 0) && (
                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 mb-3">Keywords & Themes</h3>
                    <div className="flex flex-wrap gap-2">
                      {llmResults.keywords.map((kw, i) => (
                        <span key={i} className="px-2 py-1 bg-purple-100 text-purple-700 text-sm rounded">
                          {kw}
                        </span>
                      ))}
                      {llmResults.themes.map((theme, i) => (
                        <span key={i} className="px-2 py-1 bg-indigo-100 text-indigo-700 text-sm rounded">
                          #{theme}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Basic ML Results (Fallback) */}
            {results && !llmResults && (
              <div className="grid grid-cols-2 gap-6">
                {/* NER Results */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-blue-600" />
                    Named Entities
                    <span className="ml-auto text-xs text-gray-500">
                      {results.processing_time_ms.toFixed(0)}ms
                    </span>
                  </h3>
                  {results.entities && results.entities.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {results.entities.map((entity, i) => (
                        <span
                          key={i}
                          className={`px-3 py-1 rounded-full border text-sm ${entityColors[entity.entity_type] || 'bg-gray-100 text-gray-800'}`}
                        >
                          {entity.text}
                          <span className="ml-1 text-xs opacity-75">({entity.entity_type})</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No entities detected</p>
                  )}
                </div>

                {/* Event Results */}
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                    <Calendar className="w-5 h-5 text-orange-600" />
                    Extracted Events
                  </h3>
                  {results.events && results.events.length > 0 ? (
                    <div className="space-y-3">
                      {results.events.map((event, i) => (
                        <div key={i} className="p-3 bg-gray-50 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={event.severity === 'critical' ? 'destructive' : 'secondary'}>
                              {event.event_type}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              Confidence: {Math.round(event.confidence * 100)}%
                            </span>
                          </div>
                          <p className="text-sm text-gray-700">{event.what_happened}</p>
                          {event.where_location && (
                            <p className="text-xs text-gray-500 mt-1">📍 {event.where_location}</p>
                          )}
                          {event.who_involved.length > 0 && (
                            <p className="text-xs text-gray-500">👥 {event.who_involved.join(', ')}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No events detected</p>
                  )}
                </div>

                {/* Impact Score */}
                {results.impact_score && (
                  <div className="col-span-2 bg-white rounded-lg border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                      Impact Assessment
                    </h3>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="text-center p-4 bg-gray-50 rounded-lg">
                        <div className="text-3xl font-bold text-purple-600">
                          {Math.round(results.impact_score.overall_score * 100)}
                        </div>
                        <div className="text-sm text-gray-600">Overall Score</div>
                        <Badge variant="info" className="mt-2">{results.impact_score.priority}</Badge>
                      </div>

                      <div className="col-span-3">
                        <div className="grid grid-cols-3 gap-3">
                          {Object.entries(results.impact_score.dimensions).map(([dim, score]) => (
                            <div key={dim} className="flex items-center gap-2">
                              <div className="w-full">
                                <div className="flex justify-between text-sm mb-1">
                                  <span className="capitalize text-gray-600">{dim}</span>
                                  <span className="font-medium">{Math.round(score * 100)}</span>
                                </div>
                                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-purple-500 rounded-full"
                                    style={{ width: `${score * 100}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {results.impact_score.scoring_factors.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-gray-200">
                            <p className="text-sm font-medium text-gray-700 mb-2">Scoring Factors:</p>
                            <div className="flex flex-wrap gap-2">
                              {results.impact_score.scoring_factors.map((factor, i) => (
                                <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                                  {factor}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Clusters Tab */}
        {activeTab === 'clusters' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Story Clusters</h3>
                <button
                  onClick={fetchClusters}
                  className="text-sm text-purple-600 hover:text-purple-700"
                >
                  Refresh
                </button>
              </div>
              {clusters.length > 0 ? (
                <div className="space-y-4">
                  {clusters.map((cluster) => (
                    <div key={cluster.cluster_id} className="p-4 border border-gray-200 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">
                          Cluster {cluster.cluster_id.slice(0, 8)}
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge variant={cluster.trend === 'escalating' ? 'destructive' : 'secondary'}>
                            {cluster.trend}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            {cluster.document_count} docs
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {cluster.keywords.map((kw, i) => (
                          <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded">
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No clusters detected yet</p>
              )}
            </div>
          </div>
        )}

        {/* Anomalies Tab */}
        {activeTab === 'anomalies' && (
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Detected Anomalies</h3>
                <button
                  onClick={fetchAnomalies}
                  className="text-sm text-purple-600 hover:text-purple-700"
                >
                  Refresh
                </button>
              </div>
              {anomalies.length > 0 ? (
                <div className="space-y-3">
                  {anomalies.map((anomaly, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
                      <div className={`w-3 h-3 rounded-full ${severityColors[anomaly.severity]}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{anomaly.metric}</span>
                          <Badge variant={anomaly.severity === 'critical' ? 'destructive' : 'secondary'}>
                            {anomaly.severity}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          Value: {anomaly.value.toFixed(2)} (baseline: {anomaly.baseline.toFixed(2)}, +{anomaly.deviation.toFixed(1)}σ)
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">
                        {anomaly.timestamp ? new Date(anomaly.timestamp).toLocaleString() : 'Recent'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No anomalies detected</p>
                  <p className="text-sm text-gray-400">System is operating within normal parameters</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
