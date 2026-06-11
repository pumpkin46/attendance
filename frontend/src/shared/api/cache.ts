import type { Paginated } from '@/shared/types'

/**
 * Cache updater that drops a row from a `Paginated` list after a hard delete.
 *
 * `total` is decremented only when the row was actually in this cached list —
 * an unconditional `total - 1` would drift counts on list variants that never
 * contained the row (search results, pickers, other features' copies).
 */
export function removeRowFromPaginated<T extends { id: number }>(id: number) {
  return (old: Paginated<T> | undefined): Paginated<T> | undefined => {
    if (!old) return old
    const data = old.data.filter((row) => row.id !== id)
    if (data.length === old.data.length) return old
    return { ...old, data, total: old.total - 1 }
  }
}
