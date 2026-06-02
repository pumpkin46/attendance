import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { CameraMonitoringSummary } from '../types'

interface AnomalySummary {
  open_total: number
  critical: number
}

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
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [anomalySummary, setAnomalySummary] = useState<AnomalySummary | null>(null)
  const [unknown, setUnknown] = useState<UnknownSummary | null>(null)
  const [cameraMonitoring, setCameraMonitoring] = useState<CameraMonitoringSummary | null>(null)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [aiHealth, setAiHealth] = useState<Record<string, unknown> | null>(null)
  const [platformHealth, setPlatformHealth] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    api.get<TodaySummary>('/attendance/today').then((r) => setSummary(r.data)).catch(() => {})
    api.get<AnomalySummary>('/anomalies/summary').then((r) => setAnomalySummary(r.data)).catch(() => {})
    api.get<UnknownSummary>('/recognition/unknown-summary').then((r) => setUnknown(r.data)).catch(() => {})
    api.get<CameraMonitoringSummary>('/cameras/monitoring').then((r) => setCameraMonitoring(r.data)).catch(() => {})
    api.get<Record<string, unknown>>('/health').then((r) => setPlatformHealth(r.data)).catch(() => {})
    api
      .get<{ data: AppNotification[] }>('/notifications', { params: { unread_only: true, per_page: 5 } })
      .then((r) => setNotifications(r.data.data))
      .catch(() => {})
    fetch('http://127.0.0.1:8001/health')
      .then((r) => r.json())
      .then(setAiHealth)
      .catch(() => setAiHealth({ status: 'unavailable' }))

    const timer = setInterval(() => {
      api.get<CameraMonitoringSummary>('/cameras/monitoring').then((r) => setCameraMonitoring(r.data)).catch(() => {})
    }, 30_000)

    return () => clearInterval(timer)
  }, [])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Real-time workforce attendance and camera monitoring"
      />

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
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
              <Badge tone={aiHealth?.status === 'ok' ? 'ok' : 'warn'}>
                {String(aiHealth?.status ?? 'checking')}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Liveness (FR-017/018)</span>
              <Badge tone={aiHealth?.antispoof_model_loaded ? 'ok' : 'warn'}>
                {aiHealth?.antispoof_model_loaded ? 'Anti-spoof active' : 'Model missing'}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Recognition SLA (NFR-001)</span>
              <Badge tone="ok">&lt; 500 ms target</Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Password hashing (NFR-007)</span>
              <Badge
                tone={
                  (platformHealth?.nfr_compliance as { nfr?: { 'NFR-007'?: { argon2_compliant?: boolean } } })
                    ?.nfr?.['NFR-007']?.argon2_compliant
                    ? 'ok'
                    : 'warn'
                }
              >
                {String(
                  (platformHealth?.nfr_compliance as { nfr?: { 'NFR-007'?: { hasher?: string } } })?.nfr?.[
                    'NFR-007'
                  ]?.hasher ?? 'argon2id'
                )}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>GDPR (NFR-008)</span>
              <Badge
                tone={
                  (platformHealth?.nfr_compliance as { nfr?: { 'NFR-008'?: { enabled?: boolean } } })?.nfr?.[
                    'NFR-008'
                  ]?.enabled
                    ? 'ok'
                    : 'neutral'
                }
              >
                {(
                  platformHealth?.nfr_compliance as { nfr?: { 'NFR-008'?: { enabled?: boolean } } }
                )?.nfr?.['NFR-008']?.enabled
                  ? 'Enabled'
                  : 'Off'}
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
