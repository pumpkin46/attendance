import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { StatCardSkeleton } from '../components/ui/Skeleton'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import { useApiQuery } from '../hooks/useApiQuery'
import type { AnomalySummary, CameraMonitoringSummary, PlatformHealth } from '../types'

interface TodaySummary {
  date: string
  present: number
  absent: number
  late: number
  on_leave: number
}

interface UnknownSummary {
  today: number
  unreviewed: number
}

interface AppNotification {
  id: string
  data: {
    type: string
    message: string
    recognized_at: string
    camera_name?: string
  }
  read_at?: string
  created_at: string
}

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useApiQuery<TodaySummary>(
    ['attendance', 'today'],
    '/attendance/today',
    undefined,
    { silent: true }
  )
  const { data: anomalySummary } = useApiQuery<AnomalySummary>(
    ['anomalies', 'summary'],
    '/anomalies/summary',
    undefined,
    { silent: true }
  )
  const { data: unknown } = useApiQuery<UnknownSummary>(
    ['recognition', 'unknown-summary'],
    '/recognition/unknown-summary',
    undefined,
    { silent: true }
  )
  const { data: cameraMonitoring } = useApiQuery<CameraMonitoringSummary>(
    ['cameras', 'monitoring'],
    '/cameras/monitoring',
    undefined,
    { silent: true, refetchInterval: 30_000 }
  )
  const { data: health } = useApiQuery<PlatformHealth>(['health'], '/health', undefined, {
    silent: true,
  })
  const { data: notificationsResp } = useApiQuery<{ data: AppNotification[] }>(
    ['notifications', 'unread'],
    '/notifications',
    { unread_only: true, per_page: 5 },
    { silent: true }
  )
  const notifications = notificationsResp?.data ?? []

  const nfr = health?.nfr_compliance?.nfr

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Real-time workforce attendance and camera monitoring"
      />

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {summaryLoading ? (
          Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="Present today" value={summary?.present ?? '—'} />
            <StatCard label="Late" value={summary?.late ?? '—'} tone="warn" />
            <StatCard label="Absent" value={summary?.absent ?? '—'} tone="danger" />
            <StatCard label="On leave" value={summary?.on_leave ?? '—'} />
            <StatCard label="Unknown faces today" value={unknown?.today ?? '—'} tone="danger" />
            <StatCard
              label="Open anomalies"
              value={anomalySummary?.open_total ?? '—'}
              tone={(anomalySummary?.critical ?? 0) > 0 ? 'danger' : 'warn'}
            />
          </>
        )}
      </div>

      <Card className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Camera monitoring (FR-020)</h2>
          <Link to="/cameras" className="text-sm text-blue-400 hover:text-blue-300">
            Manage cameras
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
          <StatCard label="Online" value={cameraMonitoring?.online ?? '—'} />
          <StatCard label="Offline" value={cameraMonitoring?.offline ?? '—'} tone="warn" />
          <StatCard
            label="Recognition count"
            value={cameraMonitoring?.recognition_count_today ?? '—'}
          />
        </div>

        <TableShell>
          <TableHead>
            <Th>Camera</Th>
            <Th>Location</Th>
            <Th>Online</Th>
            <Th>Frame rate</Th>
            <Th>Recognitions today</Th>
          </TableHead>
          <TableBody>
            {!cameraMonitoring?.cameras.length ? (
              <tr>
                <Td colSpan={5} className="text-slate-400">
                  No cameras registered
                </Td>
              </tr>
            ) : (
              cameraMonitoring.cameras.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td>{c.location?.name ?? '—'}</Td>
                  <Td>
                    <Badge tone={c.online ? 'ok' : 'warn'}>{c.online ? 'Online' : 'Offline'}</Badge>
                  </Td>
                  <Td>{c.frame_rate_fps != null ? `${c.frame_rate_fps} fps` : '—'}</Td>
                  <Td>{c.recognition_count_today ?? 0}</Td>
                </tr>
              ))
            )}
          </TableBody>
        </TableShell>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-medium">System status</h2>
          <ul className="divide-y divide-slate-800">
            <li className="flex items-center justify-between py-3">
              <span>API</span>
              <Badge tone="ok">Operational</Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>AI recognition service</span>
              <Badge tone={health?.status === 'healthy' ? 'ok' : 'warn'}>
                {health?.status ?? 'checking'}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Liveness (FR-017/018)</span>
              <Badge tone={health?.antispoof_model_loaded ? 'ok' : 'warn'}>
                {health?.antispoof_model_loaded ? 'Anti-spoof active' : 'Model missing'}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Recognition SLA (NFR-001)</span>
              <Badge tone="ok">&lt; 500 ms target</Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Password hashing (NFR-007)</span>
              <Badge tone={nfr?.['NFR-007']?.argon2_compliant ? 'ok' : 'warn'}>
                {nfr?.['NFR-007']?.hasher ?? 'argon2id'}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>GDPR (NFR-008)</span>
              <Badge tone={nfr?.['NFR-008']?.enabled ? 'ok' : 'neutral'}>
                {nfr?.['NFR-008']?.enabled ? 'Enabled' : 'Off'}
              </Badge>
            </li>
          </ul>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium">Security alerts (FR-011)</h2>
            <Link to="/unknown-faces" className="text-sm text-blue-400 hover:text-blue-300">
              View all
            </Link>
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-slate-400">No unread unknown-face alerts</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {notifications.map((n) => (
                <li key={n.id} className="py-3 text-sm">
                  <p>{n.data.message}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(n.data.recognized_at ?? n.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
