import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiErrorMessage, isUnauthorizedError } from '../api/client'

/**
 * Surfaces request failures as toasts so they are never silently swallowed.
 * Pass `meta: { silent: true }` on a query/mutation to opt out (e.g. polling
 * best-effort dashboard widgets that should fail quietly).
 */
function notifyError(error: unknown, meta?: Record<string, unknown>) {
  if (isUnauthorizedError(error)) return // handled by the auth redirect
  if (meta?.silent) return
  toast.error(getApiErrorMessage(error))
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => notifyError(error, query.meta),
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => notifyError(error, mutation.meta),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
