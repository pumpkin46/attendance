import { useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import { useApiQuery } from '../hooks/useApiQuery'
import type { Employee, Paginated } from '../types'

export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  const { data, isPending: loading } = useApiQuery<Paginated<Employee>>(
    ['employees', 'list', search],
    '/employees',
    { search, per_page: 50 }
  )
  const employees = data?.data ?? []

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Workforce registry, face enrollment, and RFID card status"
        actions={
          <Input
            className="min-w-56"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />

      <TableShell>
        <TableHead>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Department</Th>
          <Th>Location</Th>
          <Th>Face enrolled</Th>
          <Th>RFID card</Th>
          <Th>Status</Th>
        </TableHead>
        {loading ? (
          <TableBody>
            <tr>
              <Td colSpan={7} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          </TableBody>
        ) : (
          <TableBody>
            {employees.map((e) => (
              <tr key={e.id}>
                <Td>{e.employee_code}</Td>
                <Td>
                  {e.first_name} {e.last_name}
                </Td>
                <Td>{e.department ?? '—'}</Td>
                <Td>{e.location?.name ?? '—'}</Td>
                <Td>
                  <Badge tone={e.face_enrolled ? 'ok' : 'warn'}>
                    {e.face_enrolled ? 'Yes' : 'No'}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={(e.active_rfid_cards_count ?? 0) > 0 ? 'ok' : 'neutral'}>
                    {(e.active_rfid_cards_count ?? 0) > 0 ? 'Assigned' : 'None'}
                  </Badge>
                </Td>
                <Td>{e.is_active ? 'Active' : 'Inactive'}</Td>
              </tr>
            ))}
          </TableBody>
        )}
      </TableShell>
    </div>
  )
}
