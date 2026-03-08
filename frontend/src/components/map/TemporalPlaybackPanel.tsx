/**
 * Temporal Playback Panel - Time-based animation and before/after comparison
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Clock,
  Calendar,
  Layers,
  GitCompare,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from 'lucide-react';
import apiClient from '../../api/client';

interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

interface TemporalFrame {
  frame_index: number;
  timestamp: string;
  tile_url: string;
  thumbnail_url?: string;
  stats?: Record<string, unknown>;
}

interface TemporalSequence {
  sequence_id: string;
  layer_type: string;
  bbox: BoundingBox;
  start_date: string;
  end_date: string;
  interval: string;
  frames: TemporalFrame[];
  total_frames: number;
}

interface ComparisonResult {
  comparison_id: string;
  layer_type: string;
  before_date: string;
  after_date: string;
  comparison_type: string;
  before_tile_url: string;
  after_tile_url: string;
  difference_tile_url?: string;
  stats?: {
    before_mean?: number;
    after_mean?: number;
    change_percent?: number;
    affected_area_km2?: number;
    days_between?: number;
  };
}

interface AvailableDate {
  date: string;
  cloud_cover: number;
  quality: string;
}

type ViewMode = 'playback' | 'comparison';
type ComparisonType = 'swipe' | 'difference' | 'overlay';

const LAYER_TYPES = [
  { id: 'sentinel2', name: 'Sentinel-2 RGB' },
  { id: 'ndvi', name: 'Vegetation (NDVI)' },
  { id: 'flood', name: 'Flood Detection' },
  { id: 'events', name: 'Event Timeline' },
];

const INTERVALS = [
  { id: 'hour', name: 'Hourly' },
  { id: 'day', name: 'Daily' },
  { id: 'week', name: 'Weekly' },
  { id: 'month', name: 'Monthly' },
];

interface TemporalPlaybackPanelProps {
  bbox?: BoundingBox;
  onFrameChange?: (frame: TemporalFrame) => void;
  onComparisonChange?: (comparison: ComparisonResult) => void;
}

export function TemporalPlaybackPanel({
  bbox = { north: 30.5, south: 26.3, east: 88.2, west: 80.0 }, // Default to Nepal bounds
  onFrameChange,
  onComparisonChange,
}: TemporalPlaybackPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('playback');

  // Playback state
  const [sequence, setSequence] = useState<TemporalSequence | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000); // ms per frame
  const [layerType, setLayerType] = useState('sentinel2');
  const [intervalUnit, setIntervalUnit] = useState('day');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Comparison state
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [comparisonType, setComparisonType] = useState<ComparisonType>('swipe');
  const [beforeDate, setBeforeDate] = useState('');
  const [afterDate, setAfterDate] = useState('');
  const [swipePosition, setSwipePosition] = useState(50);

  // Available dates
  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([]);

  // Loading states
  const [isLoading, setIsLoading] = useState(false);

  const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch available dates
  const fetchAvailableDates = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/temporal/available-dates', {
        params: {
          layer_type: layerType,
          start_date: startDate,
          end_date: endDate,
        },
      });
      setAvailableDates(data?.available_dates || []);
    } catch (error) {
      console.error('Failed to fetch available dates:', error);
    }
  }, [layerType, startDate, endDate]);

  // Generate temporal frames
  const generateFrames = async () => {
    setIsLoading(true);
    try {
      const { data } = await apiClient.post<TemporalSequence>('/temporal/generate-frames', {
        bbox,
        layer_type: layerType,
        start_date: startDate,
        end_date: endDate,
        interval: intervalUnit,
        max_frames: 30,
      });
      setSequence(data);
      setCurrentFrameIndex(0);
    } catch (error) {
      console.error('Failed to generate frames:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate comparison
  const generateComparison = async () => {
    if (!beforeDate || !afterDate) return;

    setIsLoading(true);
    try {
      const { data } = await apiClient.post<ComparisonResult>('/temporal/comparison/generate', {
        bbox,
        layer_type: layerType,
        before_date: beforeDate,
        after_date: afterDate,
        comparison_type: comparisonType,
      });
      setComparison(data);
      onComparisonChange?.(data);
    } catch (error) {
      console.error('Failed to generate comparison:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Playback controls
  useEffect(() => {
    if (isPlaying && sequence && sequence.frames.length > 0) {
      playbackRef.current = setInterval(() => {
        setCurrentFrameIndex((prev) => {
          const next = (prev + 1) % sequence.frames.length;
          return next;
        });
      }, playbackSpeed);
    } else if (playbackRef.current) {
      clearInterval(playbackRef.current);
    }

    return () => {
      if (playbackRef.current) {
        clearInterval(playbackRef.current);
      }
    };
  }, [isPlaying, sequence, playbackSpeed]);

  // Notify parent of frame changes
  useEffect(() => {
    if (sequence && sequence.frames[currentFrameIndex]) {
      onFrameChange?.(sequence.frames[currentFrameIndex]);
    }
  }, [currentFrameIndex, sequence, onFrameChange]);

  // Fetch available dates on layer change
  useEffect(() => {
    if (isExpanded) {
      fetchAvailableDates();
    }
  }, [isExpanded, fetchAvailableDates]);

  const goToFrame = (index: number) => {
    if (sequence) {
      setCurrentFrameIndex(Math.max(0, Math.min(index, sequence.frames.length - 1)));
    }
  };

  const currentFrame = sequence?.frames[currentFrameIndex];

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="absolute left-4 bottom-20 z-[1000] bg-slate-800/90 backdrop-blur-sm text-white p-2 rounded-lg shadow-lg hover:bg-slate-700 transition-colors"
        title="Temporal Analysis"
      >
        <Clock size={20} />
      </button>
    );
  }

  return (
    <div className="absolute left-4 bottom-20 z-[1000] w-80 bg-slate-900/95 backdrop-blur-sm rounded-lg shadow-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-cyan-400" />
          <span className="text-sm font-medium text-white">Temporal Analysis</span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="p-1 hover:bg-slate-700/50 rounded transition-colors"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      {/* Mode Toggle */}
      <div className="flex border-b border-slate-700/50">
        <button
          onClick={() => setViewMode('playback')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
            viewMode === 'playback'
              ? 'bg-cyan-600/20 text-cyan-400 border-b-2 border-cyan-500'
              : 'text-slate-400 hover:bg-slate-800/50'
          }`}
        >
          <Play size={14} />
          Playback
        </button>
        <button
          onClick={() => setViewMode('comparison')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
            viewMode === 'comparison'
              ? 'bg-cyan-600/20 text-cyan-400 border-b-2 border-cyan-500'
              : 'text-slate-400 hover:bg-slate-800/50'
          }`}
        >
          <GitCompare size={14} />
          Compare
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Layer Selection */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
            <Layers size={12} />
            Layer
          </span>
          <select
            value={layerType}
            onChange={(e) => setLayerType(e.target.value)}
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white"
          >
            {LAYER_TYPES.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </div>

        {viewMode === 'playback' ? (
          <>
            {/* Date Range */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-slate-400">Start</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400">End</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white"
                />
              </div>
            </div>

            {/* Interval Selection */}
            <div className="flex gap-1.5">
              {INTERVALS.map((int) => (
                <button
                  key={int.id}
                  onClick={() => setIntervalUnit(int.id)}
                  className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                    intervalUnit === int.id
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {int.name}
                </button>
              ))}
            </div>

            {/* Generate Button */}
            <button
              onClick={generateFrames}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-500 disabled:opacity-50 transition-colors"
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Calendar size={14} />
              )}
              Generate Timeline
            </button>

            {/* Playback Controls */}
            {sequence && sequence.frames.length > 0 && (
              <>
                {/* Timeline Scrubber */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      Frame {currentFrameIndex + 1} / {sequence.total_frames}
                    </span>
                    <span className="text-cyan-400">
                      {currentFrame
                        ? new Date(currentFrame.timestamp).toLocaleDateString()
                        : ''}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={sequence.frames.length - 1}
                    value={currentFrameIndex}
                    onChange={(e) => goToFrame(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                </div>

                {/* Playback Buttons */}
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => goToFrame(0)}
                    className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition-colors"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    onClick={() => goToFrame(currentFrameIndex - 1)}
                    className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`p-3 rounded-full transition-colors ${
                      isPlaying
                        ? 'bg-red-600 text-white hover:bg-red-500'
                        : 'bg-cyan-600 text-white hover:bg-cyan-500'
                    }`}
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>
                  <button
                    onClick={() => goToFrame(currentFrameIndex + 1)}
                    className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    onClick={() => goToFrame(sequence.frames.length - 1)}
                    className="p-2 bg-slate-800 text-slate-300 rounded hover:bg-slate-700 transition-colors"
                  >
                    <SkipForward size={16} />
                  </button>
                </div>

                {/* Speed Control */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Speed:</span>
                  <input
                    type="range"
                    min={200}
                    max={2000}
                    step={100}
                    value={2200 - playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(2200 - parseInt(e.target.value))}
                    className="flex-1 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                  <span className="text-slate-300 w-12 text-right">
                    {(1000 / playbackSpeed).toFixed(1)}x
                  </span>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* Comparison Mode */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-xs text-slate-400">Before</span>
                <input
                  type="date"
                  value={beforeDate}
                  onChange={(e) => setBeforeDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white"
                />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-slate-400">After</span>
                <input
                  type="date"
                  value={afterDate}
                  onChange={(e) => setAfterDate(e.target.value)}
                  className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white"
                />
              </div>
            </div>

            {/* Available Dates */}
            {availableDates.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs text-slate-400">Available Dates</span>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {availableDates.slice(0, 10).map((d) => (
                    <button
                      key={d.date}
                      onClick={() => {
                        if (!beforeDate) setBeforeDate(d.date);
                        else if (!afterDate) setAfterDate(d.date);
                      }}
                      className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                        d.date === beforeDate || d.date === afterDate
                          ? 'bg-cyan-600 text-white'
                          : d.quality === 'good'
                          ? 'bg-green-600/30 text-green-400 hover:bg-green-600/40'
                          : 'bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600/40'
                      }`}
                      title={`Cloud: ${d.cloud_cover}%`}
                    >
                      {new Date(d.date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Comparison Type */}
            <div className="flex gap-1.5">
              {(['swipe', 'difference', 'overlay'] as ComparisonType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setComparisonType(type)}
                  className={`flex-1 px-2 py-1.5 rounded text-xs capitalize transition-colors ${
                    comparisonType === type
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            {/* Generate Comparison */}
            <button
              onClick={generateComparison}
              disabled={!beforeDate || !afterDate || isLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-500 disabled:opacity-50 transition-colors"
            >
              {isLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitCompare size={14} />
              )}
              Generate Comparison
            </button>

            {/* Comparison Results */}
            {comparison && (
              <div className="p-2 bg-slate-800/50 rounded border border-slate-700/50 space-y-2">
                <div className="text-xs text-slate-400">Comparison Results</div>
                {comparison.stats && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Change</span>
                      <span
                        className={
                          (comparison.stats.change_percent ?? 0) < 0
                            ? 'text-red-400'
                            : 'text-green-400'
                        }
                      >
                        {comparison.stats.change_percent?.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Affected Area</span>
                      <span className="text-white">
                        {comparison.stats.affected_area_km2?.toFixed(1)} km²
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Days Between</span>
                      <span className="text-white">{comparison.stats.days_between}</span>
                    </div>
                  </>
                )}

                {/* Swipe Control */}
                {comparisonType === 'swipe' && (
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400">Swipe Position</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={swipePosition}
                      onChange={(e) => setSwipePosition(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
