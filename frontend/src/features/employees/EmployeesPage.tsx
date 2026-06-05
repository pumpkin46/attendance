import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Input } from '@/shared/ui/Input'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import type { Employee, Paginated } from '@/shared/types'

export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  // Drive the query off the debounced term so typing doesn't fire a request per
  // keystroke; keep prior rows visible while the new page loads.
  const debouncedSearch = useDebouncedValue(search)
  const { data, isPending: loading } = useApiQuery<Paginated<Employee>>(
    ['employees', 'list', debouncedSearch],
    '/employees',
    { search: debouncedSearch, per_page: 50 },
    { keepPreviousData: true }
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
