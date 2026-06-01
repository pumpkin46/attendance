import { useState } from 'react'
import { api } from '../api/client'

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  const loadSummary = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/reports/attendance-summary', {
        params: { date_from: dateFrom, date_to: dateTo },
      })
      setSummary(data)
    } finally {
      setLoading(false)
    }
  }

  const exportCsv = async () => {
    const { data } = await api.get<{ content: string }>('/reports/export', {
      params: { date_from: dateFrom, date_to: dateTo, format: 'csv' },
    })
    const blob = new Blob([data.content], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-${dateFrom}-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const byStatus = (summary?.by_status as Record<string, number>) ?? {}

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="muted">Attendance summaries, overtime, and exports</p>
        </div>
        <div className="filters">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={loadSummary} disabled={loading}>
            Run report
          </button>
          <button type="button" className="btn btn-ghost" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {summary && (
        <div className="stat-grid">
          {Object.entries(byStatus).map(([status, count]) => (
            <div key={status} className="stat-card">
              <span className="stat-label">{status}</span>
              <span className="stat-value">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
