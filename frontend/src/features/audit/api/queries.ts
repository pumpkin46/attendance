import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'
import type {
  AuditFacets,
  AuditLog,
  AuditLogFilters,
  AuditStats,
} from '@/features/audit/types'

export const auditKeys = {
  all: ['audit-logs'] as const,
  list: (filters: AuditLogFilters) => ['audit-logs', 'list', filters] as const,
  stats: ['audit-logs', 'stats'] as const,
  facets: ['audit-logs', 'facets'] as const,
}

/** All times the API filters/aggregates on are shifted to the viewer's day. */
const tzOffset = () => new Date().getTimezoneOffset()

export function useAuditLogs(filters: AuditLogFilters) {
  return useApiQuery<Paginated<AuditLog>>(
    auditKeys.list(filters),
    '/audit-logs',
    { ...filters, tz_offset: tzOffset() },
    { keepPreviousData: true }
  )
}

export function useAuditStats() {
  return useApiQuery<AuditStats>(auditKeys.stats, '/audit-logs/stats', {
    tz_offset: tzOffset(),
  })
}

export function useAuditFacets() {
  return useApiQuery<AuditFacets>(auditKeys.facets, '/audit-logs/facets')
}

/**
 * Fetch an audit-trail export (csv/xlsx) for client-side download. The
 * filename comes from the response's Content-Disposition — the backend is the
 * single source of truth for naming.
 */
export async function fetchAuditExport(
  params: Record<string, string | number | undefined>
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await api.get<Blob>('/audit-logs/export', {
    params: { ...params, tz_offset: tzOffset() },
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return { blob: res.data, filename: match?.[1] ?? null }
}
