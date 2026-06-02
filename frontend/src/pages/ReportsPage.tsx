import { useState } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'

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
      <PageHeader
        title="Reports"
        description="Attendance summaries, overtime, and exports"
        actions={
          <>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-slate-500">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <Button onClick={loadSummary} disabled={loading}>
              Run report
            </Button>
            <Button variant="ghost" onClick={exportCsv}>
              Export CSV
            </Button>
          </>
        }
      />

      {summary && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {Object.entries(byStatus).map(([status, count]) => (
            <StatCard key={status} label={status} value={count} />
          ))}
        </div>
      )}
    </div>
  )
}
