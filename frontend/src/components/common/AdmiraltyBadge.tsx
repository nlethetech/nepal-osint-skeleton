/**
 * NATO Admiralty Confidence Rating Badge
 *
 * Displays Admiralty ratings (A1-F6) with color-coded visual indicators.
 *
 * Source Reliability (A-F):
 * - A: Completely reliable (green)
 * - B: Usually reliable (blue)
 * - C: Fairly reliable (yellow)
 * - D: Not usually reliable (orange)
 * - E: Unreliable (red)
 * - F: Cannot be judged (gray)
 *
 * Information Accuracy (1-6):
 * - 1: Confirmed
 * - 2: Probably true
 * - 3: Possibly true
 * - 4: Doubtfully true
 * - 5: Improbable
 * - 6: Cannot be judged
 */

export interface AdmiraltyBadgeProps {
  /** Combined rating like "B2" */
  rating: string
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Whether to show tooltip on hover */
  showTooltip?: boolean
  /** Additional CSS classes */
  className?: string
}

/** Rating descriptions for tooltips */
const RELIABILITY_DESCRIPTIONS: Record<string, string> = {
  A: 'Completely reliable',
  B: 'Usually reliable',
  C: 'Fairly reliable',
  D: 'Not usually reliable',
  E: 'Unreliable',
  F: 'Cannot be judged',
}

const ACCURACY_DESCRIPTIONS: Record<string, string> = {
  '1': 'Confirmed',
  '2': 'Probably true',
  '3': 'Possibly true',
  '4': 'Doubtfully true',
  '5': 'Improbable',
  '6': 'Cannot be judged',
}

/** Color classes based on combined rating */
const getRatingColor = (rating: string): string => {
  const source = rating.charAt(0).toUpperCase()
  const accuracy = rating.charAt(1)

  // High reliability + high accuracy = green
  if ((source === 'A' || source === 'B') && (accuracy === '1' || accuracy === '2')) {
    return 'bg-green-600 text-white'
  }

  // Good reliability = blue
  if (source === 'A' || source === 'B') {
    return 'bg-blue-500 text-white'
  }

  // Moderate reliability = yellow
  if (source === 'C') {
    if (accuracy === '1' || accuracy === '2' || accuracy === '3') {
      return 'bg-yellow-500 text-black'
    }
    return 'bg-yellow-600 text-white'
  }

  // Low reliability = orange
  if (source === 'D') {
    return 'bg-orange-500 text-white'
  }

  // Unreliable = red
  if (source === 'E') {
    return 'bg-red-500 text-white'
  }

  // Cannot judge = gray
  return 'bg-gray-500 text-white'
}

/** Size classes */
const SIZE_CLASSES = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
}

/** Generate tooltip text from rating */
const getTooltipText = (rating: string): string => {
  const source = rating.charAt(0).toUpperCase()
  const accuracy = rating.charAt(1)

  const reliabilityDesc = RELIABILITY_DESCRIPTIONS[source] || 'Unknown'
  const accuracyDesc = ACCURACY_DESCRIPTIONS[accuracy] || 'Unknown'

  return `${reliabilityDesc}, ${accuracyDesc}`
}

export function AdmiraltyBadge({
  rating,
  size = 'sm',
  showTooltip = true,
  className = '',
}: AdmiraltyBadgeProps) {
  if (!rating || rating.length < 2) {
    return null
  }

  const colorClass = getRatingColor(rating)
  const sizeClass = SIZE_CLASSES[size]
  const tooltipText = showTooltip ? getTooltipText(rating) : undefined

  return (
    <span
      className={`inline-flex items-center font-mono font-bold rounded ${colorClass} ${sizeClass} ${className}`}
      title={tooltipText}
    >
      {rating}
    </span>
  )
}

/**
 * Confidence indicator bar showing overall confidence level
 */
export interface ConfidenceBarProps {
  /** Confidence score 0-1 */
  score: number
  /** Whether to show percentage label */
  showLabel?: boolean
  /** Size variant */
  size?: 'sm' | 'md'
  /** Additional CSS classes */
  className?: string
}

export function ConfidenceBar({
  score,
  showLabel = true,
  size = 'sm',
  className = '',
}: ConfidenceBarProps) {
  const percentage = Math.round(score * 100)

  // Color based on confidence level
  let barColor = 'bg-gray-400'
  if (score >= 0.8) {
    barColor = 'bg-green-500'
  } else if (score >= 0.6) {
    barColor = 'bg-blue-500'
  } else if (score >= 0.4) {
    barColor = 'bg-yellow-500'
  } else if (score >= 0.2) {
    barColor = 'bg-orange-500'
  } else {
    barColor = 'bg-red-500'
  }

  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2.5'

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className={`flex-1 bg-gray-700 rounded-full overflow-hidden ${heightClass}`}>
        <div
          className={`${barColor} ${heightClass} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-osint-muted font-medium min-w-[3ch]">
          {percentage}%
        </span>
      )}
    </div>
  )
}

/**
 * Ensemble consensus indicator
 */
export interface EnsembleIndicatorProps {
  /** Agreement score 0-1 */
  agreement: number
  /** Number of models that participated */
  modelsCount: number
  /** Additional CSS classes */
  className?: string
}

export function EnsembleIndicator({
  agreement,
  modelsCount,
  className = '',
}: EnsembleIndicatorProps) {
  const percentage = Math.round(agreement * 100)

  // Determine consensus quality color
  let consensusColor = 'text-red-400'

  if (agreement >= 0.85) {
    consensusColor = 'text-green-400'
  } else if (agreement >= 0.7) {
    consensusColor = 'text-blue-400'
  } else if (agreement >= 0.5) {
    consensusColor = 'text-yellow-400'
  }

  return (
    <div className={`flex items-center gap-1.5 text-xs ${className}`}>
      <span className="text-osint-muted">Consensus:</span>
      <span className={`font-medium ${consensusColor}`}>
        {percentage}%
      </span>
      <span className="text-osint-muted">
        ({modelsCount} models)
      </span>
    </div>
  )
}

/**
 * Deception warning banner
 */
export interface DeceptionWarningProps {
  /** Deception score 0-1 */
  score: number
  /** Credibility level */
  credibilityLevel: string
  /** List of red flags */
  redFlags: string[]
  /** Additional CSS classes */
  className?: string
}

export function DeceptionWarning({
  score,
  credibilityLevel: _credibilityLevel,
  redFlags,
  className = '',
}: DeceptionWarningProps) {
  if (score < 0.4) {
    return null // Don't show warning for low scores
  }

  const percentage = Math.round(score * 100)

  // Severity based on score
  let bgColor = 'bg-yellow-900/50 border-yellow-600'
  let textColor = 'text-yellow-300'
  let label = 'Caution'

  if (score >= 0.7) {
    bgColor = 'bg-red-900/50 border-red-600'
    textColor = 'text-red-300'
    label = 'Warning'
  }

  return (
    <div className={`p-3 rounded-lg border ${bgColor} ${className}`}>
      <div className="flex items-center gap-2">
        <svg
          className={`w-5 h-5 ${textColor}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span className={`font-medium ${textColor}`}>
          {label}: Potential disinformation detected ({percentage}%)
        </span>
      </div>
      {redFlags.length > 0 && (
        <ul className="mt-2 text-sm text-osint-muted list-disc list-inside">
          {redFlags.slice(0, 3).map((flag, i) => (
            <li key={i}>{flag}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Corroboration status badge
 */
export interface CorroborationBadgeProps {
  /** Status: confirmed, probable, unverified, disputed, contradicted */
  status: string
  /** Number of supporting sources */
  supportingCount: number
  /** Number of contradicting sources */
  contradictingCount?: number
  /** Additional CSS classes */
  className?: string
}

export function CorroborationBadge({
  status,
  supportingCount,
  contradictingCount = 0,
  className = '',
}: CorroborationBadgeProps) {
  // Style based on status
  let bgColor = 'bg-gray-600'
  let label = status

  switch (status.toLowerCase()) {
    case 'confirmed':
      bgColor = 'bg-green-600'
      label = `Verified (${supportingCount} sources)`
      break
    case 'probable':
      bgColor = 'bg-blue-600'
      label = `Probable (${supportingCount} sources)`
      break
    case 'disputed':
      bgColor = 'bg-orange-600'
      label = `Disputed (${contradictingCount} vs ${supportingCount})`
      break
    case 'contradicted':
      bgColor = 'bg-red-600'
      label = `Contradicted`
      break
    case 'unverified':
      bgColor = 'bg-gray-600'
      label = 'Unverified'
      break
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded text-white ${bgColor} ${className}`}
    >
      {label}
    </span>
  )
}
