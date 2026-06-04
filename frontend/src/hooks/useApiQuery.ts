import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

interface ApiQueryOptions {
  /** Poll interval in ms. */
  refetchInterval?: number
  /** Disable the query until truthy. */
  enabled?: boolean
  /** Fail quietly without an error toast (best-effort widgets). */
  silent?: boolean
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
    meta: options.silent ? { silent: true } : undefined,
  })
}
