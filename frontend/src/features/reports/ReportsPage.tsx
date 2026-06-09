import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { DataTable } from '@/shared/ui/DataTable'
import { fetchReportExport, useDailyReport, useMonthlyReport } from '@/features/reports/api/queries'
import type { ExportFormat, ReportTab } from '@/features/reports/types'

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('daily')
  const [dailyDate, setDailyDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [monthYear, setMonthYear] = useState(() => String(new Date().getFullYear()))
  const [monthNum, setMonthNum] = useState(() => String(new Date().getMonth() + 1).padStart(2, '0'))
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  const dailyQuery = useDailyReport(dailyDate, tab === 'daily')
  const monthlyQuery = useMonthlyReport(monthYear, monthNum, tab === 'monthly')

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

      const data = await fetchReportExport(params)

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
                <DatePicker value={dailyDate} onChange={(value) => setDailyDate(value)} />
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
                <Combobox value={monthNum} onChange={(value) => setMonthNum(value)}>
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = String(i + 1).padStart(2, '0')
                    return (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    )
                  })}
                </Combobox>
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

          <DataTable
            data={dailyReport.employees ?? []}
            rowKey={(e) => e.employee_code}
            pageSize={10}
            empty="No attendance records for this date"
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                cell: (e) => (
                  <>
                    {e.employee_name}
                    <span className="ml-2 text-xs text-slate-500">{e.employee_code}</span>
                  </>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (e) => <Badge tone={statusTone(e.status)}>{e.status}</Badge>,
              },
              {
                key: 'check_in',
                header: 'Check in',
                cell: (e) => (e.check_in_at ? new Date(e.check_in_at).toLocaleTimeString() : '—'),
              },
              {
                key: 'check_out',
                header: 'Check out',
                cell: (e) => (e.check_out_at ? new Date(e.check_out_at).toLocaleTimeString() : '—'),
              },
              { key: 'worked', header: 'Worked', cell: (e) => `${e.worked_minutes} min` },
              { key: 'overtime', header: 'Overtime', cell: (e) => `${e.overtime_minutes} min` },
            ]}
          />
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

          <DataTable
            data={monthlyReport.employees ?? []}
            rowKey={(e) => e.employee_code}
            pageSize={10}
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                cell: (e) => (
                  <>
                    {e.employee_name}
                    <span className="ml-2 text-xs text-slate-500">{e.employee_code}</span>
                  </>
                ),
              },
              { key: 'department', header: 'Department', cell: (e) => e.department ?? '—' },
              { key: 'working_days', header: 'Working days', cell: (e) => e.total_working_days },
              { key: 'attendance', header: 'Attendance %', cell: (e) => `${e.attendance_percent}%` },
              { key: 'overtime', header: 'Overtime (hrs)', cell: (e) => e.overtime_hours },
              { key: 'absences', header: 'Absences', cell: (e) => e.absence_count },
              { key: 'late', header: 'Late', cell: (e) => e.late_count },
              { key: 'on_leave', header: 'On leave', cell: (e) => e.on_leave_count },
            ]}
          />
        </>
      )}
    </div>
  )
}
