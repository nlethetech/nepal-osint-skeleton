/**
 * Drawing Tools Panel - Polygon analysis, measurements, region saving
 * Integrates with react-leaflet-draw for map drawing
 */
import { useState, useCallback } from 'react';
import {
  Pencil,
  Square,
  Circle,
  Ruler,
  Save,
  Trash2,
  Play,
  Loader2,
  MapPin,
  Mountain,
  X,
} from 'lucide-react';
import { useCommandCenterStore } from '../../stores/commandCenterStore';
import apiClient from '../../api/client';

interface Coordinate {
  lat: number;
  lng: number;
}

interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Coordinate[][];
}

interface AnalysisResult {
  analysis_type: string;
  status: string;
  result_id: string;
}

interface RegionAnalysis {
  region_id: string;
  area_km2: number;
  centroid: Coordinate;
  analyses: AnalysisResult[];
}

interface MeasurementResult {
  measurement_type: string;
  value: number;
  unit: string;
  points: Coordinate[];
  metadata?: {
    segments?: number;
    perimeter_km?: number;
    vertices?: number;
    min_elevation?: number;
    max_elevation?: number;
    elevation_profile?: number[];
    total_distance_km?: number;
  };
}

interface SavedRegion {
  id: string;
  name: string;
  description?: string;
  area_km2: number;
  tags: string[];
  created_at: string;
}

type DrawingMode = 'none' | 'polygon' | 'line' | 'circle';
type MeasurementType = 'distance' | 'area' | 'elevation';

export function DrawingToolsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('none');
  const [measurementType, setMeasurementType] = useState<MeasurementType | null>(null);
  const [drawnCoordinates, setDrawnCoordinates] = useState<Coordinate[]>([]);
  const [analysisResults, setAnalysisResults] = useState<RegionAnalysis | null>(null);
  const [measurementResult, setMeasurementResult] = useState<MeasurementResult | null>(null);
  const [savedRegions, setSavedRegions] = useState<SavedRegion[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [regionName, setRegionName] = useState('');
  const [regionTags, setRegionTags] = useState('');
  const [selectedAnalysisTypes, setSelectedAnalysisTypes] = useState<string[]>(['pwtt', 'ndvi']);

  const { filters } = useCommandCenterStore();

  // Fetch saved regions
  const fetchSavedRegions = useCallback(async () => {
    try {
      const response = await apiClient.get('/drawing/saved-regions', { params: { limit: 20 } })
      setSavedRegions(response.data)
    } catch (error) {
      console.error('Failed to fetch saved regions:', error);
    }
  }, []);

  // Analyze drawn region
  const analyzeRegion = async () => {
    if (drawnCoordinates.length < 3) return;

    setIsAnalyzing(true);
    try {
      const geometry: PolygonGeometry = {
        type: 'Polygon',
        coordinates: [drawnCoordinates],
      };

      const response = await apiClient.post(`/drawing/analyze-region`, {
        geometry,
        analysis_types: selectedAnalysisTypes,
      })

      setAnalysisResults(response.data as RegionAnalysis)
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Calculate measurement
  const calculateMeasurement = async (type: MeasurementType) => {
    if (drawnCoordinates.length < 2) return;

    try {
      const response = await apiClient.post(`/drawing/measurements/calculate`, {
        measurement_type: type,
        coordinates: drawnCoordinates,
      })
      setMeasurementResult(response.data as MeasurementResult)
    } catch (error) {
      console.error('Measurement failed:', error);
    }
  };

  // Save region
  const saveRegion = async () => {
    if (drawnCoordinates.length < 3 || !regionName.trim()) return;

    try {
      const geometry: PolygonGeometry = {
        type: 'Polygon',
        coordinates: [drawnCoordinates],
      };

      await apiClient.post(`/drawing/save-region`, {
        name: regionName.trim(),
        geometry,
        tags: regionTags.split(',').map((t) => t.trim()).filter(Boolean),
        is_public: false,
      })

      setSaveDialogOpen(false);
      setRegionName('');
      setRegionTags('');
      fetchSavedRegions();
    } catch (error) {
      console.error('Save failed:', error);
    }
  };

  // Clear drawing
  const clearDrawing = () => {
    setDrawnCoordinates([]);
    setAnalysisResults(null);
    setMeasurementResult(null);
    setDrawingMode('none');
    setMeasurementType(null);
  };

  // Toggle analysis type
  const toggleAnalysisType = (type: string) => {
    setSelectedAnalysisTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="absolute right-4 top-36 z-[1000] bg-slate-800/90 backdrop-blur-sm text-white p-2 rounded-lg shadow-lg hover:bg-slate-700 transition-colors"
        title="Drawing Tools"
      >
        <Pencil size={20} />
      </button>
    );
  }

  return (
    <div className="absolute right-4 top-36 z-[1000] w-72 bg-slate-900/95 backdrop-blur-sm rounded-lg shadow-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Pencil size={16} className="text-cyan-400" />
          <span className="text-sm font-medium text-white">Drawing Tools</span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="p-1 hover:bg-slate-700/50 rounded transition-colors"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
        {/* Drawing Mode Buttons */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Draw Shape</span>
          <div className="flex gap-2">
            <button
              onClick={() => setDrawingMode(drawingMode === 'polygon' ? 'none' : 'polygon')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                drawingMode === 'polygon'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Square size={14} />
              Polygon
            </button>
            <button
              onClick={() => setDrawingMode(drawingMode === 'line' ? 'none' : 'line')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                drawingMode === 'line'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Ruler size={14} />
              Line
            </button>
            <button
              onClick={() => setDrawingMode(drawingMode === 'circle' ? 'none' : 'circle')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${
                drawingMode === 'circle'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Circle size={14} />
              Circle
            </button>
          </div>
        </div>

        {/* Measurement Buttons */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Measurements</span>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMeasurementType('distance');
                calculateMeasurement('distance');
              }}
              disabled={drawnCoordinates.length < 2}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-slate-800 text-slate-300 rounded text-xs hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Ruler size={14} />
              Distance
            </button>
            <button
              onClick={() => {
                setMeasurementType('area');
                calculateMeasurement('area');
              }}
              disabled={drawnCoordinates.length < 3}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-slate-800 text-slate-300 rounded text-xs hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <MapPin size={14} />
              Area
            </button>
            <button
              onClick={() => {
                setMeasurementType('elevation');
                calculateMeasurement('elevation');
              }}
              disabled={drawnCoordinates.length < 2}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-slate-800 text-slate-300 rounded text-xs hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Mountain size={14} />
              Elevation
            </button>
          </div>
        </div>

        {/* Measurement Result */}
        {measurementResult && (
          <div className="p-2 bg-slate-800/50 rounded border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-1">
              {measurementResult.measurement_type.charAt(0).toUpperCase() +
                measurementResult.measurement_type.slice(1)}
            </div>
            <div className="text-lg font-semibold text-white">
              {measurementResult.value.toFixed(3)} {measurementResult.unit}
            </div>
            {measurementResult.metadata?.perimeter_km && (
              <div className="text-xs text-slate-400 mt-1">
                Perimeter: {measurementResult.metadata.perimeter_km.toFixed(2)} km
              </div>
            )}
            {measurementResult.metadata?.elevation_profile && (
              <div className="text-xs text-slate-400 mt-1">
                Elevation: {measurementResult.metadata.min_elevation}m -{' '}
                {measurementResult.metadata.max_elevation}m
              </div>
            )}
          </div>
        )}

        {/* Analysis Types */}
        {drawnCoordinates.length >= 3 && (
          <div className="space-y-1.5">
            <span className="text-xs text-slate-400 font-medium">Analysis Types</span>
            <div className="flex flex-wrap gap-1.5">
              {['pwtt', 'ndvi', 'flood', 'landslide'].map((type) => (
                <button
                  key={type}
                  onClick={() => toggleAnalysisType(type)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    selectedAnalysisTypes.includes(type)
                      ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/50'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {type.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Analysis Results */}
        {analysisResults && (
          <div className="p-2 bg-slate-800/50 rounded border border-slate-700/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Region Analysis</span>
              <span className="text-xs text-cyan-400">
                {analysisResults.area_km2.toFixed(2)} km²
              </span>
            </div>
            {analysisResults.analyses.map((analysis) => (
              <div
                key={analysis.result_id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-300">{analysis.analysis_type.toUpperCase()}</span>
                <span
                  className={`px-1.5 py-0.5 rounded ${
                    analysis.status === 'completed'
                      ? 'bg-green-500/20 text-green-400'
                      : analysis.status === 'processing'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-slate-600/50 text-slate-400'
                  }`}
                >
                  {analysis.status}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={analyzeRegion}
            disabled={drawnCoordinates.length < 3 || isAnalyzing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isAnalyzing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            Analyze Region
          </button>
          <button
            onClick={() => setSaveDialogOpen(true)}
            disabled={drawnCoordinates.length < 3}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-700 text-white rounded text-xs hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={14} />
          </button>
          <button
            onClick={clearDrawing}
            className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600/30 text-red-400 rounded text-xs hover:bg-red-600/40 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Saved Regions */}
        {savedRegions.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-xs text-slate-400 font-medium">Saved Regions</span>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {savedRegions.map((region) => (
                <div
                  key={region.id}
                  className="flex items-center justify-between p-2 bg-slate-800/50 rounded text-xs cursor-pointer hover:bg-slate-700/50 transition-colors"
                >
                  <div>
                    <div className="text-slate-200">{region.name}</div>
                    <div className="text-slate-500">{region.area_km2.toFixed(2)} km²</div>
                  </div>
                  <div className="flex gap-1">
                    {region.tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 bg-slate-700 text-slate-400 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save Dialog */}
      {saveDialogOpen && (
        <div className="absolute inset-0 bg-slate-900/95 p-3 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-white">Save Region</span>
            <button
              onClick={() => setSaveDialogOpen(false)}
              className="p-1 hover:bg-slate-700/50 rounded"
            >
              <X size={14} className="text-slate-400" />
            </button>
          </div>
          <input
            type="text"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
            placeholder="Region name"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white placeholder-slate-500 mb-2"
          />
          <input
            type="text"
            value={regionTags}
            onChange={(e) => setRegionTags(e.target.value)}
            placeholder="Tags (comma separated)"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white placeholder-slate-500 mb-3"
          />
          <button
            onClick={saveRegion}
            disabled={!regionName.trim()}
            className="w-full py-2 bg-cyan-600 text-white rounded text-sm font-medium hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save Region
          </button>
        </div>
      )}
    </div>
  );
}
