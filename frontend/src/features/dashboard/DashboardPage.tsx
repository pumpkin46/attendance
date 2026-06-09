import { Link } from 'react-router-dom'
import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { StatCardSkeleton } from '@/shared/ui/Skeleton'
import { DataTable } from '@/shared/ui/DataTable'
import {
  useAnomalySummary,
  useCameraMonitoring,
  usePlatformHealth,
  useTodaySummary,
  useUnknownSummary,
  useUnreadAlerts,
} from '@/features/dashboard/api/queries'

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useTodaySummary()
  const { data: anomalySummary } = useAnomalySummary()
  const { data: unknown } = useUnknownSummary()
  const { data: cameraMonitoring } = useCameraMonitoring()
  const { data: health } = usePlatformHealth()
  const { data: notificationsResp } = useUnreadAlerts()
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

        <DataTable
          data={cameraMonitoring?.cameras ?? []}
          rowKey={(c) => c.id}
          empty="No cameras registered"
          columns={[
            { key: 'camera', header: 'Camera', cell: (c) => c.name },
            { key: 'location', header: 'Location', cell: (c) => c.location?.name ?? '—' },
            {
              key: 'online',
              header: 'Online',
              cell: (c) => (
                <Badge tone={c.online ? 'ok' : 'warn'}>{c.online ? 'Online' : 'Offline'}</Badge>
              ),
            },
            {
              key: 'frame_rate',
              header: 'Frame rate',
              cell: (c) => (c.frame_rate_fps != null ? `${c.frame_rate_fps} fps` : '—'),
            },
            {
              key: 'recognitions',
              header: 'Recognitions today',
              cell: (c) => c.recognition_count_today ?? 0,
            },
          ]}
        />
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
