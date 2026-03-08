import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield, Check, X, Loader2 } from 'lucide-react'
import { setUsername as apiSetUsername, checkUsername as apiCheckUsername } from '../api/auth'
import { useAuthStore } from '../store/slices/authSlice'

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

export default function ChooseUsername() {
  const navigate = useNavigate()
  const { user, updateUser } = useAuthStore()
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Pre-fill suggestion from user's name
  useEffect(() => {
    if (user?.fullName) {
      const suggestion = user.fullName
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 20)
      if (suggestion.length >= 3) {
        setUsername(suggestion)
      }
    }
  }, [user?.fullName])

  // Debounced username availability check
  const checkAvailability = useCallback(async (value: string) => {
    if (value.length < 3 || !USERNAME_REGEX.test(value)) {
      setAvailable(null)
      return
    }
    setChecking(true)
    try {
      const result = await apiCheckUsername(value)
      setAvailable(result.available)
    } catch {
      setAvailable(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (username.length < 3) {
      setAvailable(null)
      return
    }
    const timer = setTimeout(() => checkAvailability(username), 400)
    return () => clearTimeout(timer)
  }, [username, checkAvailability])

  const validate = (value: string): string | null => {
    if (value.length < 3) return 'Username must be at least 3 characters'
    if (value.length > 20) return 'Username must be 20 characters or less'
    if (!USERNAME_REGEX.test(value)) return 'Only letters, numbers, and underscores allowed'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationError = validate(username)
    if (validationError) {
      setError(validationError)
      return
    }
    if (available === false) {
      setError('This username is already taken')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const updatedUser = await apiSetUsername(username)
      updateUser({ username: updatedUser.username })
      navigate('/')
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } }
      setError(error.response?.data?.detail || 'Failed to set username')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-osint-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-osint-accent/20 mb-4">
            <Shield size={32} className="text-osint-accent" />
          </div>
          <h1 className="text-2xl font-bold">Choose Your Username</h1>
          <p className="text-osint-muted mt-2">
            Pick a unique display name for the platform
          </p>
        </div>

        <div className="bg-osint-card border border-osint-border rounded-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-severity-critical/20 border border-severity-critical/30 rounded-lg p-3 text-sm text-severity-critical">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-2">
                Username
              </label>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    setError('')
                  }}
                  className="w-full bg-osint-bg border border-osint-border rounded-lg px-4 py-3 pr-10 focus:outline-none focus:border-osint-accent"
                  placeholder="e.g. nepal_analyst"
                  maxLength={20}
                  autoFocus
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {checking && <Loader2 size={18} className="text-osint-muted animate-spin" />}
                  {!checking && available === true && <Check size={18} className="text-emerald-400" />}
                  {!checking && available === false && <X size={18} className="text-severity-critical" />}
                </div>
              </div>
              <div className="flex justify-between mt-1.5">
                <p className="text-xs text-osint-muted">
                  3-20 characters, letters, numbers, underscores
                </p>
                {!checking && available === true && (
                  <span className="text-xs text-emerald-400">Available</span>
                )}
                {!checking && available === false && (
                  <span className="text-xs text-severity-critical">Taken</span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || checking || available === false || username.length < 3}
              className="w-full bg-osint-accent hover:bg-osint-accent-hover text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
            >
              {submitting ? 'Setting username...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
