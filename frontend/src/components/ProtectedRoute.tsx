/**
 * Nepal OSINT Platform - Protected Route Component
 * Enforces role-based access control on frontend routes
 *
 * Supports:
 * - requiredRole: 'analyst' or 'dev' - requires specific minimum role
 * - Falls back to canAccess() check from usePermissions
 */
import { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { usePermissions } from '../hooks/usePermissions'
import { Lock } from 'lucide-react'
import { UserRole } from '../store/slices/authSlice'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: 'analyst' | 'dev'
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const location = useLocation()
  const { isDev, isAnalyst, canAccess, role } = usePermissions()

  // Check specific role requirement
  if (requiredRole === 'dev' && !isDev) {
    return <AccessDenied requiredRole="dev" currentRole={role} />
  }

  if (requiredRole === 'analyst' && !isAnalyst && !isDev) {
    return <AccessDenied requiredRole="analyst" currentRole={role} />
  }

  // Check general page access
  if (!canAccess(location.pathname)) {
    return <AccessDenied requiredRole={requiredRole} currentRole={role} />
  }

  return <>{children}</>
}

interface AccessDeniedProps {
  requiredRole?: string
  currentRole: UserRole | null
}

function AccessDenied({ requiredRole, currentRole }: AccessDeniedProps) {
  const roleDescription = {
    dev: 'Developer',
    analyst: 'Analyst or Developer',
    consumer: 'Consumer',
  }

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center p-8 max-w-md">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-severity-high/20 flex items-center justify-center">
          <Lock className="w-8 h-8 text-severity-high" />
        </div>
        <h2 className="text-2xl font-bold text-osint-text mb-2">Access Denied</h2>
        <p className="text-osint-muted mb-4">
          You don't have permission to access this page.
        </p>
        {requiredRole && (
          <p className="text-sm text-osint-muted mb-6">
            Required: <span className="font-medium text-osint-text">{roleDescription[requiredRole as keyof typeof roleDescription] || requiredRole}</span>
            <br />
            Your role: <span className="font-medium text-osint-text">{currentRole || 'Unknown'}</span>
          </p>
        )}
        <a
          href="/"
          className="inline-block px-6 py-2 bg-osint-accent text-white rounded-lg hover:bg-osint-accent/80 transition-colors"
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  )
}

export default ProtectedRoute
