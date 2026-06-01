import { useEffect, useState } from 'react'
import { api } from '../api/client'

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
      <h1>Dashboard</h1>
      <p className="muted">Real-time workforce attendance overview</p>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Present today</span>
          <span className="stat-value">{summary?.present ?? '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Late</span>
          <span className="stat-value warn">{summary?.late ?? '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Absent</span>
          <span className="stat-value danger">{summary?.absent ?? '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">On leave</span>
          <span className="stat-value">{summary?.on_leave ?? '—'}</span>
        </div>
      </div>

      <div className="card">
        <h2>System status</h2>
        <ul className="status-list">
          <li>
            <span>API</span>
            <span className="badge badge-ok">Operational</span>
          </li>
          <li>
            <span>AI recognition service</span>
            <span
              className={`badge ${aiHealth?.status === 'ok' ? 'badge-ok' : 'badge-warn'}`}
            >
              {String(aiHealth?.status ?? 'checking')}
            </span>
          </li>
          <li>
            <span>Recognition threshold</span>
            <span>≥ 95%</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
