import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { clearToken, getToken, setToken } from '../lib/session'
import type { User } from '../types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  hasPermission: (name: string) => boolean
  isSuperAdmin: () => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // Only "loading" when there is a token to validate, so the effect never has to
  // synchronously flip loading off for anonymous visitors.
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  useEffect(() => {
    const token = getToken()
    if (!token) return

    let cancelled = false
    void (async () => {
      try {
        const { data } = await api.get<User>('/auth/me')
        if (!cancelled) setUser(data)
      } catch {
        clearToken()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', {
      email,
      password,
    })
    setToken(data.token)
    setUser(data.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      clearToken()
      setUser(null)
    }
  }, [])

  const hasPermission = useCallback(
    (name: string) => {
      if (user?.roles?.some((r) => r.name === 'super_admin')) return true
      return user?.roles?.some((r) => r.permissions?.some((p) => p.name === name)) ?? false
    },
    [user]
  )

  const isSuperAdmin = useCallback(
    () => user?.roles?.some((r) => r.name === 'super_admin') ?? false,
    [user]
  )

  const value = useMemo(
    () => ({ user, loading, login, logout, hasPermission, isSuperAdmin }),
    [user, loading, login, logout, hasPermission, isSuperAdmin]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Colocated with the provider by convention; the hook is the sole consumer API.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
