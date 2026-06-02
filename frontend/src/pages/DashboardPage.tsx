import { useEffect, useState } from 'react'
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

export default function DashboardPage() {
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [aiHealth, setAiHealth] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    api.get<TodaySummary>('/attendance/today').then((r) => setSummary(r.data)).catch(() => {})
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
      </div>

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
        </ul>
      </Card>
    </div>
  )
}
