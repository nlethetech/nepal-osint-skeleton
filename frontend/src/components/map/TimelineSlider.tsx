/**
 * TimelineSlider - Historical playback with event density visualization
 * ======================================================================
 *
 * Production-grade timeline control with:
 * - Time range slider with smooth scrubbing
 * - Event density histogram visualization
 * - Play/pause auto-playback controls
 * - Configurable playback speeds
 * - Critical event markers on timeline
 * - Keyboard navigation support
 * - Responsive design
 */

import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Calendar,
  Clock,
  ChevronDown,
} from 'lucide-react'

// =============================================================================
// TYPES
// =============================================================================

export interface TimelineBucket {
  timestamp: Date
  count: number
  critical: number
  high: number
}

export interface TimelineSliderProps {
  /** Start time of the timeline range */
  startTime: Date
  /** End time of the timeline range */
  endTime: Date
  /** Current selected time */
  currentTime: Date
  /** Event density buckets for histogram */
  buckets: TimelineBucket[]
  /** Callback when time changes */
  onTimeChange: (time: Date) => void
  /** Callback when playing state changes */
  onPlayingChange?: (playing: boolean) => void
  /** Whether auto-play is active */
  isPlaying?: boolean
  /** Playback speed multiplier */
  playbackSpeed?: number
  /** Available playback speeds */
  availableSpeeds?: number[]
  /** Whether the slider is disabled */
  disabled?: boolean
  /** Show full controls or compact mode */
  compact?: boolean
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_SPEEDS = [0.5, 1, 2, 5, 10]
const HISTOGRAM_HEIGHT = 40
const MIN_BAR_HEIGHT = 2

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format time for display
 */
function formatTime(date: Date, includeDate = false): string {
  if (includeDate) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Calculate time from slider position
 */
function positionToTime(position: number, startTime: Date, endTime: Date): Date {
  const duration = endTime.getTime() - startTime.getTime()
  const offset = duration * position
  return new Date(startTime.getTime() + offset)
}

/**
 * Calculate slider position from time
 */
function timeToPosition(time: Date, startTime: Date, endTime: Date): number {
  const duration = endTime.getTime() - startTime.getTime()
  const offset = time.getTime() - startTime.getTime()
  return Math.max(0, Math.min(1, offset / duration))
}

// =============================================================================
// HISTOGRAM COMPONENT
// =============================================================================

interface HistogramProps {
  buckets: TimelineBucket[]
  currentPosition: number
  onPositionClick: (position: number) => void
}

const Histogram = memo(function Histogram({
  buckets,
  currentPosition,
  onPositionClick,
}: HistogramProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Find max count for normalization
  const maxCount = useMemo(() => {
    return Math.max(1, ...buckets.map(b => b.count))
  }, [buckets])

  // Handle click on histogram
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const position = (e.clientX - rect.left) / rect.width
    onPositionClick(Math.max(0, Math.min(1, position)))
  }, [onPositionClick])

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-pointer"
      style={{ height: HISTOGRAM_HEIGHT }}
      onClick={handleClick}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(currentPosition * 100)}
    >
      {/* Background grid */}
      <div className="absolute inset-0 opacity-20">
        {[0.25, 0.5, 0.75].map(pos => (
          <div
            key={pos}
            className="absolute top-0 bottom-0 w-px bg-osint-border"
            style={{ left: `${pos * 100}%` }}
          />
        ))}
      </div>

      {/* Histogram bars */}
      <div className="flex items-end h-full gap-px">
        {buckets.map((bucket, index) => {
          const normalizedHeight = bucket.count / maxCount
          const height = Math.max(MIN_BAR_HEIGHT, normalizedHeight * HISTOGRAM_HEIGHT)
          const criticalRatio = bucket.count > 0 ? bucket.critical / bucket.count : 0
          const highRatio = bucket.count > 0 ? bucket.high / bucket.count : 0

          // Determine bar color based on severity composition
          let barColor = 'bg-osint-accent/60'
          if (criticalRatio > 0.3) {
            barColor = 'bg-red-500/70'
          } else if (highRatio > 0.3) {
            barColor = 'bg-orange-500/70'
          } else if (criticalRatio > 0 || highRatio > 0) {
            barColor = 'bg-yellow-500/60'
          }

          return (
            <div
              key={index}
              className={`flex-1 ${barColor} rounded-t-sm transition-all duration-150 hover:opacity-100 opacity-80`}
              style={{ height: `${height}px` }}
              title={`${bucket.count} events (${bucket.critical} critical)`}
            />
          )
        })}
      </div>

      {/* Current position indicator */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
        style={{ left: `${currentPosition * 100}%` }}
      >
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full shadow" />
      </div>
    </div>
  )
})

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const TimelineSlider = memo(function TimelineSlider({
  startTime,
  endTime,
  currentTime,
  buckets,
  onTimeChange,
  onPlayingChange,
  isPlaying = false,
  playbackSpeed = 1,
  availableSpeeds = DEFAULT_SPEEDS,
  disabled = false,
  compact = false,
}: TimelineSliderProps) {
  const [internalSpeed, setInternalSpeed] = useState(playbackSpeed)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Calculate current position
  const currentPosition = useMemo(() => {
    return timeToPosition(currentTime, startTime, endTime)
  }, [currentTime, startTime, endTime])

  // Calculate total duration
  const totalDuration = useMemo(() => {
    return endTime.getTime() - startTime.getTime()
  }, [startTime, endTime])

  // Handle position change from slider
  const handlePositionChange = useCallback((position: number) => {
    const newTime = positionToTime(position, startTime, endTime)
    onTimeChange(newTime)
  }, [startTime, endTime, onTimeChange])

  // Handle slider drag
  const handleSliderMouseDown = useCallback((_e: React.MouseEvent) => {
    if (disabled) return
    setIsDragging(true)

    const handleMouseMove = (e: MouseEvent) => {
      if (!sliderRef.current) return
      const rect = sliderRef.current.getBoundingClientRect()
      const position = (e.clientX - rect.left) / rect.width
      handlePositionChange(Math.max(0, Math.min(1, position)))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [disabled, handlePositionChange])

  // Play/pause control
  const togglePlay = useCallback(() => {
    onPlayingChange?.(!isPlaying)
  }, [isPlaying, onPlayingChange])

  // Step controls
  const stepBackward = useCallback(() => {
    const stepMs = totalDuration * 0.05 // 5% step
    const newTime = new Date(currentTime.getTime() - stepMs)
    onTimeChange(new Date(Math.max(startTime.getTime(), newTime.getTime())))
  }, [currentTime, startTime, totalDuration, onTimeChange])

  const stepForward = useCallback(() => {
    const stepMs = totalDuration * 0.05 // 5% step
    const newTime = new Date(currentTime.getTime() + stepMs)
    onTimeChange(new Date(Math.min(endTime.getTime(), newTime.getTime())))
  }, [currentTime, endTime, totalDuration, onTimeChange])

  // Reset to start
  const resetToStart = useCallback(() => {
    onTimeChange(startTime)
  }, [startTime, onTimeChange])

  // Track internal time for playback
  const internalTimeRef = useRef<Date>(currentTime)

  // Update internal time ref when currentTime changes externally
  useEffect(() => {
    internalTimeRef.current = currentTime
  }, [currentTime])

  // Auto-playback
  useEffect(() => {
    if (isPlaying && !isDragging) {
      const intervalMs = 100 // Update every 100ms
      const timeStepMs = (totalDuration / 100) * internalSpeed * (intervalMs / 1000)

      playIntervalRef.current = setInterval(() => {
        const current = internalTimeRef.current
        const newTime = new Date(current.getTime() + timeStepMs)

        // Stop at end
        if (newTime >= endTime) {
          onPlayingChange?.(false)
          onTimeChange(endTime)
          return
        }

        internalTimeRef.current = newTime
        onTimeChange(newTime)
      }, intervalMs)

      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current)
        }
      }
    }
  }, [isPlaying, isDragging, internalSpeed, totalDuration, endTime, onTimeChange, onPlayingChange])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          stepBackward()
          break
        case 'ArrowRight':
          e.preventDefault()
          stepForward()
          break
        case 'Home':
          e.preventDefault()
          resetToStart()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, togglePlay, stepBackward, stepForward, resetToStart])

  // Compact mode - enhanced for better playback experience
  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        {/* Histogram bar - clickable mini timeline */}
        <div className="relative h-8 bg-osint-card/50 rounded overflow-hidden cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const position = (e.clientX - rect.left) / rect.width
            handlePositionChange(Math.max(0, Math.min(1, position)))
          }}
        >
          {/* Mini histogram bars */}
          <div className="flex items-end h-full gap-px px-1">
            {buckets.slice(0, 48).map((bucket, index) => {
              const maxCount = Math.max(1, ...buckets.map(b => b.count))
              const height = Math.max(2, (bucket.count / maxCount) * 28)
              const isPast = index < Math.floor(currentPosition * buckets.length)
              return (
                <div
                  key={index}
                  className={`flex-1 rounded-t-sm transition-colors ${
                    isPast
                      ? bucket.critical > 0 ? 'bg-red-500' : bucket.high > 0 ? 'bg-orange-500' : 'bg-osint-accent'
                      : 'bg-osint-border/50'
                  }`}
                  style={{ height: `${height}px` }}
                />
              )
            })}
          </div>
          {/* Position indicator line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
            style={{ left: `${currentPosition * 100}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Play/Pause with enhanced styling */}
          <button
            onClick={togglePlay}
            disabled={disabled}
            className={`p-2 rounded-full transition-all disabled:opacity-50 ${
              isPlaying
                ? 'bg-red-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.5)]'
                : 'bg-osint-card hover:bg-osint-accent hover:text-white'
            }`}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          {/* Step controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={stepBackward}
              disabled={disabled}
              className="p-1.5 hover:bg-osint-card rounded transition-colors disabled:opacity-50"
              title="Step back (←)"
            >
              <SkipBack className="w-3 h-3" />
            </button>
            <button
              onClick={stepForward}
              disabled={disabled}
              className="p-1.5 hover:bg-osint-card rounded transition-colors disabled:opacity-50"
              title="Step forward (→)"
            >
              <SkipForward className="w-3 h-3" />
            </button>
          </div>

          {/* Time display */}
          <div className="flex-1 flex items-center gap-2">
            <Clock className="w-3 h-3 text-osint-muted" />
            <span className="text-sm font-mono text-osint-text">
              {formatTime(currentTime, true)}
            </span>
          </div>

          {/* Speed selector */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-osint-card rounded hover:bg-osint-border transition-colors"
            >
              <span>{internalSpeed}x</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-full right-0 mb-1 py-1 bg-osint-bg border border-osint-border rounded-lg shadow-xl z-10">
                {availableSpeeds.map(speed => (
                  <button
                    key={speed}
                    onClick={() => {
                      setInternalSpeed(speed)
                      setShowSpeedMenu(false)
                    }}
                    className={`w-full px-3 py-1 text-xs text-left hover:bg-osint-card transition-colors ${
                      speed === internalSpeed ? 'text-osint-accent' : 'text-osint-text'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-osint-bg/95 backdrop-blur-sm border border-osint-border rounded-lg overflow-hidden">
      {/* Header with time range */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-osint-border/50">
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-3.5 h-3.5 text-osint-muted" />
          <span className="text-osint-muted">{formatTime(startTime, true)}</span>
          <span className="text-osint-muted">—</span>
          <span className="text-osint-muted">{formatTime(endTime, true)}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-osint-muted">
          <Clock className="w-3.5 h-3.5" />
          <span>{formatDuration(totalDuration)}</span>
        </div>
      </div>

      {/* Histogram */}
      <div className="px-3 pt-2">
        <Histogram
          buckets={buckets}
          currentPosition={currentPosition}
          onPositionClick={handlePositionChange}
        />
      </div>

      {/* Slider track */}
      <div
        ref={sliderRef}
        className="relative h-2 mx-3 mt-1 bg-osint-card rounded-full cursor-pointer"
        onMouseDown={handleSliderMouseDown}
      >
        {/* Progress fill */}
        <div
          className="absolute h-full bg-osint-accent rounded-full"
          style={{ width: `${currentPosition * 100}%` }}
        />

        {/* Thumb */}
        <div
          className={`
            absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2
            bg-white rounded-full shadow-lg border-2 border-osint-accent
            transition-transform
            ${isDragging ? 'scale-125' : 'hover:scale-110'}
          `}
          style={{ left: `${currentPosition * 100}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-3 py-2">
        {/* Playback controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={stepBackward}
            disabled={disabled}
            className="p-1.5 hover:bg-osint-card rounded transition-colors disabled:opacity-50"
            title="Step backward"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            disabled={disabled}
            className={`
              p-2 rounded-full transition-colors disabled:opacity-50
              ${isPlaying ? 'bg-osint-accent text-white' : 'hover:bg-osint-card'}
            `}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )}
          </button>

          <button
            onClick={stepForward}
            disabled={disabled}
            className="p-1.5 hover:bg-osint-card rounded transition-colors disabled:opacity-50"
            title="Step forward"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Current time display */}
        <div className="text-center">
          <div className="text-sm font-medium">{formatTime(currentTime)}</div>
          <div className="text-[10px] text-osint-muted">
            {formatTime(currentTime, true).split(',')[0]}
          </div>
        </div>

        {/* Speed selector */}
        <div className="relative">
          <button
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-osint-card rounded hover:bg-osint-border transition-colors"
          >
            <span>{internalSpeed}x</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {showSpeedMenu && (
            <div className="absolute bottom-full right-0 mb-1 py-1 bg-osint-bg border border-osint-border rounded-lg shadow-xl z-10">
              {availableSpeeds.map(speed => (
                <button
                  key={speed}
                  onClick={() => {
                    setInternalSpeed(speed)
                    setShowSpeedMenu(false)
                  }}
                  className={`
                    w-full px-3 py-1 text-xs text-left hover:bg-osint-card transition-colors
                    ${speed === internalSpeed ? 'text-osint-accent' : 'text-osint-text'}
                  `}
                >
                  {speed}x
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

export default TimelineSlider
