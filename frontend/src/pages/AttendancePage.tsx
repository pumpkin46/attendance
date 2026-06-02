import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { AttendanceRecord, Paginated } from '../types'

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    api
      .get<Paginated<AttendanceRecord>>('/attendance', {
        params: { date_from: dateFrom, date_to: dateTo, per_page: 100 },
      })
      .then((r) => setRecords(r.data.data))
  }, [dateFrom, dateTo])

  const fmt = (v?: string) => (v ? new Date(v).toLocaleString() : '—')

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Automated check-in/out via face recognition"
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
                <Badge tone={r.status === 'late' ? 'warn' : 'neutral'}>{r.status}</Badge>
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
