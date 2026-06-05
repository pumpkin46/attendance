import axios from 'axios'
import { clearToken, getOrgId, getToken } from '@/shared/lib/session'

const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

/** Extract a human-readable message from an axios/unknown error. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: string | { message?: string }; message?: string; detail?: string }
      | undefined
    // New envelope: { error: { code, message } }. Also tolerate legacy shapes
    // ({ error: "msg" }, FastAPI's { detail }) so older responses still read well.
    const err = data?.error
    const fromError = typeof err === 'string' ? err : err?.message
    return fromError ?? data?.message ?? data?.detail ?? error.message ?? fallback
  }
  return error instanceof Error ? error.message : fallback
}

/** True when the error is an HTTP 401 (handled by the auth redirect, never toasted). */
export function isUnauthorizedError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401
}

export const api = axios.create({
  baseURL: API_URL,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const orgId = getOrgId()
  if (orgId) {
    config.headers['X-Organization-Id'] = orgId
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      clearToken()
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)
