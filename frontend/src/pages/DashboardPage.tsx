import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'

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
  const [unknown, setUnknown] = useState<UnknownSummary | null>(null)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [aiHealth, setAiHealth] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    api.get<TodaySummary>('/attendance/today').then((r) => setSummary(r.data)).catch(() => {})
    api.get<UnknownSummary>('/recognition/unknown-summary').then((r) => setUnknown(r.data)).catch(() => {})
    api
      .get<{ data: AppNotification[] }>('/notifications', { params: { unread_only: true, per_page: 5 } })
      .then((r) => setNotifications(r.data.data))
      .catch(() => {})
    fetch('http://127.0.0.1:8001/health')
      .then((r) => r.json())
      .then(setAiHealth)
      .catch(() => setAiHealth({ status: 'unavailable' }))
  }, [])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Real-time workforce attendance overview"
      />

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        <StatCard label="Present today" value={summary?.present ?? '—'} />
        <StatCard label="Late" value={summary?.late ?? '—'} tone="warn" />
        <StatCard label="Absent" value={summary?.absent ?? '—'} tone="danger" />
        <StatCard label="On leave" value={summary?.on_leave ?? '—'} />
        <StatCard label="Unknown faces today" value={unknown?.today ?? '—'} tone="danger" />
      </div>

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
              <span>Recognition threshold</span>
              <span className="text-slate-300">≥ 95%</span>
            </li>
            <li className="flex items-center justify-between py-3">
              <span>Face matching (FR-010)</span>
              <Badge tone="ok">FAISS embeddings</Badge>
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
