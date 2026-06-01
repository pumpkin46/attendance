import { useEffect, useState } from 'react'
import { api } from '../api/client'
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
      <div className="page-header">
        <div>
          <h1>Attendance</h1>
          <p className="muted">Automated check-in/out via face recognition</p>
        </div>
        <div className="filters">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Check in</th>
              <th>Check out</th>
              <th>Worked (min)</th>
              <th>Overtime</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.work_date}</td>
                <td>
                  {r.employee
                    ? `${r.employee.first_name} ${r.employee.last_name}`
                    : '—'}
                </td>
                <td>{fmt(r.check_in_at)}</td>
                <td>{fmt(r.check_out_at)}</td>
                <td>{r.worked_minutes}</td>
                <td>{r.overtime_minutes}</td>
                <td>
                  <span className={`badge status-${r.status}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
