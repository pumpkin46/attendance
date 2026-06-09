import { useState } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SidePanel } from '@/shared/ui/SidePanel'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveEmployees } from '@/features/employees/api/queries'
import { useAttendanceRecords, useRecordManualAttendance } from '@/features/attendance/api/queries'

const emptyManual = {
  employee_id: '',
  work_date: new Date().toISOString().slice(0, 10),
  check_in_at: '',
  check_out_at: '',
  notes: '',
}

export default function AttendancePage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [formOpen, setFormOpen] = useState(false)
  const [manual, setManual] = useState(emptyManual)

  const { data, isPending, isError, error } = useAttendanceRecords(dateFrom, dateTo)
  const records = data?.data ?? []

  const { data: employeesResp } = useActiveEmployees()
  const employees = employeesResp?.data ?? []

  const createManual = useRecordManualAttendance()

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

  const fmt = (v?: string) => (v ? new Date(v).toLocaleString() : '—')

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Auto check-in when recognized with confidence and liveness; auto check-out at exit cameras per policy rules."
        actions={
          <div className="flex items-center gap-2">
            <DatePicker value={dateFrom} onChange={(value) => setDateFrom(value)} />
            <span className="text-slate-500">to</span>
            <DatePicker value={dateTo} onChange={(value) => setDateTo(value)} />
            <Button onClick={() => setFormOpen((v) => !v)}>
              {formOpen ? 'Cancel' : 'Record manually'}
            </Button>
          </div>
        }
      />

      {formOpen && (
        <SidePanel
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
      )}

      <DataTable
        data={records}
        rowKey={(r) => r.id}
        pageSize={10}
        loading={isPending}
        error={isError ? getApiErrorMessage(error, 'Failed to load attendance records') : undefined}
        columns={[
          { key: 'date', header: 'Date', cell: (r) => r.work_date },
          {
            key: 'employee',
            header: 'Employee',
            cell: (r) =>
              r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '—',
          },
          { key: 'check_in', header: 'Check in', cell: (r) => fmt(r.check_in_at) },
          { key: 'check_out', header: 'Check out', cell: (r) => fmt(r.check_out_at) },
          { key: 'worked', header: 'Worked (min)', cell: (r) => r.worked_minutes },
          { key: 'overtime', header: 'Overtime', cell: (r) => r.overtime_minutes },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <Badge
                tone={
                  r.status === 'late' || r.status === 'early_leave'
                    ? 'warn'
                    : r.status === 'present'
                      ? 'ok'
                      : 'neutral'
                }
              >
                {(r.attendance_type ?? r.status).replace(/_/g, ' ')}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  )
}
