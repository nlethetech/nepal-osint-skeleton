import { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CandidateDeepDive } from './components/elections/CandidateDeepDive'
import { Dashboard as NewDashboard } from './components/Dashboard'
import { MainLayout } from './components/layout/MainLayout'
// MobileBottomNav removed — election season, single-page mobile experience
import Analysis from './pages/Analysis'
import Indices from './pages/Indices'
import ActivityLogs from './pages/ActivityLogs'
import ReviewQueue from './pages/ReviewQueue'
import DisasterAlerts from './pages/DisasterAlerts'
import Login from './pages/Login'
import ChooseUsername from './pages/ChooseUsername'
import DevWorkstation from './pages/DevWorkstation'
import { UITestDashboard } from './components/Dashboard/UITestDashboard'
import { useAuthStore, User } from './store/slices/authSlice'
import { useUserPreferencesStore } from './store/slices/userPreferencesSlice'
import { ProtectedRoute } from './components/ProtectedRoute'
import { usePermissions } from './hooks/usePermissions'
import { guestLogin } from './api/auth'

const BUILD_MARKER = 'aviation-v55'

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
  const wasAuthenticatedRef = useRef(isAuthenticated)
  const shouldAttemptGuestBootstrap = location.pathname !== '/login'

  useEffect(() => {
    document.documentElement.setAttribute('data-build-marker', BUILD_MARKER)
  }, [])

  useEffect(() => {
    if (wasAuthenticatedRef.current && !isAuthenticated) {
      attemptedRef.current = false
      setAutoLoginError(false)
    }
    wasAuthenticatedRef.current = isAuthenticated
  }, [isAuthenticated])

  // Auto-login as guest when not authenticated
  useEffect(() => {
    if (!shouldAttemptGuestBootstrap || isAuthenticated || attemptedRef.current) return
    attemptedRef.current = true
    guestLogin()
      .then((result) => {
        login(result.access_token, result.refresh_token, toStoreUser(result.user))
      })
      .catch(() => {
        setAutoLoginError(true)
        attemptedRef.current = false
      })
  }, [isAuthenticated, login, shouldAttemptGuestBootstrap])

  // Show loading while auto-login is in progress
  if (!isAuthenticated && shouldAttemptGuestBootstrap && !autoLoginError) {
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
  if (!isAuthenticated && (!shouldAttemptGuestBootstrap || autoLoginError)) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Redirect to choose-username if needed (not for guests — they get auto-generated usernames)
  if (needsUsername && !isGuest) {
    return (
      <Routes>
        <Route path="/choose-username" element={<ChooseUsername />} />
        <Route path="*" element={<Navigate to="/choose-username" replace />} />
      </Routes>
    )
  }

  // Show onboarding if not completed (skip for consumer role and during elections)
  // Disabled during election season — everyone goes straight to election monitor
  // if (!hasCompletedOnboarding && !isConsumer) {
  //   return <Onboarding />
  // }

  // ============================================
  // UI TEST ROUTE
  // ============================================

  if (location.pathname === '/uitest' || location.pathname === '/uitest/') {
    return (
      <>
        <CandidateDeepDive />
        <AnimatedRoutes>
          <Routes>
            <Route path="/uitest" element={<UITestDashboard />} />
            <Route path="/uitest/" element={<UITestDashboard />} />
            <Route path="*" element={<Navigate to="/uitest" replace />} />
          </Routes>
        </AnimatedRoutes>
      </>
    )
  }

  // Consumer role: analyst dashboard is default landing page
  if (isConsumer) {
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
        {/* MobileBottomNav removed for election season */}
      </>
    )
  }

  // ============================================
  // DEV ROUTES (no analyst in consumer deployment)
  // ============================================

  // Dev Workstation (full-screen, no MainLayout)
  if (location.pathname.startsWith('/dev')) {
    return (
      <>
        <CandidateDeepDive />
        <AnimatedRoutes>
          <Routes>
            <Route path="/dev" element={<Navigate to="/dev/overview" replace />} />
            <Route path="/dev/*" element={<ProtectedRoute requiredRole="dev"><DevWorkstation /></ProtectedRoute>} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/dev/overview" replace />} />
          </Routes>
        </AnimatedRoutes>
        {/* MobileBottomNav removed for election season */}
      </>
    )
  }

  // All other routes — analyst dashboard is landing page
  return (
    <>
    <CandidateDeepDive />
    <MainLayout>
      <AnimatedRoutes>
        <Routes>
          <Route path="/" element={<NewDashboard />} />
          <Route path="/disasters" element={<DisasterAlerts />} />

          {/* Dev-only routes */}
          <Route path="/analysis" element={<ProtectedRoute requiredRole="dev"><Analysis /></ProtectedRoute>} />
          <Route path="/indices" element={<ProtectedRoute requiredRole="dev"><Indices /></ProtectedRoute>} />
          <Route path="/activity" element={<ProtectedRoute requiredRole="dev"><ActivityLogs /></ProtectedRoute>} />
          <Route path="/review-queue" element={<ProtectedRoute requiredRole="dev"><ReviewQueue /></ProtectedRoute>} />

          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatedRoutes>
    </MainLayout>
    {/* MobileBottomNav removed for election season */}
    </>
  )
}

export default App
