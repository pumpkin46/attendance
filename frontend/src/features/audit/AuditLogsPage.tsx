import { getApiErrorMessage } from '@/shared/api/client'
import { PageHeader } from '@/shared/ui/PageHeader'
import { DataTable } from '@/shared/ui/DataTable'
import { useAuditLogs } from '@/features/audit/api/queries'

export default function AuditLogsPage() {
  const { data, isPending, isError, error } = useAuditLogs()
  const logs = data?.data ?? []

  return (
    <div>
      <PageHeader title="Audit Logs" description="GDPR-ready activity trail for compliance" />

      <DataTable
        data={logs}
        rowKey={(log) => log.id}
        pageSize={10}
        loading={isPending}
        error={isError ? getApiErrorMessage(error, 'Failed to load audit logs') : undefined}
        columns={[
          { key: 'time', header: 'Time', cell: (log) => new Date(log.created_at).toLocaleString() },
          { key: 'user', header: 'User', cell: (log) => log.user?.name ?? 'System' },
          {
            key: 'action',
            header: 'Action',
            cell: (log) => (
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{log.action}</code>
            ),
          },
          {
            key: 'entity',
            header: 'Entity',
            cell: (log) => (log.entity_type ? `${log.entity_type}#${log.entity_id}` : '—'),
          },
          { key: 'ip', header: 'IP', cell: (log) => log.ip_address ?? '—' },
        ]}
      />
    </div>
  )
}
