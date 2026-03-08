/**
 * Nepal OSINT Platform - Permissions Hook
 * Role-based access control for frontend features and routes
 *
 * Consumer deployment: consumer + dev roles only (no analyst)
 *
 * Roles:
 * - consumer: Read-only dashboard access
 * - dev: Full access including ML controls, training, user management
 */
import { useAuthStore, UserRole } from '../store/slices/authSlice'

// Pages accessible to all authenticated users (including consumer)
const CONSUMER_PAGES = new Set([
  '/',
  '/stories',
  '/alerts',
  '/disasters',
  '/elections',
])

// Dev-only pages
const DEV_ONLY_PAGES = new Set([
  '/indices',
  '/analysis',
  '/activity',
  '/review-queue',
  '/admin',
  '/dev',
])

export interface PermissionsResult {
  role: UserRole | null
  isConsumer: boolean
  isAnalyst: boolean
  isDev: boolean

  // Backward compatibility
  isTester: boolean

  // Feature permissions
  canProvideFeedback: boolean
  canManageEntities: boolean
  canCreateWatchItems: boolean
  canViewMetrics: boolean
  canTriggerTraining: boolean
  canManageUsers: boolean
  canViewSystemMetrics: boolean

  // Route access
  canAccess: (page: string) => boolean
  allowedPages: string[]
  devOnlyPages: string[]
}

export function usePermissions(): PermissionsResult {
  const { user } = useAuthStore()

  const role = user?.role || null
  const isConsumer = role === 'consumer'
  const isAnalyst = role === 'analyst'
  const isDev = role === 'dev'

  const isAuthenticatedRole = isConsumer || isAnalyst || isDev

  const canAccess = (page: string): boolean => {
    if (!user) return false

    // Strip trailing slash for comparison
    const normalizedPage = page.replace(/\/$/, '') || '/'

    // Handle dynamic routes (e.g., /dossier/person/123)
    const basePage = normalizedPage.split('/').slice(0, 2).join('/') || '/'

    // Dev has full access
    if (isDev) return true

    // Check if it's a dev-only page
    if (DEV_ONLY_PAGES.has(basePage)) return false

    // Consumer (and analyst in this deployment) can only access consumer pages
    return CONSUMER_PAGES.has(basePage)
  }

  const getAllowedPages = (): string[] => {
    if (isDev) {
      return [...CONSUMER_PAGES, ...DEV_ONLY_PAGES]
    }
    return [...CONSUMER_PAGES]
  }

  return {
    role,
    isConsumer,
    isAnalyst,
    isDev,

    // Backward compatibility (treat consumer like old tester)
    isTester: isConsumer,

    // Feature permissions based on role
    canProvideFeedback: isAuthenticatedRole,
    canManageEntities: isDev,
    canCreateWatchItems: isDev,
    canViewMetrics: isDev,
    canTriggerTraining: isDev,
    canManageUsers: isDev,
    canViewSystemMetrics: isDev,

    // Route access
    canAccess,
    allowedPages: getAllowedPages(),
    devOnlyPages: [...DEV_ONLY_PAGES],
  }
}
