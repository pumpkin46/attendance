import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
import { StatCard } from '@/shared/ui/StatCard'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveEmployees } from '@/features/employees/api/queries'
import { ReportExportButtons } from '@/features/reports/components/ExportButtons'
import { useAttendanceRecords, useRecordManualAttendance } from '@/features/attendance/api/queries'
import type { AttendanceRecord } from '@/shared/types'
import { attendanceStatusTone, formatMinutes, formatTime } from '@/shared/lib/format'

const emptyManual = {
  employee_id: '',
  work_date: new Date().toISOString().slice(0, 10),
  check_in_at: '',
  check_out_at: '',
  notes: '',
}

const prettify = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')

const fmtDate = (work_date: string) =>
  new Date(`${work_date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export default function AttendancePage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [formOpen, setFormOpen] = useState(false)
  const [manual, setManual] = useState(emptyManual)
  const [search, setSearch] = useState('')

  // The status filter lives in the URL so the dashboard KPIs can deep-link to
  // it (e.g. /attendance?status=late) and filtered views stay shareable.
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') ?? ''
  const setStatusFilter = (value: string) =>
    setSearchParams(value ? { status: value } : {}, { replace: true })

  const { data, isPending, isError, error } = useAttendanceRecords(dateFrom, dateTo)
  const records = useMemo(() => data?.data ?? [], [data])

  const { data: employeesResp } = useActiveEmployees()
  const employees = employeesResp?.data ?? []

  const createManual = useRecordManualAttendance()

  const statusOptions = useMemo(() => {
    const set = new Set(records.map((r) => r.status).filter(Boolean))
    // A deep-linked status (e.g. /attendance?status=absent) may not exist in
    // the loaded range — keep it selectable so the dropdown reflects the URL.
    if (statusFilter) set.add(statusFilter)
    return [
      { value: '', label: 'All statuses' },
      ...Array.from(set, (s) => ({ value: s, label: prettify(s) })),
    ]
  }, [records, statusFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return records.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = r.employee
          ? `${r.employee.first_name} ${r.employee.last_name} ${r.employee.employee_code}`.toLowerCase()
          : ''
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [records, statusFilter, search])

  const stats = useMemo(() => {
    const workedMin = filtered.reduce((n, r) => n + (r.worked_minutes ?? 0), 0)
    const overtimeMin = filtered.reduce((n, r) => n + (r.overtime_minutes ?? 0), 0)
    return {
      total: filtered.length,
      present: filtered.filter((r) => r.status === 'present').length,
      issues: filtered.filter((r) => r.status === 'late' || r.status === 'early_leave').length,
      hours: (workedMin / 60).toFixed(1),
      overtime: (overtimeMin / 60).toFixed(1),
    }
  }, [filtered])

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manual.employee_id) return
    createManual.mutate(manual, {
      onSuccess: () => {
        setManual(emptyManual)
        setFormOpen(false)
      },
    })
  }

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Auto check-in on recognition with confidence and liveness; auto check-out at exit cameras per policy."
        actions={
          <div className="flex items-center gap-2">
            <DatePicker className="w-40" value={dateFrom} onChange={setDateFrom} max={dateTo} />
            <span className="text-sm text-slate-500">to</span>
            <DatePicker className="w-40" value={dateTo} onChange={setDateTo} min={dateFrom} />
            <Button onClick={() => setFormOpen((v) => !v)}>
              {formOpen ? 'Cancel' : 'Record manually'}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Records" value={stats.total} />
        <StatCard label="Present" value={stats.present} tone={stats.present ? 'ok' : undefined} />
        <StatCard label="Late / early" value={stats.issues} tone={stats.issues ? 'warn' : undefined} />
        <StatCard label="Hours worked" value={`${stats.hours}h`} />
        <StatCard
          label="Overtime"
          value={`${stats.overtime}h`}
          tone={Number(stats.overtime) > 0 ? 'warn' : undefined}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            className="w-64"
            placeholder="Search employee or code…"
            value={search}
            onChange={setSearch}
          />
          <Combobox
            className="w-48"
            value={statusFilter}
            onChange={setStatusFilter}
            options={statusOptions}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
          </span>
          {/* Exports the full date range server-side; the search/status filters
              above are client-side only and are not applied to the file. */}
          <ReportExportButtons
            params={{ report_type: 'attendance', date_from: dateFrom, date_to: dateTo }}
          />
        </div>
      </div>

      <SidePanel
        open={formOpen}
        title="Manual attendance entry"
        description="Record a check-in or check-out manually"
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button type="submit" form="manual-attendance-form" isLoading={createManual.isPending}>
              Save record
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <form
          id="manual-attendance-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={submitManual}
        >
          <Label className="sm:col-span-2">
            Employee *
            <Combobox
              value={manual.employee_id}
              onChange={(value) => setManual({ ...manual, employee_id: value })}
              required
            >
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.first_name} {e.last_name}
                </option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Work date *
            <DatePicker
              value={manual.work_date}
              onChange={(value) => setManual({ ...manual, work_date: value })}
              required
            />
          </Label>
          <Label>
            Check in
            <DatePicker
              withTime
              value={manual.check_in_at}
              onChange={(value) => setManual({ ...manual, check_in_at: value })}
            />
          </Label>
          <Label>
            Check out
            <DatePicker
              withTime
              value={manual.check_out_at}
              onChange={(value) => setManual({ ...manual, check_out_at: value })}
            />
          </Label>
          <Label className="sm:col-span-2">
            Notes
            <Input
              value={manual.notes}
              onChange={(e) => setManual({ ...manual, notes: e.target.value })}
              placeholder="Reason for manual entry"
            />
          </Label>
        </form>
      </SidePanel>

      <DataTable
        data={filtered}
        rowKey={(r) => r.id}
        pageSize={10}
        loading={isPending}
        error={isError ? getApiErrorMessage(error, 'Failed to load attendance records') : undefined}
        empty="No attendance records match these filters"
        columns={[
          { key: 'date', header: 'Date', cell: (r) => fmtDate(r.work_date) },
          {
            key: 'employee',
            header: 'Employee',
            cell: (r: AttendanceRecord) =>
              r.employee ? (
                <div>
                  <div className="font-medium text-slate-100">
                    {r.employee.first_name} {r.employee.last_name}
                  </div>
                  <div className="text-xs text-slate-500">{r.employee.employee_code}</div>
                </div>
              ) : (
                <span className="text-slate-500">—</span>
              ),
          },
          { key: 'check_in', header: 'Check in', cell: (r) => formatTime(r.check_in_at) },
          { key: 'check_out', header: 'Check out', cell: (r) => formatTime(r.check_out_at) },
          { key: 'worked', header: 'Hours', cell: (r) => formatMinutes(r.worked_minutes) },
          {
            key: 'overtime',
            header: 'Overtime',
            cell: (r) =>
              r.overtime_minutes > 0 ? (
                <span className="text-amber-400">{formatMinutes(r.overtime_minutes)}</span>
              ) : (
                <span className="text-slate-500">—</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge tone={attendanceStatusTone(r.status)}>
                {prettify(r.attendance_type ?? r.status)}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  )
}
