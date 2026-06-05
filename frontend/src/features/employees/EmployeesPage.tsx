import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import type { Employee, Paginated } from '@/shared/types'

interface Location {
  id: number
  name: string
}

const emptyForm = {
  employee_code: '',
  first_name: '',
  last_name: '',
  email: '',
  department: '',
  job_title: '',
  hire_date: '',
  location_id: '',
  is_active: 'true',
}

type EmployeeForm = typeof emptyForm

/** Build an API payload, dropping empty optionals and coercing types. */
function toPayload(form: EmployeeForm, includeStatus: boolean) {
  return {
    employee_code: form.employee_code.trim(),
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim() || null,
    department: form.department.trim() || null,
    job_title: form.job_title.trim() || null,
    hire_date: form.hire_date || null,
    location_id: form.location_id ? Number(form.location_id) : null,
    ...(includeStatus ? { is_active: form.is_active === 'true' } : {}),
  }
}

export default function EmployeesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<EmployeeForm>(emptyForm)

  const { data, isPending: loading } = useApiQuery<Paginated<Employee>>(
    ['employees', 'list', debouncedSearch],
    '/employees',
    { search: debouncedSearch, per_page: 50 },
    { keepPreviousData: true }
  )
  const employees = data?.data ?? []
  const { data: locations = [] } = useApiQuery<Location[]>(['locations'], '/locations')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['employees'] })

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId === null
        ? api.post('/employees', toPayload(form, false))
        : api.put(`/employees/${editingId}`, toPayload(form, true)),
    onSuccess: () => {
      toast.success(editingId === null ? 'Employee created' : 'Employee updated')
      invalidate()
      closeForm()
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      toast.success('Employee deleted')
      invalidate()
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
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
    saveMutation.mutate()
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
              <Button type="submit" disabled={saveMutation.isPending}>
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
