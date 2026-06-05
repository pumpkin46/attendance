import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import type { Employee } from '@/shared/types'
import {
  useDeleteEmployee,
  useEmployeeLocations,
  useEmployees,
  useSaveEmployee,
} from '@/features/employees/api/queries'
import { emptyEmployeeForm, type EmployeeForm } from '@/features/employees/types'

export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<EmployeeForm>(emptyEmployeeForm)

  const { data, isPending: loading } = useEmployees(debouncedSearch)
  const employees = data?.data ?? []
  const { data: locations = [] } = useEmployeeLocations()

  const saveEmployee = useSaveEmployee()
  const deleteMutation = useDeleteEmployee()

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyEmployeeForm)
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyEmployeeForm)
    setFormOpen(true)
  }

  const openEdit = (e: Employee) => {
    setEditingId(e.id)
    setForm({
      employee_code: e.employee_code,
      first_name: e.first_name,
      last_name: e.last_name,
      email: e.email ?? '',
      department: e.department ?? '',
      job_title: e.job_title ?? '',
      hire_date: e.hire_date ?? '',
      location_id: e.location?.id ? String(e.location.id) : '',
      is_active: String(e.is_active),
    })
    setFormOpen(true)
  }

  const remove = (e: Employee) => {
    if (window.confirm(`Delete ${e.first_name} ${e.last_name} (${e.employee_code})? This cannot be undone.`)) {
      deleteMutation.mutate(e.id)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    saveEmployee.mutate({ id: editingId, form }, { onSuccess: closeForm })
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Workforce registry, face enrollment, and RFID card status"
        actions={
          <div className="flex gap-2">
            <Input
              className="min-w-56"
              placeholder="Search employees…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button onClick={formOpen ? closeForm : openCreate}>
              {formOpen ? 'Cancel' : 'New employee'}
            </Button>
          </div>
        }
      />

      {formOpen && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">
            {editingId === null ? 'New employee' : 'Edit employee'}
          </h2>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <Label>
              Employee code *
              <Input
                value={form.employee_code}
                onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
                required
              />
            </Label>
            <Label>
              Location
              <Select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              >
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              First name *
              <Input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
              />
            </Label>
            <Label>
              Last name *
              <Input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
              />
            </Label>
            <Label>
              Email
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Label>
            <Label>
              Department
              <Input
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </Label>
            <Label>
              Job title
              <Input
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
              />
            </Label>
            <Label>
              Hire date
              <Input
                type="date"
                value={form.hire_date}
                onChange={(e) => setForm({ ...form, hire_date: e.target.value })}
              />
            </Label>
            {editingId !== null && (
              <Label>
                Status
                <Select
                  value={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.value })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </Select>
              </Label>
            )}
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={saveEmployee.isPending}>
                {editingId === null ? 'Create employee' : 'Save changes'}
              </Button>
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <TableShell>
        <TableHead>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Department</Th>
          <Th>Location</Th>
          <Th>Face enrolled</Th>
          <Th>RFID card</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        {loading ? (
          <TableBody>
            <tr>
              <Td colSpan={8} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          </TableBody>
        ) : (
          <TableBody>
            {employees.length === 0 ? (
              <tr>
                <Td colSpan={8} className="text-slate-400">
                  No employees found
                </Td>
              </tr>
            ) : (
              employees.map((e) => (
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
                  <Td>
                    <Badge tone={e.is_active ? 'ok' : 'warn'}>
                      {e.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => openEdit(e)}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => remove(e)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </TableBody>
        )}
      </TableShell>
    </div>
  )
}
