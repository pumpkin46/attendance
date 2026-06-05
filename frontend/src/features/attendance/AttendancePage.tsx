import { useState } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
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
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-slate-500">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <Button onClick={() => setFormOpen((v) => !v)}>
              {formOpen ? 'Cancel' : 'Record manually'}
            </Button>
          </div>
        }
      />

      {formOpen && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">Manual attendance entry</h2>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submitManual}>
            <Label>
              Employee *
              <Select
                value={manual.employee_id}
                onChange={(e) => setManual({ ...manual, employee_id: e.target.value })}
                required
              >
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.first_name} {e.last_name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Work date *
              <Input
                type="date"
                value={manual.work_date}
                onChange={(e) => setManual({ ...manual, work_date: e.target.value })}
                required
              />
            </Label>
            <Label>
              Check in
              <Input
                type="datetime-local"
                value={manual.check_in_at}
                onChange={(e) => setManual({ ...manual, check_in_at: e.target.value })}
              />
            </Label>
            <Label>
              Check out
              <Input
                type="datetime-local"
                value={manual.check_out_at}
                onChange={(e) => setManual({ ...manual, check_out_at: e.target.value })}
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
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={createManual.isPending}>
                Save record
              </Button>
            </div>
          </form>
        </Card>
      )}

      <TableShell>
        <TableHead>
          <Th>Date</Th>
          <Th>Employee</Th>
          <Th>Check in</Th>
          <Th>Check out</Th>
          <Th>Worked (min)</Th>
          <Th>Overtime</Th>
          <Th>Status</Th>
        </TableHead>
        {isPending ? (
          <TableBody>
            <tr>
              <Td colSpan={7} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          </TableBody>
        ) : isError ? (
          <TableBody>
            <tr>
              <Td colSpan={7} className="text-rose-400">
                {getApiErrorMessage(error, 'Failed to load attendance records')}
              </Td>
            </tr>
          </TableBody>
        ) : (
          <TableBody>
            {records.map((r) => (
              <tr key={r.id}>
                <Td>{r.work_date}</Td>
                <Td>
                  {r.employee ? `${r.employee.first_name} ${r.employee.last_name}` : '—'}
                </Td>
                <Td>{fmt(r.check_in_at)}</Td>
                <Td>{fmt(r.check_out_at)}</Td>
                <Td>{r.worked_minutes}</Td>
                <Td>{r.overtime_minutes}</Td>
                <Td>
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
                </Td>
              </tr>
            ))}
          </TableBody>
        )}
      </TableShell>
    </div>
  )
}
