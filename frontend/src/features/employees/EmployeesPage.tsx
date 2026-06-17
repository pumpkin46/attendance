import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SidePanel } from '@/shared/ui/SidePanel'
import { SearchBox } from '@/shared/ui/SearchBox'
import { DataTable } from '@/shared/ui/DataTable'
import { confirmDialog } from '@/shared/ui/dialogs'
import { cn } from '@/shared/lib/cn'
import { initialsOf } from '@/shared/lib/format'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import type { Employee } from '@/shared/types'
import {
  useDeleteEmployee,
  useEmployeeLocations,
  useEmployees,
  useSaveEmployee,
} from '@/features/employees/api/queries'
import { emptyEmployeeForm, type EmployeeForm } from '@/features/employees/types'

/** Deterministic accent colour for an employee avatar, derived from their id. */
const AVATAR_TONES = [
  'bg-blue-500/15 text-blue-300',
  'bg-emerald-500/15 text-emerald-300',
  'bg-violet-500/15 text-violet-300',
  'bg-amber-500/15 text-amber-300',
  'bg-rose-500/15 text-rose-300',
  'bg-cyan-500/15 text-cyan-300',
]

function Avatar({ employee }: { employee: Employee }) {
  const tone = AVATAR_TONES[employee.id % AVATAR_TONES.length]
  return (
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold', tone)}>
      {initialsOf(employee.first_name, employee.last_name)}
    </span>
  )
}

function MiniStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'ok' | 'warn' | 'accent'
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={cn(
          'text-2xl font-semibold',
          tone === 'ok' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'accent' && 'text-blue-400',
          !tone && 'text-slate-100'
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </Card>
  )
}

export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<EmployeeForm>(emptyEmployeeForm)

  const { data, isPending: loading } = useEmployees(debouncedSearch)
  const employees = data?.data ?? []
  const { data: locations = [] } = useEmployeeLocations()
  // The employee list returns location_id only; resolve names from the
  // locations the form picker already loads.
  const locationName = (id: number | null | undefined) =>
    id == null ? undefined : locations.find((l) => l.id === id)?.name

  const saveEmployee = useSaveEmployee()
  const deleteMutation = useDeleteEmployee()

  const total = data?.total ?? employees.length
  const enrolledCount = employees.filter((e) => e.face_enrolled).length
  const rfidCount = employees.filter((e) => (e.active_rfid_cards_count ?? 0) > 0).length
  const inactiveCount = employees.filter((e) => !e.is_active).length
  const pct = (n: number) => (employees.length ? Math.round((n / employees.length) * 100) : 0)

  // State resets happen in openCreate/openEdit so the exit animation doesn't flash.
  const closeForm = () => setFormOpen(false)

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
      job_title: e.job_title ?? '',
      hire_date: e.hire_date ?? '',
      location_id: e.location_id ? String(e.location_id) : '',
      is_active: String(e.is_active),
    })
    setFormOpen(true)
  }

  const remove = async (e: Employee) => {
    const ok = await confirmDialog({
      title: 'Delete employee',
      message: `Delete ${e.first_name} ${e.last_name} (${e.employee_code})? This cannot be undone.`,
      confirmLabel: 'Delete',
    })
    if (ok) deleteMutation.mutate(e.id)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    saveEmployee.mutate({ id: editingId, form }, { onSuccess: closeForm })
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Employee directory with face enrollment and RFID card status."
        actions={
          <div className="flex flex-wrap gap-2">
            <SearchBox
              className="min-w-56"
              placeholder="Search employees…"
              value={search}
              onChange={setSearch}
            />
            <Button onClick={formOpen ? closeForm : openCreate} variant={formOpen ? 'ghost' : 'primary'}>
              {formOpen ? 'Cancel' : '+ New employee'}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat label="Total employees" value={total} hint={`${inactiveCount} inactive`} />
        <MiniStat
          label="Face enrolled"
          value={enrolledCount}
          hint={`${pct(enrolledCount)}% of loaded`}
          tone="ok"
        />
        <MiniStat
          label="RFID assigned"
          value={rfidCount}
          hint={`${pct(rfidCount)}% of loaded`}
          tone="accent"
        />
        <MiniStat
          label="Inactive"
          value={inactiveCount}
          hint={inactiveCount ? 'Needs review' : 'All active'}
          tone={inactiveCount ? 'warn' : undefined}
        />
      </div>

      <SidePanel
        open={formOpen}
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

      <DataTable
        data={employees}
        rowKey={(e) => e.id}
        pageSize={10}
        loading={loading}
        empty={search ? `No employees match “${search}”` : 'No employees found'}
        columns={[
          {
            key: 'code',
            header: 'Code',
            sortable: true,
            width: '8rem',
            cell: (e) => <span className="font-mono text-xs text-slate-400">{e.employee_code}</span>,
          },
          {
            key: 'name',
            header: 'Employee',
            sortable: true,
            sortValue: (e) => `${e.first_name} ${e.last_name}`,
            cell: (e) => (
              <div className="flex items-center gap-3">
                <Avatar employee={e} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-100">
                    {e.first_name} {e.last_name}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {e.job_title || e.email || '—'}
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: 'location',
            header: 'Location',
            sortable: true,
            sortValue: (e) => locationName(e.location_id) ?? '',
            cell: (e) => locationName(e.location_id) ?? <span className="text-slate-600">—</span>,
          },
          {
            key: 'face_enrolled',
            header: 'Face',
            align: 'center',
            sortable: true,
            sortValue: (e) => (e.face_enrolled ? 1 : 0),
            cell: (e) => (
              <Badge tone={e.face_enrolled ? 'ok' : 'warn'}>
                {e.face_enrolled ? 'Enrolled' : 'Missing'}
              </Badge>
            ),
          },
          {
            key: 'rfid',
            header: 'RFID',
            align: 'center',
            sortable: true,
            sortValue: (e) => e.active_rfid_cards_count ?? 0,
            cell: (e) => (
              <Badge tone={(e.active_rfid_cards_count ?? 0) > 0 ? 'ok' : 'neutral'}>
                {(e.active_rfid_cards_count ?? 0) > 0 ? 'Assigned' : 'None'}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'center',
            sortable: true,
            sortValue: (e) => (e.is_active ? 1 : 0),
            cell: (e) => (
              <Badge tone={e.is_active ? 'ok' : 'danger'}>
                {e.is_active ? 'Active' : 'Inactive'}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: '7rem',
            cell: (e) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
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
