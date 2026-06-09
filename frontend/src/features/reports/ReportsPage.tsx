import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { Tabs } from '@/shared/ui/Tabs'
import { DataTable } from '@/shared/ui/DataTable'
import { fetchReportExport, useDailyReport, useMonthlyReport } from '@/features/reports/api/queries'
import type { ExportFormat, ReportTab } from '@/features/reports/types'
import { attendanceStatusTone, formatMinutes, formatTime } from '@/shared/lib/format'

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' }),
}))

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

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

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Daily and monthly attendance reports with CSV, Excel, and PDF export."
      />

      <Tabs
        tabs={[
          { id: 'daily', label: 'Daily' },
          { id: 'monthly', label: 'Monthly' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          {tab === 'daily' ? (
            <label className="flex flex-col gap-1.5 text-sm text-slate-400">
              Report date
              <DatePicker className="w-44" value={dailyDate} onChange={setDailyDate} />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-sm text-slate-400">
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
              <label className="flex flex-col gap-1.5 text-sm text-slate-400">
                Month
                <Combobox
                  className="w-44"
                  value={monthNum}
                  onChange={setMonthNum}
                  options={MONTH_OPTIONS}
                />
              </label>
            </>
          )}

          <div className="ml-auto flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Export</span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                leftIcon={<DownloadIcon />}
                isLoading={exporting === 'csv'}
                disabled={!!exporting}
                onClick={() => downloadExport('csv')}
              >
                CSV
              </Button>
              <Button
                variant="ghost"
                leftIcon={<DownloadIcon />}
                isLoading={exporting === 'xlsx'}
                disabled={!!exporting}
                onClick={() => downloadExport('xlsx')}
              >
                Excel
              </Button>
              <Button
                variant="ghost"
                leftIcon={<DownloadIcon />}
                isLoading={exporting === 'pdf'}
                disabled={!!exporting}
                onClick={() => downloadExport('pdf')}
              >
                PDF
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {tab === 'daily' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Present" value={dailyReport?.present ?? 0} tone="ok" />
            <StatCard label="Late" value={dailyReport?.late ?? 0} tone="warn" />
            <StatCard label="Absent" value={dailyReport?.absent ?? 0} tone="danger" />
            <StatCard label="On leave" value={dailyReport?.on_leave ?? 0} />
          </div>

          <DataTable
            data={dailyReport?.employees ?? []}
            rowKey={(e) => e.employee_code}
            pageSize={10}
            loading={loading && !dailyReport}
            empty="No attendance records for this date"
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                cell: (e) => (
                  <div>
                    <div className="font-medium text-slate-100">{e.employee_name}</div>
                    <div className="text-xs text-slate-500">{e.employee_code}</div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (e) => (
                  <Badge tone={attendanceStatusTone(e.status)}>{e.status.replace(/_/g, ' ')}</Badge>
                ),
              },
              { key: 'check_in', header: 'Check in', cell: (e) => formatTime(e.check_in_at) },
              { key: 'check_out', header: 'Check out', cell: (e) => formatTime(e.check_out_at) },
              { key: 'worked', header: 'Worked', cell: (e) => formatMinutes(e.worked_minutes) },
              { key: 'overtime', header: 'Overtime', cell: (e) => formatMinutes(e.overtime_minutes) },
            ]}
          />
        </>
      )}

      {tab === 'monthly' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Working days" value={monthlyReport?.summary.total_working_days ?? 0} />
            <StatCard
              label="Attendance"
              value={`${monthlyReport?.summary.attendance_percent ?? 0}%`}
              tone="ok"
            />
            <StatCard
              label="Overtime"
              value={`${Math.round((monthlyReport?.summary.overtime_minutes ?? 0) / 60)}h`}
              tone="warn"
            />
            <StatCard
              label="Absences"
              value={monthlyReport?.summary.absence_count ?? 0}
              tone="danger"
            />
          </div>

          <DataTable
            data={monthlyReport?.employees ?? []}
            rowKey={(e) => e.employee_code}
            pageSize={10}
            loading={loading && !monthlyReport}
            empty="No data for this month"
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                cell: (e) => (
                  <div>
                    <div className="font-medium text-slate-100">{e.employee_name}</div>
                    <div className="text-xs text-slate-500">{e.employee_code}</div>
                  </div>
                ),
              },
              { key: 'department', header: 'Department', cell: (e) => e.department ?? '—' },
              { key: 'working_days', header: 'Working days', cell: (e) => e.total_working_days },
              {
                key: 'attendance',
                header: 'Attendance %',
                cell: (e) => `${e.attendance_percent}%`,
              },
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
