import { Link } from 'react-router-dom'
import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import { useMonitoringDashboard, useMonitoringLiveFeed } from '@/features/monitoring/api/queries'

export default function MonitoringPage() {
  // Live via WebSocket ('recognition.*', 'access.*', 'cameras.changed',
  // 'visitors.changed'); resynced on reconnect. Only poll as a fallback when the
  // socket is down — while it's healthy, events keep this screen fresh.
  const poll = useFallbackPoll(60_000)
  const { data: dashboard } = useMonitoringDashboard(poll)
  const { data: liveFeed } = useMonitoringLiveFeed(poll)
  const events = liveFeed?.events ?? []

  const eventTone = (type: string) => {
    if (type.includes('unknown')) return 'danger' as const
    if (type.includes('offline')) return 'warn' as const
    if (type.includes('check_in') || type.includes('access_granted')) return 'ok' as const
    return 'neutral' as const
  }

  return (
    <div>
      <PageHeader
        title="Real-Time Monitoring Center"
        description="Live workforce, camera health, and security events"
        actions={
          <div className="flex gap-2 text-sm">
            <Link to="/cameras" className="text-blue-400 hover:text-blue-300">
              Cameras
            </Link>
            <Link to="/access-control" className="text-blue-400 hover:text-blue-300">
              Access
            </Link>
            <Link to="/visitors" className="text-blue-400 hover:text-blue-300">
              Visitors
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
        <StatCard label="Active cameras" value={`${dashboard?.active_cameras ?? '—'}/${dashboard?.total_cameras ?? '—'}`} />
        <StatCard label="Employees present" value={dashboard?.employees_present ?? '—'} tone="ok" />
        <StatCard label="Employees absent" value={dashboard?.employees_absent ?? '—'} tone="danger" />
        <StatCard label="Late employees" value={dashboard?.employees_late ?? '—'} tone="warn" />
        <StatCard label="Unknown persons" value={dashboard?.unknown_persons_today ?? '—'} tone="danger" />
        <StatCard label="Active visitors" value={dashboard?.active_visitors ?? '—'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-medium">Camera health</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-400">Online</span>
              <p className="text-xl font-semibold text-green-400">{dashboard?.camera_health?.online ?? 0}</p>
            </div>
            <div>
              <span className="text-slate-400">Offline</span>
              <p className="text-xl font-semibold text-amber-400">{dashboard?.camera_health?.offline ?? 0}</p>
            </div>
            <div>
              <span className="text-slate-400">Avg FPS</span>
              <p>{dashboard?.camera_health?.avg_fps?.toFixed(1) ?? '—'}</p>
            </div>
            <div>
              <span className="text-slate-400">Avg latency</span>
              <p>
                {dashboard?.camera_health?.avg_latency_ms != null
                  ? `${dashboard.camera_health.avg_latency_ms} ms`
                  : '—'}
              </p>
            </div>
          </div>
          <ul className="max-h-64 divide-y divide-slate-800 overflow-y-auto text-sm">
            {(dashboard?.cameras ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>{c.name}</span>
                <Badge tone={c.health?.online ?? c.online ? 'ok' : 'warn'}>
                  {c.health?.online ?? c.online ? 'Online' : 'Offline'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-medium">Live events feed</h2>
          <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
            {events.length === 0 ? (
              <li className="py-4 text-sm text-slate-400">No events yet today</li>
            ) : (
              events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-3">
                  <Badge tone={eventTone(e.event_type)}>{e.event_type.replace(/_/g, ' ')}</Badge>
                  <div>
                    <p className="text-sm">{e.message}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(e.occurred_at).toLocaleTimeString()}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>
    </div>
  )
}
