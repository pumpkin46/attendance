import { useState } from 'react'
import { api } from '../api/client'
import { useApiQuery } from '../hooks/useApiQuery'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'

interface DailyReport {
  date: string
  present: number
  absent: number
  late: number
  on_leave: number
  employees: Array<{
    employee_code: string
    employee_name: string
    status: string
    check_in_at?: string
    check_out_at?: string
    worked_minutes: number
    overtime_minutes: number
  }>
}

interface MonthlyReport {
  year: number
  month: number
  total_working_days: number
  summary: {
    total_working_days: number
    attendance_percent: number
    overtime_minutes: number
    absence_count: number
  }
  employees: Array<{
    employee_code: string
    employee_name: string
    department?: string
    total_working_days: number
    attendance_percent: number
    overtime_hours: number
    absence_count: number
    late_count: number
    on_leave_count: number
  }>
}

type ReportTab = 'daily' | 'monthly'
type ExportFormat = 'csv' | 'xlsx' | 'pdf'

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('daily')
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [monthYear, setMonthYear] = useState(() => String(new Date().getFullYear()))
  const [monthNum, setMonthNum] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  const dailyQuery = useApiQuery<DailyReport>(
    ['reports', 'daily', dailyDate],
    '/reports/daily',
    { date: dailyDate },
    { enabled: tab === 'daily' }
  )
  const monthlyQuery = useApiQuery<MonthlyReport>(
    ['reports', 'monthly', monthYear, monthNum],
    '/reports/monthly',
    { year: monthYear, month: monthNum },
    { enabled: tab === 'monthly' }
  )

  const dailyReport = dailyQuery.data
  const monthlyReport = monthlyQuery.data
  const loading = tab === 'daily' ? dailyQuery.isFetching : monthlyQuery.isFetching
  const loadDaily = () => dailyQuery.refetch()
  const loadMonthly = () => monthlyQuery.refetch()

  const downloadExport = async (format: ExportFormat) => {
    setExporting(format)
    try {
      const params =
        tab === 'daily'
          ? { format, report_type: 'daily', date: dailyDate }
          : { format, report_type: 'monthly', year: monthYear, month: monthNum }

      const { data } = await api.get<Blob>('/reports/export', {
        params,
        responseType: 'blob',
      })

      const ext = format === 'xlsx' ? 'xls' : format
      const basename =
        tab === 'daily'
          ? `daily-attendance-${dailyDate}`
          : `monthly-attendance-${monthYear}-${monthNum}`

      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${basename}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(null)
    }
  }

  const statusTone = (status: string) => {
    if (status === 'present') return 'ok'
    if (status === 'late') return 'warn'
    if (status === 'absent') return 'danger'
    return 'neutral'
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="FR-021 daily, FR-022 monthly attendance reports with CSV, Excel, and PDF export"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant={tab === 'daily' ? 'primary' : 'ghost'} onClick={() => setTab('daily')}>
              Daily
            </Button>
            <Button variant={tab === 'monthly' ? 'primary' : 'ghost'} onClick={() => setTab('monthly')}>
              Monthly
            </Button>
          </div>
        }
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {tab === 'daily' ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Date
                <Input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} />
              </label>
              <Button onClick={loadDaily} disabled={loading}>
                {loading ? 'Loading…' : 'Run daily report'}
              </Button>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Year
                <Input
                  type="number"
                  min={2000}
                  max={2100}
                  value={monthYear}
                  onChange={(e) => setMonthYear(e.target.value)}
                  className="w-28"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Month
                <Select value={monthNum} onChange={(e) => setMonthNum(e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = String(i + 1).padStart(2, '0')
                    return (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    )
                  })}
                </Select>
              </label>
              <Button onClick={loadMonthly} disabled={loading}>
                {loading ? 'Loading…' : 'Run monthly report'}
              </Button>
            </>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!!exporting} onClick={() => downloadExport('csv')}>
              {exporting === 'csv' ? '…' : 'Export CSV'}
            </Button>
            <Button variant="ghost" disabled={!!exporting} onClick={() => downloadExport('xlsx')}>
              {exporting === 'xlsx' ? '…' : 'Export Excel'}
            </Button>
            <Button variant="ghost" disabled={!!exporting} onClick={() => downloadExport('pdf')}>
              {exporting === 'pdf' ? '…' : 'Export PDF'}
            </Button>
          </div>
        </div>
      </Card>

      {tab === 'daily' && dailyReport && (
        <>
          <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
            <StatCard label="Present" value={dailyReport.present} />
            <StatCard label="Absent" value={dailyReport.absent} tone="danger" />
            <StatCard label="Late" value={dailyReport.late} tone="warn" />
            <StatCard label="On leave" value={dailyReport.on_leave} />
          </div>

          <TableShell>
            <TableHead>
              <Th>Employee</Th>
              <Th>Status</Th>
              <Th>Check in</Th>
              <Th>Check out</Th>
              <Th>Worked</Th>
              <Th>Overtime</Th>
            </TableHead>
            <TableBody>
              {(dailyReport.employees ?? []).length === 0 ? (
                <tr>
                  <Td colSpan={6} className="text-slate-400">
                    No attendance records for this date
                  </Td>
                </tr>
              ) : (
                dailyReport.employees?.map((e) => (
                  <tr key={e.employee_code}>
                    <Td>
                      {e.employee_name}
                      <span className="ml-2 text-xs text-slate-500">{e.employee_code}</span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    </Td>
                    <Td>{e.check_in_at ? new Date(e.check_in_at).toLocaleTimeString() : '—'}</Td>
                    <Td>{e.check_out_at ? new Date(e.check_out_at).toLocaleTimeString() : '—'}</Td>
                    <Td>{e.worked_minutes} min</Td>
                    <Td>{e.overtime_minutes} min</Td>
                  </tr>
                ))
              )}
            </TableBody>
          </TableShell>
        </>
      )}

      {tab === 'monthly' && monthlyReport && (
        <>
          <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            <StatCard label="Total working days" value={monthlyReport.summary.total_working_days} />
            <StatCard label="Attendance %" value={`${monthlyReport.summary.attendance_percent}%`} />
            <StatCard
              label="Overtime"
              value={`${Math.round(monthlyReport.summary.overtime_minutes / 60)} hrs`}
            />
            <StatCard label="Absence count" value={monthlyReport.summary.absence_count} tone="danger" />
          </div>

          <TableShell>
            <TableHead>
              <Th>Employee</Th>
              <Th>Department</Th>
              <Th>Working days</Th>
              <Th>Attendance %</Th>
              <Th>Overtime (hrs)</Th>
              <Th>Absences</Th>
              <Th>Late</Th>
              <Th>On leave</Th>
            </TableHead>
            <TableBody>
              {(monthlyReport.employees ?? []).map((e) => (
                <tr key={e.employee_code}>
                  <Td>
                    {e.employee_name}
                    <span className="ml-2 text-xs text-slate-500">{e.employee_code}</span>
                  </Td>
                  <Td>{e.department ?? '—'}</Td>
                  <Td>{e.total_working_days}</Td>
                  <Td>{e.attendance_percent}%</Td>
                  <Td>{e.overtime_hours}</Td>
                  <Td>{e.absence_count}</Td>
                  <Td>{e.late_count}</Td>
                  <Td>{e.on_leave_count}</Td>
                </tr>
              ))}
            </TableBody>
          </TableShell>
        </>
      )}
    </div>
  )
}
