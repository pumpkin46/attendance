import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

/** Extract a human-readable message from an axios/unknown error. */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; message?: string } | undefined
    return data?.error ?? data?.message ?? error.message ?? fallback
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
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  const orgId = localStorage.getItem('tenant_organization_id')
  if (orgId) {
    config.headers['X-Organization-Id'] = orgId
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)
