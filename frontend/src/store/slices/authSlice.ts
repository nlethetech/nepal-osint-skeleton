import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole = 'consumer' | 'analyst' | 'dev'
export type AuthProvider = 'local' | 'google' | 'guest'

export interface User {
  id: string
  email: string
  fullName: string | null
  username: string | null
  role: UserRole
  authProvider: AuthProvider
  avatarUrl: string | null
}

interface AuthState {
  user: User | null
  token: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isGuest: boolean
  needsUsername: boolean
  login: (token: string, refreshToken: string, user: User) => void
  updateToken: (token: string) => void
  updateUser: (user: Partial<User>) => void
  logout: () => void
}

/** Safely check if username is needed (handles undefined authProvider from old state) */
function computeNeedsUsername(user: User | Partial<User>): boolean {
  if (!user.authProvider) return false // old state or unknown provider — don't redirect
  if (user.authProvider === 'guest') return false
  return !user.username
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isGuest: false,
      needsUsername: false,

      login: (token, refreshToken, user) => {
        set({
          token,
          refreshToken,
          user,
          isAuthenticated: true,
          isGuest: user.authProvider === 'guest',
          needsUsername: computeNeedsUsername(user),
        })
      },

      updateToken: (token) => {
        set({ token })
      },

      updateUser: (updates) => {
        const current = get().user
        if (!current) return
        const updated = { ...current, ...updates }
        set({
          user: updated,
          needsUsername: computeNeedsUsername(updated),
        })
      },

      logout: () => {
        set({
          token: null,
          refreshToken: null,
          user: null,
          isAuthenticated: false,
          isGuest: false,
          needsUsername: false,
        })
      },
    }),
    {
      name: 'nepal-osint-auth',
      // Version 2: added username, authProvider, avatarUrl to User.
      // Migrating from v1 clears auth state to force re-login with new schema.
      version: 2,
      migrate: (_persistedState, version) => {
        if (version < 2) {
          // Old state shape — force re-login
          return {
            user: null,
            token: null,
            refreshToken: null,
            isAuthenticated: false,
            isGuest: false,
            needsUsername: false,
          }
        }
        return _persistedState as AuthState
      },
    }
  )
)
