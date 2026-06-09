import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SidePanel } from '@/shared/ui/SidePanel'
import { DataTable } from '@/shared/ui/DataTable'
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
        <SidePanel
          title={editingId === null ? 'New employee' : 'Edit employee'}
          description={
            editingId === null
              ? 'Add a new employee to the workforce registry'
              : 'Update employee details'
          }
          onClose={closeForm}
          footer={
            <>
              <Button type="submit" form="employee-form" isLoading={saveEmployee.isPending}>
                {editingId === null ? 'Create employee' : 'Save changes'}
              </Button>
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
            </>
          }
        >
          <form id="employee-form" className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
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
              <Combobox
                value={form.location_id}
                onChange={(value) => setForm({ ...form, location_id: value })}
              >
                <option value="">—</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Combobox>
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
              <DatePicker
                value={form.hire_date}
                onChange={(value) => setForm({ ...form, hire_date: value })}
              />
            </Label>
            {editingId !== null && (
              <Label>
                Status
                <Combobox
                  value={form.is_active}
                  onChange={(value) => setForm({ ...form, is_active: value })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </Combobox>
              </Label>
            )}
          </form>
        </SidePanel>
      )}

      <DataTable
        data={employees}
        rowKey={(e) => e.id}
        pageSize={10}
        loading={loading}
        empty="No employees found"
        columns={[
          { key: 'code', header: 'Code', cell: (e) => e.employee_code },
          { key: 'name', header: 'Name', cell: (e) => `${e.first_name} ${e.last_name}` },
          { key: 'department', header: 'Department', cell: (e) => e.department ?? '—' },
          { key: 'location', header: 'Location', cell: (e) => e.location?.name ?? '—' },
          {
            key: 'face_enrolled',
            header: 'Face enrolled',
            cell: (e) => (
              <Badge tone={e.face_enrolled ? 'ok' : 'warn'}>
                {e.face_enrolled ? 'Yes' : 'No'}
              </Badge>
            ),
          },
          {
            key: 'rfid',
            header: 'RFID card',
            cell: (e) => (
              <Badge tone={(e.active_rfid_cards_count ?? 0) > 0 ? 'ok' : 'neutral'}>
                {(e.active_rfid_cards_count ?? 0) > 0 ? 'Assigned' : 'None'}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (e) => (
              <Badge tone={e.is_active ? 'ok' : 'warn'}>
                {e.is_active ? 'Active' : 'Inactive'}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (e) => (
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
            ),
          },
        ]}
      />
    </div>
  )
}
