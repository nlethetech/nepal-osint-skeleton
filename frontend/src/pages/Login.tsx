import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, Users, BarChart3, Code2, UserCircle, AlertTriangle, Globe, Database, Shield, Lock, ArrowLeft } from 'lucide-react'
import { login as apiLogin, googleAuth as apiGoogleAuth, guestLogin as apiGuestLogin, sendOtp as apiSendOtp, signup as apiSignup } from '../api/auth'
import { useAuthStore, UserRole, User } from '../store/slices/authSlice'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

// Demo accounts — only shown in development mode. Change these passwords in production.
const DEMO_ACCOUNTS: { role: UserRole; email: string; password: string; label: string; description: string; icon: typeof Users }[] = import.meta.env.DEV ? [
  { role: 'consumer', email: 'consumer@nepalosint.dev', password: 'consumerpassword123', label: 'Consumer', description: 'Read-only dashboard access', icon: Users },
  { role: 'analyst', email: 'analyst@nepalosint.dev', password: 'analystpassword123', label: 'Analyst', description: 'Feedback & analysis tools', icon: BarChart3 },
  { role: 'dev', email: 'dev@nepalosint.dev', password: 'devpassword123', label: 'Developer', description: 'Full system access', icon: Code2 },
] : []

function toStoreUser(apiUser: {
  id: string
  email: string
  full_name: string | null
  username: string | null
  role: string
  auth_provider: string
  avatar_url: string | null
}): User {
  return {
    id: apiUser.id,
    email: apiUser.email,
    fullName: apiUser.full_name,
    username: apiUser.username,
    role: apiUser.role as UserRole,
    authProvider: apiUser.auth_provider as User['authProvider'],
    avatarUrl: apiUser.avatar_url,
  }
}

type AuthError = { response?: { data?: { detail?: string } }; message?: string; code?: string }

function getErrorMessage(err: unknown, fallback: string): string {
  const error = err as AuthError
  if (error?.response?.data?.detail) return error.response.data.detail
  if (error?.code === 'ERR_NETWORK') return 'Unable to reach backend API. Check backend is running and VITE_API_URL is correct.'
  if (error?.message) return error.message
  return fallback
}

/* Animated hexagonal grid background */
function GridBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_20%_40%,rgba(45,114,210,0.07)_0%,transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_60%,rgba(45,114,210,0.04)_0%,transparent_60%)]" />
      <svg className="absolute inset-0 h-full w-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#ABB3BF" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="nepalosint-scanline absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-bp-primary/15 to-transparent" />
      {/* Corner brackets */}
      <div className="absolute left-6 top-6 h-12 w-px bg-gradient-to-b from-bp-primary/25 to-transparent" />
      <div className="absolute left-6 top-6 h-px w-12 bg-gradient-to-r from-bp-primary/25 to-transparent" />
      <div className="absolute bottom-6 right-6 h-12 w-px bg-gradient-to-t from-bp-primary/25 to-transparent" />
      <div className="absolute bottom-6 right-6 h-px w-12 bg-gradient-to-l from-bp-primary/25 to-transparent" />
      <div className="absolute right-6 top-6 h-12 w-px bg-gradient-to-b from-bp-primary/15 to-transparent" />
      <div className="absolute right-6 top-6 h-px w-12 bg-gradient-to-l from-bp-primary/15 to-transparent" />
      <div className="absolute bottom-6 left-6 h-12 w-px bg-gradient-to-t from-bp-primary/15 to-transparent" />
      <div className="absolute bottom-6 left-6 h-px w-12 bg-gradient-to-r from-bp-primary/15 to-transparent" />
    </div>
  )
}

/* Animated pulse ring for the live indicator */
function PulseRing() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
    </span>
  )
}

/* Spinner SVG component */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

type AuthMode = 'signin' | 'signup' | 'otp'

const INPUT_CLASS = "w-full rounded border border-bp-border/50 bg-[#080b11] px-3.5 py-2.5 text-sm text-bp-text placeholder:text-bp-text-disabled outline-none transition-all focus:border-bp-primary/70 focus:bg-[#0a0d13] focus:ring-1 focus:ring-bp-primary/20"
const LABEL_CLASS = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-bp-text-muted"


export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuthStore()
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true'
  const googleBtnRef = useRef<HTMLDivElement | null>(null)

  // Read initial mode from navigation state (e.g. DashboardHeader passes { mode: 'signup' })
  const initialMode = (location.state as { mode?: AuthMode } | null)?.mode === 'signup' ? 'signup' : 'signin'

  // Shared state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const [googleInitError, setGoogleInitError] = useState('')
  const [demoLoading, setDemoLoading] = useState<UserRole | null>(null)
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [otpCode, setOtpCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)

  const anyLoading = useMemo(
    () => loading || guestLoading || googleLoading || demoLoading !== null,
    [loading, guestLoading, googleLoading, demoLoading]
  )

  const handleGoogleResponse = useCallback(async (response: google.accounts.id.CredentialResponse) => {
    if (!response?.credential) {
      setError('Google did not return a credential. Please try again.')
      return
    }
    setError('')
    setGoogleLoading(true)
    try {
      const result = await apiGoogleAuth(response.credential)
      login(result.access_token, result.refresh_token, toStoreUser(result.user))
      navigate(result.user.role === 'dev' ? '/dev' : '/')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Google sign-in failed'))
    } finally {
      setGoogleLoading(false)
    }
  }, [login, navigate])

  const renderGoogleButton = useCallback(() => {
    if (!googleReady || !googleBtnRef.current || typeof google === 'undefined' || !google.accounts?.id) return
    googleBtnRef.current.innerHTML = ''
    const width = Math.max(260, Math.floor(googleBtnRef.current.getBoundingClientRect().width))
    google.accounts.id.renderButton(googleBtnRef.current, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width,
    })
  }, [googleReady])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      setGoogleInitError('Google sign-in is disabled: set VITE_GOOGLE_CLIENT_ID in frontend and GOOGLE_CLIENT_ID in backend.')
      return
    }
    const initGoogle = () => {
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleResponse,
          ux_mode: 'popup',
          itp_support: true,
          cancel_on_tap_outside: true,
        })
        setGoogleReady(true)
        setGoogleInitError('')
      } catch {
        setGoogleReady(false)
        setGoogleInitError('Google sign-in failed to initialize. Verify Google OAuth allowed origins include this host.')
      }
    }
    if (typeof google !== 'undefined' && google.accounts?.id) { initGoogle(); return }
    const existingScript = document.getElementById('google-gsi-client') as HTMLScriptElement | null
    if (existingScript) {
      const handleExistingLoad = () => initGoogle()
      const handleExistingError = () => {
        setGoogleReady(false)
        setGoogleInitError('Failed to load Google sign-in script. Check network/privacy blockers.')
      }
      existingScript.addEventListener('load', handleExistingLoad)
      existingScript.addEventListener('error', handleExistingError)
      return () => {
        existingScript.removeEventListener('load', handleExistingLoad)
        existingScript.removeEventListener('error', handleExistingError)
      }
    }
    const script = document.createElement('script')
    script.id = 'google-gsi-client'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      try { initGoogle() } catch {
        setGoogleReady(false)
        setGoogleInitError('Google sign-in failed to initialize. Verify Google OAuth allowed origins include this host.')
      }
    }
    script.onerror = () => {
      setGoogleReady(false)
      setGoogleInitError('Failed to load Google sign-in script. Check network/privacy blockers.')
    }
    document.head.appendChild(script)
  }, [handleGoogleResponse])

  // Re-render Google button when switching back to signin (ref remounts)
  useEffect(() => {
    if (mode !== 'signin') return
    const timer = setTimeout(() => renderGoogleButton(), 50)
    const onResize = () => renderGoogleButton()
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [renderGoogleButton, mode])

  const handleGoogleClick = () => {
    if (!googleReady || typeof google === 'undefined' || !google.accounts?.id) {
      setError('Google sign-in is not ready yet.')
      return
    }
    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        setError('Google prompt was blocked or skipped. Use the Google button above or check popup/privacy settings.')
      }
    })
  }

  const handleGuestLogin = async () => {
    if (anyLoading) return
    setGuestLoading(true)
    setError('')
    try {
      const result = await apiGuestLogin()
      login(result.access_token, result.refresh_token, toStoreUser(result.user))
      navigate('/')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Guest login failed'))
    } finally {
      setGuestLoading(false)
    }
  }

  const handleDemoLogin = async (role: UserRole) => {
    const account = DEMO_ACCOUNTS.find(a => a.role === role)
    if (!account || anyLoading) return
    setDemoLoading(role)
    setError('')
    try {
      const response = await apiLogin(account.email, account.password)
      login(response.access_token, response.refresh_token, toStoreUser(response.user))
      navigate(response.user.role === 'dev' ? '/dev' : '/')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Backend unavailable. Please ensure the server is running.'))
    } finally {
      setDemoLoading(null)
    }
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (anyLoading) return
    setError('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) { setError('Email and password are required.'); return }
    setLoading(true)
    try {
      const response = await apiLogin(normalizedEmail, password)
      login(response.access_token, response.refresh_token, toStoreUser(response.user))
      navigate(response.user.role === 'dev' ? '/dev' : '/')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Login failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (anyLoading || otpSending) return
    setError('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !password) {
      setError('Email and password are required.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setOtpSending(true)
    try {
      await apiSendOtp(normalizedEmail, password)
      setMode('otp')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to send verification code. Please try again.'))
    } finally {
      setOtpSending(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (anyLoading) return
    setError('')
    const normalizedEmail = email.trim().toLowerCase()
    const code = otpCode.trim()
    if (code.length !== 6) {
      setError('Enter the 6-digit code sent to your email.')
      return
    }
    setLoading(true)
    try {
      const response = await apiSignup(normalizedEmail, password, code)
      login(response.access_token, response.refresh_token, toStoreUser(response.user))
      navigate('/')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Verification failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (otpSending) return
    setError('')
    setOtpSending(true)
    try {
      await apiSendOtp(email.trim().toLowerCase(), password)
      setError('')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to resend code.'))
    } finally {
      setOtpSending(false)
    }
  }

  const switchMode = (newMode: AuthMode) => {
    setError('')
    setOtpCode('')
    setMode(newMode)
  }

  // Card header text
  const headerTitle = mode === 'otp' ? 'Verify your email' : mode === 'signup' ? 'Create an account' : 'Sign in to NEPALOSINT'
  const headerSubtitle = mode === 'otp'
    ? `Enter the 6-digit code sent to ${email}`
    : mode === 'signup'
      ? 'Sign up to access the platform'
      : 'Authenticate to access the platform'

  return (
    <div className="relative flex min-h-screen bg-[#080b11]">
      <GridBackground />

      {/* ========== LEFT PANEL — Branding + Live Preview ========== */}
      <div className="relative hidden w-[55%] flex-col p-10 lg:flex">
        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-bp-primary/25 bg-bp-primary/8">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#4C90F0" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M2 17l10 5 10-5" stroke="#4C90F0" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.5"/>
                <path d="M2 12l10 5 10-5" stroke="#4C90F0" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.75"/>
              </svg>
            </div>
            <div>
              <span className="text-[17px] font-semibold tracking-[0.12em] text-bp-text">NEPALOSINT</span>
              <span className="ml-2.5 text-[11px] font-medium tracking-wider text-bp-text-disabled">v5.0</span>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded border border-bp-border/40 bg-[#0d1118]/80 px-3 py-1.5">
            <PulseRing />
            <span className="text-[11px] font-medium tracking-wider text-emerald-400/90">SYSTEMS ONLINE</span>
          </div>
        </div>

        {/* Hero section — vertically centered */}
        <div className="relative z-10 my-auto max-w-xl">
          {/* Thin accent line above headline */}
          <div className="mb-8 h-px w-16 bg-gradient-to-r from-bp-primary to-transparent" />

          <h1 className="text-[56px] font-bold leading-[1.0] tracking-[-0.03em] text-bp-text">
            Situational awareness,
            <br />
            <span className="relative inline-block bg-gradient-to-r from-bp-primary via-[#5BA3F5] to-[#6EB5FF] bg-clip-text text-transparent">
              delivered.
              <span className="absolute -bottom-2 left-0 h-[2px] w-full bg-gradient-to-r from-bp-primary/50 to-transparent" />
            </span>
          </h1>

          <p className="mt-8 max-w-[420px] text-[15px] leading-[1.8] text-bp-text-muted">
            Real-time open source intelligence across Nepal. Structured data, entity graphs, and actionable insights for analysts and decision-makers.
          </p>

          {/* Capability badges */}
          <div className="mt-10 flex flex-wrap gap-2.5">
            {[
              { icon: Globe, text: '75+ Sources' },
              { icon: Lock, text: 'Real-time Ingestion' },
              { icon: Database, text: 'Entity Graph' },
              { icon: Shield, text: 'Encrypted Sessions' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 rounded border border-bp-border/25 bg-[#0d1118]/50 px-3 py-1.5">
                <Icon size={12} className="text-bp-primary/60" />
                <span className="text-[11px] font-medium text-bp-text-secondary/80">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="relative z-10 flex items-center justify-between text-[10px] text-bp-text-disabled">
          <span className="font-mono tracking-wider">&copy; 2026 NEPALOSINT</span>
          <span className="font-mono tracking-wider">OPEN SOURCE INTELLIGENCE PLATFORM</span>
        </div>
      </div>

      {/* ========== RIGHT PANEL — Auth ========== */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-4 sm:px-7 sm:py-6 lg:p-12">
        <div className="absolute left-0 top-0 bottom-0 hidden w-px bg-gradient-to-b from-transparent via-bp-border/40 to-transparent lg:block" />

        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-bp-primary/25 bg-bp-primary/8">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#4C90F0" strokeWidth="1.5" strokeLinejoin="round"/>
                <path d="M2 17l10 5 10-5" stroke="#4C90F0" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.5"/>
                <path d="M2 12l10 5 10-5" stroke="#4C90F0" strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.75"/>
              </svg>
            </div>
            <span className="text-[17px] font-semibold tracking-[0.12em] text-bp-text">NEPALOSINT</span>
          </div>

          {/* Auth card */}
          <div className="rounded border border-bp-border/50 bg-[#0e1319]/95 shadow-2xl shadow-black/40 backdrop-blur-sm">
            {/* Card header */}
            <div className="border-b border-bp-border/30 px-4 py-4 sm:px-7 sm:py-5">
              <h2 className="text-lg font-semibold text-bp-text">{headerTitle}</h2>
              <p className="mt-1 text-sm text-bp-text-muted">{headerSubtitle}</p>
            </div>

            <div className="px-4 py-5 sm:px-7 sm:py-6">
              {/* Sign In / Sign Up tabs (hidden during OTP) */}
              {mode !== 'otp' && <div className="mb-5 flex rounded border border-bp-border/30 bg-[#080b11]/50 p-0.5">
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className={`flex-1 rounded py-1.5 text-xs font-semibold transition-all ${
                    mode === 'signin'
                      ? 'bg-bp-surface text-bp-text shadow-sm'
                      : 'text-bp-text-muted hover:text-bp-text-secondary'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className={`flex-1 rounded py-1.5 text-xs font-semibold transition-all ${
                    mode === 'signup'
                      ? 'bg-bp-surface text-bp-text shadow-sm'
                      : 'text-bp-text-muted hover:text-bp-text-secondary'
                  }`}
                >
                  Create Account
                </button>
              </div>}

              {error && (
                <div role="alert" className="mb-5 flex items-start gap-2 rounded border border-severity-critical/25 bg-severity-critical/8 px-3 py-2.5 text-xs text-severity-critical">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* ========== SIGN IN FORM ========== */}
              {mode === 'signin' && (
                <>
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label htmlFor="email" className={LABEL_CLASS}>Email Address</label>
                      <input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="you@example.com"
                        autoComplete="email"
                        inputMode="email"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="password" className={LABEL_CLASS}>Password</label>
                      <div className="relative">
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={`${INPUT_CLASS} pr-11`}
                          placeholder="Enter password"
                          autoComplete="current-password"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-bp-text-disabled transition-colors hover:text-bp-text-secondary"
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || anyLoading}
                      className="relative w-full overflow-hidden rounded bg-bp-primary py-2.5 text-sm font-semibold text-white transition-all hover:bg-bp-primary-hover active:scale-[0.99] disabled:opacity-40"
                    >
                      {loading ? (
                        <span className="inline-flex items-center gap-2"><Spinner /> Authenticating...</span>
                      ) : 'Sign In'}
                    </button>
                  </form>

                  {/* Divider */}
                  <div className="relative my-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-bp-border/30" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-[#0e1319] px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-bp-text-disabled">or continue with</span>
                    </div>
                  </div>

                  {/* Google */}
                  {GOOGLE_CLIENT_ID ? (
                    <div className="space-y-2">
                      <div
                        ref={googleBtnRef}
                        className={`min-h-[40px] w-full rounded border border-bp-border/40 ${
                          googleReady ? '' : 'opacity-50'
                        } ${anyLoading ? 'pointer-events-none opacity-40' : ''} flex items-center justify-center`}
                      >
                        {!googleReady && (
                          <span className="text-[11px] text-bp-text-disabled">{googleInitError || 'Loading Google sign-in...'}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleGoogleClick}
                        disabled={!googleReady || googleLoading || anyLoading}
                        className="w-full py-1 text-[11px] text-bp-text-disabled transition-colors hover:text-bp-text-muted disabled:opacity-40"
                      >
                        {googleLoading ? 'Signing in with Google...' : 'Trouble with popup? Try fallback'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded border border-amber-500/15 bg-amber-500/5 p-2.5 text-xs text-amber-400/70">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>Google sign-in disabled. Set <code className="font-mono text-amber-400/90">VITE_GOOGLE_CLIENT_ID</code>.</span>
                    </div>
                  )}

                  {googleInitError && GOOGLE_CLIENT_ID && (
                    <div className="mt-2 flex items-start gap-2 rounded border border-amber-500/15 bg-amber-500/5 p-2.5 text-xs text-amber-400/70">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      <span>{googleInitError}</span>
                    </div>
                  )}

                  {/* Guest */}
                  <button
                    onClick={handleGuestLogin}
                    disabled={guestLoading || anyLoading}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-bp-border/40 bg-transparent py-2.5 text-sm text-bp-text-secondary transition-all hover:border-bp-primary/30 hover:bg-bp-primary/5 hover:text-bp-text disabled:opacity-40"
                  >
                    <UserCircle size={15} />
                    {guestLoading ? 'Creating session...' : 'Continue as Guest'}
                  </button>
                </>
              )}

              {/* ========== SIGN UP FORM (Simple — no OTP) ========== */}
              {mode === 'signup' && (
                <>
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div>
                      <label htmlFor="signup-email" className={LABEL_CLASS}>Email Address</label>
                      <input
                        id="signup-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="you@example.com"
                        autoComplete="email"
                        inputMode="email"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="signup-password" className={LABEL_CLASS}>Password</label>
                      <div className="relative">
                        <input
                          id="signup-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className={`${INPUT_CLASS} pr-11`}
                          placeholder="Min 8 characters"
                          autoComplete="new-password"
                          minLength={8}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-bp-text-disabled transition-colors hover:text-bp-text-secondary"
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="signup-confirm" className={LABEL_CLASS}>Confirm Password</label>
                      <input
                        id="signup-confirm"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={INPUT_CLASS}
                        placeholder="Repeat password"
                        autoComplete="new-password"
                        minLength={8}
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={otpSending || anyLoading}
                      className="relative w-full overflow-hidden rounded bg-bp-primary py-2.5 text-sm font-semibold text-white transition-all hover:bg-bp-primary-hover active:scale-[0.99] disabled:opacity-40"
                    >
                      {otpSending ? (
                        <span className="inline-flex items-center gap-2"><Spinner /> Sending verification code...</span>
                      ) : 'Create Account'}
                    </button>
                  </form>

                  {/* Divider */}
                  <div className="relative my-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-bp-border/30" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-[#0e1319] px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-bp-text-disabled">or continue with</span>
                    </div>
                  </div>

                  {/* Google (styled button — no ref, uses prompt API directly) */}
                  {GOOGLE_CLIENT_ID && (
                    <button
                      type="button"
                      onClick={handleGoogleClick}
                      disabled={!googleReady || googleLoading || anyLoading}
                      className="flex w-full items-center justify-center gap-2.5 rounded border border-bp-border/40 bg-transparent py-2.5 text-sm text-bp-text-secondary transition-all hover:border-bp-primary/30 hover:bg-bp-primary/5 hover:text-bp-text disabled:opacity-40"
                    >
                      <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.1 24.1 0 000 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                      {googleLoading ? 'Signing in...' : 'Continue with Google'}
                    </button>
                  )}

                  {/* Guest */}
                  <button
                    onClick={handleGuestLogin}
                    disabled={guestLoading || anyLoading}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded border border-bp-border/40 bg-transparent py-2.5 text-sm text-bp-text-secondary transition-all hover:border-bp-primary/30 hover:bg-bp-primary/5 hover:text-bp-text disabled:opacity-40"
                  >
                    <UserCircle size={15} />
                    {guestLoading ? 'Creating session...' : 'Continue as Guest'}
                  </button>
                </>
              )}

              {/* ========== OTP VERIFICATION FORM ========== */}
              {mode === 'otp' && (
                <>
                  <button
                    type="button"
                    onClick={() => switchMode('signup')}
                    className="mb-4 flex items-center gap-1.5 text-xs text-bp-text-muted transition-colors hover:text-bp-text-secondary"
                  >
                    <ArrowLeft size={13} />
                    Back to signup
                  </button>

                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <div>
                      <label htmlFor="otp-code" className={LABEL_CLASS}>Verification Code</label>
                      <input
                        id="otp-code"
                        type="text"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className={`${INPUT_CLASS} text-center text-lg tracking-[0.3em] font-mono`}
                        placeholder="000000"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        autoFocus
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={loading || anyLoading || otpCode.length !== 6}
                      className="relative w-full overflow-hidden rounded bg-bp-primary py-2.5 text-sm font-semibold text-white transition-all hover:bg-bp-primary-hover active:scale-[0.99] disabled:opacity-40"
                    >
                      {loading ? (
                        <span className="inline-flex items-center gap-2"><Spinner /> Verifying...</span>
                      ) : 'Verify & Create Account'}
                    </button>
                  </form>

                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={otpSending}
                    className="mt-4 w-full text-center text-xs text-bp-text-muted transition-colors hover:text-bp-primary disabled:opacity-40"
                  >
                    {otpSending ? 'Sending...' : "Didn't receive the code? Resend"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Demo access */}
          {demoMode && mode === 'signin' && (
            <div className="mt-5 rounded border border-bp-border/30 bg-[#0e1319]/60 p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-px flex-1 bg-bp-border/20" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-bp-text-disabled">Quick Access</span>
                <span className="h-px flex-1 bg-bp-border/20" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {DEMO_ACCOUNTS.map(({ role, label, description, icon: Icon }) => (
                  <button
                    key={role}
                    onClick={() => handleDemoLogin(role)}
                    disabled={demoLoading !== null || anyLoading}
                    className={`group rounded border p-3 text-center transition-all disabled:opacity-40 ${
                      demoLoading === role
                        ? 'border-bp-primary/40 bg-bp-primary/8'
                        : 'border-bp-border/25 hover:border-bp-primary/25 hover:bg-[#0a0f16]'
                    }`}
                  >
                    <Icon
                      size={16}
                      className={`mx-auto mb-1.5 ${
                        role === 'consumer' ? 'text-blue-400/60' : role === 'analyst' ? 'text-amber-400/60' : 'text-emerald-400/60'
                      } transition-colors group-hover:opacity-100`}
                    />
                    <div className="text-xs font-medium text-bp-text-secondary">{label}</div>
                    <div className="mt-0.5 text-[10px] leading-tight text-bp-text-disabled">{description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 text-center text-[10px] font-mono tracking-wider text-bp-text-disabled/50">
            NEPALOSINT INTELLIGENCE PLATFORM
          </div>
        </div>
      </div>

      <style>{`
        @keyframes nepalosint-scan {
          0% { top: -2px; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .nepalosint-scanline {
          animation: nepalosint-scan 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
