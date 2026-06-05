import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { Badge } from '@/shared/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'

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
  const queryClient = useQueryClient()
  // Live via WebSocket ('recognition.*', 'access.*', 'security.changed');
  // resynced on reconnect. Only poll as a fallback when the socket is down —
  // while it's healthy, events keep this screen fresh.
  const poll = useFallbackPoll(60_000)
  const { data: dashboard } = useApiQuery<Dashboard>(
    ['security-monitoring', 'dashboard'],
    '/security-monitoring/dashboard',
    undefined,
    { silent: true, refetchInterval: poll }
  )
  const { data: alertsResp } = useApiQuery<{ data: SecurityAlert[] }>(
    ['security-monitoring', 'alerts'],
    '/security-monitoring/alerts',
    { per_page: 50 },
    { silent: true, refetchInterval: poll }
  )
  const alerts = alertsResp?.data ?? []

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['security-monitoring'] })

  const ackMutation = useMutation({
    mutationFn: (id: number) => api.post(`/security-monitoring/alerts/${id}/acknowledge`),
    onSuccess: invalidate,
  })
  const resolveMutation = useMutation({
    mutationFn: (id: number) => api.post(`/security-monitoring/alerts/${id}/resolve`),
    onSuccess: invalidate,
  })

  const acknowledge = (id: number) => ackMutation.mutate(id)
  const resolve = (id: number) => resolveMutation.mutate(id)

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
