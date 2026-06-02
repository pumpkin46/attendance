import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { PageHeader } from '../components/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'

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
      <PageHeader title="Shift Management" description="Define work schedules and grace periods" />

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Start</Th>
          <Th>End</Th>
          <Th>Grace (min)</Th>
          <Th>Status</Th>
        </TableHead>
        <TableBody>
          {shifts.map((s) => (
            <tr key={s.id}>
              <Td>{s.name}</Td>
              <Td>{s.start_time}</Td>
              <Td>{s.end_time}</Td>
              <Td>{s.grace_minutes}</Td>
              <Td>{s.is_active ? 'Active' : 'Inactive'}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
