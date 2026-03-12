import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, Compass, X } from 'lucide-react'
import type { DashboardTourStep, TourPlacement } from './tourSteps'

interface DashboardTourProps {
  isOpen: boolean
  isGuest: boolean
  steps: DashboardTourStep[]
  onComplete: () => void
  onSkip: () => void
  onCreateAccount: () => void
  onStepChange?: (step: DashboardTourStep) => void
}

type Rect = { top: number; left: number; width: number; height: number }

const CARD_WIDTH = 372
const CARD_MIN_HEIGHT = 262
const PADDING = 16
const VIEWPORT_PADDING = 16
const HEADER_OFFSET = 18

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

function getCardPosition(
  rect: Rect | null,
  placement: TourPlacement,
  isMobile: boolean,
  cardHeight: number,
) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(CARD_WIDTH, viewportWidth - VIEWPORT_PADDING * 2)
  const height = Math.max(cardHeight, CARD_MIN_HEIGHT)

  if (!rect || placement === 'center' || isMobile) {
    return {
      top: clamp(viewportHeight - height - 20, HEADER_OFFSET, Math.max(HEADER_OFFSET, viewportHeight - height - VIEWPORT_PADDING)),
      left: clamp((viewportWidth - width) / 2, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING)),
      width,
    }
  }

  const wideTarget = rect.width >= viewportWidth * 0.68
  let top = rect.top
  let left = rect.left
  let effectivePlacement = placement

  if (placement === 'bottom' && rect.top + rect.height + PADDING + height > viewportHeight - VIEWPORT_PADDING) {
    effectivePlacement = 'top'
  } else if (placement === 'top' && rect.top - height - PADDING < HEADER_OFFSET) {
    effectivePlacement = 'bottom'
  }

  switch (effectivePlacement) {
    case 'top':
      top = rect.top - height - PADDING
      left = wideTarget
        ? rect.left + rect.width - width
        : rect.left + rect.width / 2 - width / 2
      break
    case 'bottom':
      top = rect.top + rect.height + PADDING
      left = wideTarget
        ? rect.left + rect.width - width
        : rect.left + rect.width / 2 - width / 2
      break
    case 'left':
      top = rect.top + rect.height / 2 - height / 2
      left = rect.left - width - PADDING
      break
    case 'right':
      top = rect.top + rect.height / 2 - height / 2
      left = rect.left + rect.width + PADDING
      break
    default:
      top = rect.top + rect.height + PADDING
      left = rect.left + rect.width / 2 - width / 2
      break
  }

  return {
    top: clamp(top, HEADER_OFFSET, Math.max(HEADER_OFFSET, viewportHeight - height - VIEWPORT_PADDING)),
    left: clamp(left, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING)),
    width,
  }
}

function getTargetRect(targetId?: string): Rect | null {
  if (!targetId) return null
  const element = document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

export function DashboardTour({
  isOpen,
  isGuest,
  steps,
  onComplete,
  onSkip,
  onCreateAccount,
  onStepChange,
}: DashboardTourProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [cardHeight, setCardHeight] = useState(CARD_MIN_HEIGHT)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const isMobile = window.innerWidth <= 768

  const resolvedSteps = useMemo(() => (
    steps.filter((step) => (
      (!isMobile || step.mobileEnabled)
      && (
        !step.targetId
        || Boolean(document.querySelector(`[data-tour-id="${step.targetId}"]`))
        || Boolean(step.presetId)
      )
    ))
  ), [isMobile, steps])

  const currentStep = resolvedSteps[currentIndex] || null

  useEffect(() => {
    if (!isOpen) return
    setCurrentIndex(0)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !currentStep) return
    onStepChange?.(currentStep)
  }, [currentStep, isOpen, onStepChange])

  useEffect(() => {
    if (!isOpen || !currentStep) return

    let cancelled = false

    const syncRect = (attempt = 0) => {
      const target = currentStep.targetId
        ? document.querySelector<HTMLElement>(`[data-tour-id="${currentStep.targetId}"]`)
        : null

      if (target && currentStep.requiresScroll) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }

      window.requestAnimationFrame(() => {
        if (cancelled) return
        const nextRect = getTargetRect(currentStep.targetId)
        setTargetRect(nextRect)

        if (!nextRect && currentStep.targetId && attempt < 8) {
          window.setTimeout(() => syncRect(attempt + 1), 90)
        }
      })
    }

    const handleViewportSync = () => {
      syncRect()
    }

    syncRect()
    window.addEventListener('resize', handleViewportSync)
    window.addEventListener('scroll', handleViewportSync, true)
    return () => {
      cancelled = true
      window.removeEventListener('resize', handleViewportSync)
      window.removeEventListener('scroll', handleViewportSync, true)
    }
  }, [currentStep, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onSkip()
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setCurrentIndex((index) => Math.min(index + 1, resolvedSteps.length - 1))
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setCurrentIndex((index) => Math.max(index - 1, 0))
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onSkip, resolvedSteps.length])

  useEffect(() => {
    if (!isOpen) return
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) return

    const measure = () => {
      if (cardRef.current) {
        setCardHeight(cardRef.current.offsetHeight)
      }
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [currentIndex, currentStep, isOpen])

  if (!isOpen || !currentStep) return null

  const cardPosition = getCardPosition(targetRect, currentStep.placement, isMobile, cardHeight)
  const isLastStep = currentIndex === resolvedSteps.length - 1

  return (
    <div
      aria-modal="true"
      role="dialog"
      style={{ position: 'fixed', inset: 0, zIndex: 1500 }}
    >
      {targetRect ? (
        <>
          <div style={{ position: 'fixed', inset: 0, bottom: `calc(100vh - ${targetRect.top}px)`, background: 'rgba(2, 5, 10, 0.78)' }} />
          <div style={{ position: 'fixed', top: targetRect.top, left: 0, width: targetRect.left, height: targetRect.height, background: 'rgba(2, 5, 10, 0.78)' }} />
          <div style={{ position: 'fixed', top: targetRect.top, left: targetRect.left + targetRect.width, right: 0, height: targetRect.height, background: 'rgba(2, 5, 10, 0.78)' }} />
          <div style={{ position: 'fixed', top: targetRect.top + targetRect.height, left: 0, right: 0, bottom: 0, background: 'rgba(2, 5, 10, 0.78)' }} />
          <div
            style={{
              position: 'fixed',
              top: targetRect.top - 4,
              left: targetRect.left - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
              borderRadius: 10,
              border: '1px solid rgba(64, 138, 255, 0.45)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 24px rgba(45,114,210,0.25)',
              pointerEvents: 'none',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2, 5, 10, 0.84)' }} />
      )}

      <div
        ref={cardRef}
        style={{
          position: 'fixed',
          top: cardPosition.top,
          left: cardPosition.left,
          width: cardPosition.width,
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'linear-gradient(180deg, rgba(10, 13, 19, 0.98) 0%, rgba(8, 11, 17, 0.98) 100%)',
          boxShadow: '0 22px 50px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: 3,
            background: 'linear-gradient(90deg, rgba(45,114,210,0.9) 0%, rgba(45,114,210,0.32) 55%, rgba(200,118,25,0.82) 100%)',
          }}
        />

        <div style={{ position: 'relative', padding: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Compass size={12} />
              Step {currentIndex + 1} / {resolvedSteps.length}
            </div>
            <button
              type="button"
              onClick={onSkip}
              aria-label="Close tour"
              style={{
                width: 28,
                height: 28,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              <X size={13} />
            </button>
          </div>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(circle at top left, rgba(45,114,210,0.12), transparent 45%), radial-gradient(circle at bottom right, rgba(200,118,25,0.08), transparent 30%)',
              pointerEvents: 'none',
            }}
          />

          <div style={{ position: 'relative', padding: '16px 14px 14px' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                marginBottom: 12,
                border: '1px solid rgba(64, 138, 255, 0.16)',
                borderRadius: 999,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              {currentStep.presetId === 'parliament' ? 'Accountability' : 'Live Dashboard'}
            </div>

            <h3
              style={{
                margin: 0,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 15,
                lineHeight: 1.45,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              {currentStep.title}
            </h3>

            <p
              style={{
                margin: '12px 0 0',
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1.7,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {currentStep.description}
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                gap: 6,
                marginTop: 14,
                marginBottom: 14,
              }}
            >
              {resolvedSteps.map((step, index) => (
                <span
                  key={step.id}
                  style={{
                    height: 4,
                    borderRadius: 999,
                    background: index === currentIndex
                      ? 'linear-gradient(90deg, rgba(45,114,210,0.9), rgba(78,155,255,0.9))'
                      : 'rgba(255,255,255,0.08)',
                  }}
                />
              ))}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                paddingTop: 12,
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={onSkip}
                  style={{
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: 'rgba(255,255,255,0.02)',
                    color: 'var(--text-secondary)',
                    padding: '9px 11px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Skip
                </button>
                {isGuest && currentStep.guestCta === 'create-account' && (
                  <button
                    type="button"
                    onClick={onCreateAccount}
                    style={{
                      borderRadius: 8,
                      border: '1px solid rgba(200,118,25,0.32)',
                      background: 'rgba(200,118,25,0.10)',
                      color: '#ffb366',
                      padding: '9px 11px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Create account
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
                  style={{
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: currentIndex === 0 ? 'var(--text-disabled)' : 'var(--text-secondary)',
                    padding: '9px 11px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: currentIndex === 0 ? 'default' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  <ChevronLeft size={13} />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isLastStep) {
                      onComplete()
                      return
                    }
                    setCurrentIndex((index) => Math.min(index + 1, resolvedSteps.length - 1))
                  }}
                  style={{
                    borderRadius: 8,
                    border: '1px solid rgba(45,114,210,0.34)',
                    background: 'rgba(45,114,210,0.14)',
                    color: '#9fc0ff',
                    padding: '9px 12px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {isLastStep ? 'Explore' : 'Next'}
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
