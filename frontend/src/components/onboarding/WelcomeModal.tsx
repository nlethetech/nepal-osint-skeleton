import { Compass, Newspaper, ShieldCheck, Sparkles, X } from 'lucide-react'

interface WelcomeModalProps {
  isOpen: boolean
  isGuest: boolean
  onStartTour: () => void
  onSkip: () => void
  onCreateAccount: () => void
}

const CAPABILITIES = [
  {
    title: 'Track live stories',
    description: 'Watch incoming reporting as it lands across the dashboard.',
    icon: Newspaper,
  },
  {
    title: 'Follow what is developing',
    description: 'Use the national, provincial, and accountability views to understand what matters first.',
    icon: Compass,
  },
  {
    title: 'Open sources and fact checks',
    description: 'Jump from the feed into reviewed claims and source links quickly.',
    icon: ShieldCheck,
  },
]

export function WelcomeModal({
  isOpen,
  isGuest,
  onStartTour,
  onSkip,
  onCreateAccount,
}: WelcomeModalProps) {
  if (!isOpen) return null

  return (
    <div
      aria-modal="true"
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        onClick={onSkip}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(2, 5, 10, 0.82)',
          backdropFilter: 'blur(3px)',
        }}
      />

      <div
        style={{
          position: 'relative',
          width: 'min(760px, 100%)',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          background: 'linear-gradient(180deg, rgba(10, 13, 19, 0.985) 0%, rgba(8, 11, 17, 0.985) 100%)',
          boxShadow: '0 26px 56px rgba(0,0,0,0.48)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: 3,
            background: 'linear-gradient(90deg, rgba(45,114,210,0.9) 0%, rgba(45,114,210,0.32) 55%, rgba(200,118,25,0.82) 100%)',
          }}
        />

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
            <Sparkles size={12} />
            First-Run Guide
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close onboarding"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
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

        <div style={{ position: 'relative', padding: '18px 16px 16px' }}>
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
            Live Dashboard Orientation
          </div>

          <h2
            style={{
              margin: 0,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 21,
              lineHeight: 1.45,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              maxWidth: 620,
            }}
          >
            Welcome to NepalOSINT
          </h2>

          <p
            style={{
              margin: '12px 0 0',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              lineHeight: 1.7,
              maxWidth: 680,
            }}
          >
            This dashboard shows live Nepal news and verified developments. {isGuest
              ? 'You are in a temporary guest session right now. The tour will also show you the accountability view so you can move beyond breaking news into institutional tracking.'
              : 'The tour will show you both the live news workspace and the accountability view so you can move between reporting and institutional tracking quickly.'}
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 12,
              marginTop: 18,
            }}
          >
            {CAPABILITIES.map(({ title, description, icon: Icon }) => (
              <div
                key={title}
                style={{
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'rgba(255,255,255,0.02)',
                  padding: 14,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(45,114,210,0.12)',
                    color: '#79a7ff',
                    marginBottom: 10,
                  }}
                >
                  <Icon size={15} />
                </div>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1.55,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 8,
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1.65,
                  }}
                >
                  {description}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 18,
              paddingTop: 12,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
              Replay this anytime from the Guide control in the header.
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isGuest && (
                <button
                  type="button"
                  onClick={onCreateAccount}
                  style={{
                    borderRadius: 8,
                    border: '1px solid rgba(200,118,25,0.32)',
                    background: 'rgba(200,118,25,0.10)',
                    color: '#ffb366',
                    padding: '9px 12px',
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
              <button
                type="button"
                onClick={onSkip}
                style={{
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'rgba(255,255,255,0.02)',
                  color: 'var(--text-secondary)',
                  padding: '9px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={onStartTour}
                style={{
                  borderRadius: 8,
                  border: '1px solid rgba(45,114,210,0.34)',
                  background: 'rgba(45,114,210,0.14)',
                  color: '#9fc0ff',
                  padding: '9px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Start tour
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
