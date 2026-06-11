import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'

interface ApiQueryOptions {
  /** Poll interval in ms. */
  refetchInterval?: number
  /** Disable the query until truthy. */
  enabled?: boolean
  /** Fail quietly without an error toast (best-effort widgets). */
  silent?: boolean
  /**
   * Keep showing the previous result while a new one loads (e.g. when a search
   * term or page changes), avoiding an empty flash between fetches.
   */
  keepPreviousData?: boolean
  /** Override the global 30s staleTime (e.g. STATIC_STALE_MS for reference data). */
  staleTime?: number
}

/**
 * staleTime for static reference data (configs, locations, permission
 * catalogs): content that only changes on deploy/admin action, never from
 * in-app mutations. Cuts the refetch on every page remount; explicit
 * invalidation (mutations, realtime events) still refetches immediately.
 */
export const STATIC_STALE_MS = 10 * 60_000

/**
 * Thin wrapper around `useQuery` for GET endpoints. Returns the response body
 * directly and centralises loading/error/caching for the whole app.
 */
export function useApiQuery<T>(
  key: readonly unknown[],
  url: string,
  params?: Record<string, unknown>,
  options: ApiQueryOptions = {}
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: async () => {
      const { data } = await api.get<T>(url, { params })
      return data
    },
    refetchInterval: options.refetchInterval,
    enabled: options.enabled,
    // Only set when provided: TanStack merges per-query options over the
    // client defaults by object spread, so an explicit `staleTime: undefined`
    // key would clobber the global 30s default down to 0 (always stale).
    ...(options.staleTime !== undefined && { staleTime: options.staleTime }),
    placeholderData: options.keepPreviousData ? keepPreviousData : undefined,
    meta: options.silent ? { silent: true } : undefined,
  })
}
