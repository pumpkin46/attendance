import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'

interface Dashboard {
  open_total: number
  critical_open: number
  high_open: number
  today_total: number
  by_type: Record<string, number>
  recent: SecurityAlert[]
}

interface SecurityAlert {
  id: number
  alert_type: string
  severity: string
  title: string
  message: string
  status: string
  occurred_at: string
  camera?: { name: string }
  employee?: { first_name: string; last_name: string }
}

const severityTone: Record<string, 'danger' | 'warn' | 'ok' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
}

export default function SecurityMonitoringPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])

  const load = () => {
    api.get<Dashboard>('/security-monitoring/dashboard').then((r) => setDashboard(r.data))
    api
      .get<{ data: SecurityAlert[] }>('/security-monitoring/alerts', { params: { per_page: 50 } })
      .then((r) => setAlerts(r.data.data))
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 15_000)
    return () => clearInterval(timer)
  }, [])

  const acknowledge = async (id: number) => {
    await api.post(`/security-monitoring/alerts/${id}/acknowledge`)
    load()
  }

  const resolve = async (id: number) => {
    await api.post(`/security-monitoring/alerts/${id}/resolve`)
    load()
  }

  return (
    <div>
      <PageHeader
        title="AI Security Monitoring"
        description="Real-time alerts for unknown persons, spoof attempts, access denials, after-hours entry, and tailgating."
      />

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        <StatCard label="Open alerts" value={dashboard?.open_total ?? '—'} tone="warn" />
        <StatCard label="Critical" value={dashboard?.critical_open ?? '—'} tone="danger" />
        <StatCard label="High severity" value={dashboard?.high_open ?? '—'} tone="danger" />
        <StatCard label="Today" value={dashboard?.today_total ?? '—'} />
      </div>

      {dashboard?.by_type && Object.keys(dashboard.by_type).length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 text-lg font-medium">Alerts today by type</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(dashboard.by_type).map(([type, count]) => (
              <Badge key={type} tone="neutral">
                {type.replace(/_/g, ' ')}: {count}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <TableShell>
        <TableHead>
          <Th>Time</Th>
          <Th>Severity</Th>
          <Th>Type</Th>
          <Th>Title</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <Td className="text-xs whitespace-nowrap">{new Date(a.occurred_at).toLocaleString()}</Td>
              <Td>
                <Badge tone={severityTone[a.severity] ?? 'neutral'}>{a.severity}</Badge>
              </Td>
              <Td className="text-xs">{a.alert_type.replace(/_/g, ' ')}</Td>
              <Td>
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-slate-400">{a.message}</div>
              </Td>
              <Td className="capitalize">{a.status}</Td>
              <Td className="flex gap-1">
                {a.status === 'open' && (
                  <Button variant="ghost" onClick={() => acknowledge(a.id)}>
                    Ack
                  </Button>
                )}
                {a.status !== 'resolved' && (
                  <Button variant="ghost" onClick={() => resolve(a.id)}>
                    Resolve
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
