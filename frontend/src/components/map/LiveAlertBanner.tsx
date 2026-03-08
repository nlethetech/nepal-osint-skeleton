/**
 * LiveAlertBanner - LiveUAMap-style breaking news banner
 * Shows at top of map for critical/breaking events
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, X, Radio, MapPin, Clock, ChevronRight } from 'lucide-react'
import type { LiveMapEvent } from '../../store/slices/mapSlice'

interface LiveAlertBannerProps {
  alert: LiveMapEvent | null
  onDismiss: () => void
  onViewDetails?: (event: LiveMapEvent) => void
}

export function LiveAlertBanner({ alert, onDismiss, onViewDetails }: LiveAlertBannerProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [isExiting, setIsExiting] = useState(false)

  useEffect(() => {
    if (alert) {
      setIsVisible(true)
      setIsExiting(false)

      // Auto-dismiss after 15 seconds for non-critical alerts
      if (alert.severity !== 'critical' && alert.type !== 'breaking') {
        const timer = setTimeout(() => {
          handleDismiss()
        }, 15000)
        return () => clearTimeout(timer)
      }
    }
  }, [alert])

  const handleDismiss = () => {
    setIsExiting(true)
    setTimeout(() => {
      setIsVisible(false)
      onDismiss()
    }, 300)
  }

  if (!alert || !isVisible) return null

  const isCritical = alert.severity === 'critical' || alert.type === 'breaking'
  const timeAgo = getTimeAgo(alert.timestamp)

  return (
    <div
      className={`
        absolute top-16 left-1/2 -translate-x-1/2 z-[40] max-w-lg w-full px-4
        transition-all duration-300 ease-out
        ${isExiting ? 'opacity-0 -translate-y-4' : 'opacity-100 translate-y-0'}
      `}
    >
      <div
        className={`
          relative overflow-hidden rounded-lg border shadow-lg
          ${isCritical
            ? 'bg-red-50 border-red-200'
            : 'bg-orange-50 border-orange-200'
          }
        `}
      >
        {/* Left border indicator */}
        <div className={`absolute inset-y-0 left-0 w-1 ${isCritical ? 'bg-red-500' : 'bg-orange-500'}`} />

        <div className="relative pl-4 pr-3 py-3">
          <div className="flex items-start gap-3">
            {/* Alert Icon */}
            <div className={`
              flex-shrink-0 p-1.5 rounded-full
              ${isCritical ? 'bg-red-100' : 'bg-orange-100'}
            `}>
              {isCritical ? (
                <AlertTriangle className="w-4 h-4 text-red-600" />
              ) : (
                <Radio className="w-4 h-4 text-orange-600" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Type Badge + Time */}
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`
                  px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide
                  ${isCritical
                    ? 'bg-red-100 text-red-700'
                    : 'bg-orange-100 text-orange-700'
                  }
                `}>
                  {alert.type === 'breaking' ? 'BREAKING' : alert.type.toUpperCase()}
                </span>
                <span className="text-xs text-gray-500">{timeAgo}</span>
              </div>

              {/* Title */}
              <h3 className={`
                text-sm font-semibold leading-snug
                ${isCritical ? 'text-red-900' : 'text-orange-900'}
              `}>
                {alert.title}
              </h3>

              {/* Location */}
              {alert.district && (
                <div className="flex items-center gap-1 mt-1 text-xs text-gray-600">
                  <MapPin className="w-3 h-3" />
                  <span>{alert.district}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {onViewDetails && (
                <button
                  onClick={() => onViewDetails(alert)}
                  className={`
                    flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium
                    transition-colors
                    ${isCritical
                      ? 'bg-red-100 hover:bg-red-200 text-red-700'
                      : 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                    }
                  `}
                >
                  View
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={handleDismiss}
                className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper to format time ago
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
