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
}

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
    placeholderData: options.keepPreviousData ? keepPreviousData : undefined,
    meta: options.silent ? { silent: true } : undefined,
  })
}
