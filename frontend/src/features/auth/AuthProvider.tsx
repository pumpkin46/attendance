import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  changePassword,
  fetchCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  selectAuthLoading,
  selectUser,
  updateProfile,
} from '@/features/auth/authSlice'
import { getToken } from '@/shared/lib/session'

/**
 * Auth state now lives in the Redux store (`store/authSlice`). This module is a
 * thin compatibility layer:
 *   - `AuthProvider` bootstraps the session by validating any persisted token.
 *   - `useAuth` exposes the same shape components already consume, backed by
 *     Redux selectors/thunks.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch()

  useEffect(() => {
    // Only validate when a token is present; otherwise the store already starts
    // in the 'anonymous' state.
    if (getToken()) {
      void dispatch(fetchCurrentUser())
    }
  }, [dispatch])

  return <>{children}</>
}

// Colocated with the provider by convention; the hook is the sole consumer API.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const dispatch = useAppDispatch()
  const user = useAppSelector(selectUser)
  const loading = useAppSelector(selectAuthLoading)

  const login = useCallback(
    async (email: string, password: string) => {
      await dispatch(loginUser({ email, password })).unwrap()
    },
    [dispatch]
  )

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      await dispatch(registerUser({ name, email, password })).unwrap()
    },
    [dispatch]
  )

  const logout = useCallback(async () => {
    await dispatch(logoutUser())
  }, [dispatch])

  const saveProfile = useCallback(
    async (changes: { name?: string; email?: string }) => {
      await dispatch(updateProfile(changes)).unwrap()
    },
    [dispatch]
  )

  const changeUserPassword = useCallback(
    async (current_password: string, new_password: string) => {
      await dispatch(changePassword({ current_password, new_password })).unwrap()
    },
    [dispatch]
  )

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

  return useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      hasPermission,
      isSuperAdmin,
      saveProfile,
      changeUserPassword,
    }),
    [user, loading, login, register, logout, hasPermission, isSuperAdmin, saveProfile, changeUserPassword]
  )
}
