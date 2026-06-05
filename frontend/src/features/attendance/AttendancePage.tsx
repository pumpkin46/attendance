import { useState } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Input } from '@/shared/ui/Input'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { AttendanceRecord, Paginated } from '@/shared/types'

export default function AttendancePage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  const { data, isPending, isError, error } = useApiQuery<Paginated<AttendanceRecord>>(
    ['attendance', 'list', { dateFrom, dateTo }],
    '/attendance',
    { date_from: dateFrom, date_to: dateTo, per_page: 100 }
  )
  const records = data?.data ?? []

  const fmt = (v?: string) => (v ? new Date(v).toLocaleString() : '—')

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Auto check-in when recognized with confidence and liveness; auto check-out at exit cameras per policy rules."
        actions={
          <>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-slate-500">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </>
        }
      />

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
