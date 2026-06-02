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
  const [loading, setLoading] = useState(true)

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const { data } = await api.get<User>('/auth/me')
      setUser(data)
    } catch {
      localStorage.removeItem('auth_token')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  const login = async (email: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', {
      email,
      password,
    })
    localStorage.setItem('auth_token', data.token)
    setUser(data.user)
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } finally {
      localStorage.removeItem('auth_token')
      setUser(null)
    }
  }

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

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
