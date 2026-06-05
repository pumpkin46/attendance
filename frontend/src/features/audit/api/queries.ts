import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'
import type { AuditLog } from '@/features/audit/types'

export const auditKeys = {
  all: ['audit-logs'] as const,
  list: ['audit-logs', 'list'] as const,
}

export function useAuditLogs() {
  return useApiQuery<Paginated<AuditLog>>(auditKeys.list, '/audit-logs', { per_page: 100 })
}
