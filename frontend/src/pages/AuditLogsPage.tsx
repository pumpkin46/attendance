import { useEffect, useState } from 'react'
import { api } from '../api/client'
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
      <h1>Audit Logs</h1>
      <p className="muted">GDPR-ready activity trail for compliance</p>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString()}</td>
                <td>{log.user?.name ?? 'System'}</td>
                <td><code>{log.action}</code></td>
                <td>
                  {log.entity_type
                    ? `${log.entity_type}#${log.entity_id}`
                    : '—'}
                </td>
                <td>{log.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
