import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CandidateDeepDive } from './components/elections/CandidateDeepDive'
import { Dashboard as NewDashboard } from './components/Dashboard'
import Login from './pages/Login'
import ChooseUsername from './pages/ChooseUsername'
import DisasterAlerts from './pages/DisasterAlerts'
import { useAuthStore, User } from './store/slices/authSlice'
import { useUserPreferencesStore } from './store/slices/userPreferencesSlice'
import { usePermissions } from './hooks/usePermissions'
import { guestLogin } from './api/auth'

function toStoreUser(apiUser: {
  id: string; email: string; full_name: string | null; username: string | null;
  role: string; auth_provider: string; avatar_url: string | null;
}): User {
  return {
    id: apiUser.id, email: apiUser.email, fullName: apiUser.full_name,
    username: apiUser.username, role: apiUser.role as User['role'],
    authProvider: apiUser.auth_provider as User['authProvider'],
    avatarUrl: apiUser.avatar_url,
  }
}

const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.15 },
}

function AnimatedRoutes({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} {...pageTransition} style={{ display: 'contents' }}>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

function App() {
  const location = useLocation()
  const { isAuthenticated, needsUsername, isGuest, login } = useAuthStore()
  const { hasCompletedOnboarding } = useUserPreferencesStore()
  const { isConsumer } = usePermissions()
  const [autoLoginError, setAutoLoginError] = useState(false)
  const attemptedRef = useRef(false)

  // Auto-login as guest when not authenticated
  useEffect(() => {
    if (isAuthenticated || attemptedRef.current) return
    attemptedRef.current = true
    guestLogin()
      .then((result) => {
        login(result.access_token, result.refresh_token, toStoreUser(result.user))
      })
      .catch(() => {
        setAutoLoginError(true)
      })
  }, [isAuthenticated, login])

  // Show loading while auto-login is in progress
  if (!isAuthenticated && !autoLoginError) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#080b11', color: '#8f99a8',
        fontFamily: "'SF Mono', monospace", fontSize: 13, flexDirection: 'column', gap: 12,
      }}>
        <div style={{ width: 24, height: 24, border: '2px solid #2d72d2', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span>Initializing NepalOSINT...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Fallback to manual login if auto-guest fails
  if (!isAuthenticated && autoLoginError) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Redirect to choose-username if needed (not for guests)
  if (needsUsername && !isGuest) {
    return (
      <Routes>
        <Route path="/choose-username" element={<ChooseUsername />} />
        <Route path="*" element={<Navigate to="/choose-username" replace />} />
      </Routes>
    )
  }

  // Public dashboard routes only
  return (
    <>
      <CandidateDeepDive />
      <AnimatedRoutes>
        <Routes>
          <Route path="/" element={<NewDashboard />} />
          <Route path="/login" element={<Login />} />
          <Route path="/disasters" element={<DisasterAlerts />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatedRoutes>
    </>
  )
}

export default App
