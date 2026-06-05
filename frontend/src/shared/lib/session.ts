/**
 * Single source of truth for browser-persisted session state.
 *
 * Auth token and tenant org id were previously read/written via raw
 * `localStorage` calls scattered across the api client, contexts and pages.
 * Everything now goes through this module so the storage keys live in one place
 * and cross-tab logout can be observed via the `storage` event.
 */

const TOKEN_KEY = 'auth_token'
const ORG_KEY = 'tenant_organization_id'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function getOrgId(): string | null {
  return localStorage.getItem(ORG_KEY)
}

export function setOrgId(orgId: string): void {
  localStorage.setItem(ORG_KEY, orgId)
}

export function clearOrgId(): void {
  localStorage.removeItem(ORG_KEY)
}

/** Subscribe to token changes made in other tabs (cross-tab logout/login). */
export function onTokenChange(handler: (token: string | null) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY) handler(e.newValue)
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
