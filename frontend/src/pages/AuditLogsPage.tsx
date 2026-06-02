import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { PageHeader } from '../components/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Paginated } from '../types'

interface AuditLog {
  id: number
  action: string
  entity_type?: string
  entity_id?: number
  ip_address?: string
  created_at: string
  user?: { name: string; email: string }
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])

  useEffect(() => {
    api
      .get<Paginated<AuditLog>>('/audit-logs', { params: { per_page: 100 } })
      .then((r) => setLogs(r.data.data))
  }, [])

  return (
    <div>
      <PageHeader title="Audit Logs" description="GDPR-ready activity trail for compliance" />

      <TableShell>
        <TableHead>
          <Th>Time</Th>
          <Th>User</Th>
          <Th>Action</Th>
          <Th>Entity</Th>
          <Th>IP</Th>
        </TableHead>
        <TableBody>
          {logs.map((log) => (
            <tr key={log.id}>
              <Td>{new Date(log.created_at).toLocaleString()}</Td>
              <Td>{log.user?.name ?? 'System'}</Td>
              <Td>
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{log.action}</code>
              </Td>
              <Td>{log.entity_type ? `${log.entity_type}#${log.entity_id}` : '—'}</Td>
              <Td>{log.ip_address ?? '—'}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
