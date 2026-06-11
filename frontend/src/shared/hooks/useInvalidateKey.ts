import { useQueryClient } from '@tanstack/react-query'

/**
 * Invalidate exactly one query key after a mutation — the building block for
 * targeted invalidation (only refetch what the mutation actually changed).
 */
export function useInvalidateKey(key: readonly unknown[]) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: key })
}
