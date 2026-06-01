import { useEffect, useState } from 'react'
import { api } from '../api/client'

interface Shift {
  id: number
  name: string
  start_time: string
  end_time: string
  grace_minutes: number
  is_active: boolean
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([])

  useEffect(() => {
    api.get<Shift[]>('/shifts').then((r) => setShifts(r.data))
  }, [])

  return (
    <div>
      <h1>Shift Management</h1>
      <p className="muted">Define work schedules and grace periods</p>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Start</th>
              <th>End</th>
              <th>Grace (min)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.start_time}</td>
                <td>{s.end_time}</td>
                <td>{s.grace_minutes}</td>
                <td>{s.is_active ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
