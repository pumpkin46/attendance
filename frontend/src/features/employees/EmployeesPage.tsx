import { useMemo, useState } from 'react'
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
import { useAuth } from '@/features/auth/AuthProvider'
import type { Employee } from '@/shared/types'
import {
  useDeleteEmployee,
  useEmployeeLocations,
  useEmployeeOrgNodeCounts,
  useEmployees,
  useSaveEmployee,
} from '@/features/employees/api/queries'
import { emptyEmployeeForm, type EmployeeForm } from '@/features/employees/types'
import { OrgFilterSidebar } from '@/features/employees/components/OrgFilterSidebar'
import { useOrgTree } from '@/features/security/api/queries'
import { flattenTree } from '@/features/security/lib/tree'

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
  const { isSuperAdmin, hasPermission } = useAuth()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<EmployeeForm>(emptyEmployeeForm)
  // null = "All employees"; a node id filters to that unit + its sub-tree.
  const [orgNodeId, setOrgNodeId] = useState<number | null>(null)

  // The org tree drives the directory sidebar + the form's unit picker. Gate the
  // fetch on org-node access so viewers without it just see the flat list.
  const canViewOrg = isSuperAdmin() || hasPermission('org_nodes.view') || hasPermission('org_nodes.manage')
  const { data: orgTree = [], isPending: orgTreeLoading } = useOrgTree(canViewOrg)
  const { data: orgNodeCounts = {} } = useEmployeeOrgNodeCounts(canViewOrg)
  const showOrgSidebar = canViewOrg && orgTree.length > 0

  const { data, isPending: loading } = useEmployees(debouncedSearch, orgNodeId)
  const employees = data?.data ?? []
  const { data: locations = [] } = useEmployeeLocations()
  // The employee list returns location_id only; resolve names from the
  // locations the form picker already loads.
  const locationName = (id: number | null | undefined) =>
    id == null ? undefined : locations.find((l) => l.id === id)?.name

  // Flat view of the org tree for name lookups (table column) and the picker.
  const orgNodesFlat = useMemo(() => flattenTree(orgTree), [orgTree])
  const orgNameById = useMemo(
    () => new Map(orgNodesFlat.map((n) => [n.id, n.name] as const)),
    [orgNodesFlat]
  )
  const rootIds = useMemo(() => new Set(orgTree.map((r) => r.id)), [orgTree])
  // Picker options: '' = company root, then each sub-unit indented by depth.
  const orgOptions = useMemo(
    () => [
      { value: '', label: 'Company root (default)' },
      ...orgNodesFlat
        .filter((n) => n.parent_id !== null)
        .map((n) => ({
          value: String(n.id),
          label: `${'   '.repeat(Math.max(0, n.depth - 1))}${n.name}`,
        })),
    ],
    [orgNodesFlat]
  )
  const selectedNodeName = orgNodeId != null ? orgNameById.get(orgNodeId) : undefined

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
    setForm({
      ...emptyEmployeeForm,
      // Pre-select the unit being filtered so "+ New employee" lands there.
      organization_id: orgNodeId != null && !rootIds.has(orgNodeId) ? String(orgNodeId) : '',
    })
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
      // A root assignment is the implicit default → show as "Company root".
      organization_id:
        e.organization_id && !rootIds.has(e.organization_id) ? String(e.organization_id) : '',
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

  const columns = [
    {
      key: 'code',
      header: 'Code',
      sortable: true,
      width: '8rem',
      cell: (e: Employee) => <span className="font-mono text-xs text-slate-400">{e.employee_code}</span>,
    },
    {
      key: 'name',
      header: 'Employee',
      sortable: true,
      sortValue: (e: Employee) => `${e.first_name} ${e.last_name}`,
      cell: (e: Employee) => (
        <div className="flex items-center gap-3">
          <Avatar employee={e} />
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-100">
              {e.first_name} {e.last_name}
            </div>
            <div className="truncate text-xs text-slate-500">{e.job_title || e.email || '—'}</div>
          </div>
        </div>
      ),
    },
    ...(showOrgSidebar
      ? [
          {
            key: 'org_unit',
            header: 'Org unit',
            sortable: true,
            sortValue: (e: Employee) => (e.organization_id ? orgNameById.get(e.organization_id) ?? '' : ''),
            cell: (e: Employee) =>
              e.organization_id && orgNameById.has(e.organization_id) ? (
                orgNameById.get(e.organization_id)
              ) : (
                <span className="text-slate-600">—</span>
              ),
          },
        ]
      : []),
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      sortValue: (e: Employee) => locationName(e.location_id) ?? '',
      cell: (e: Employee) => locationName(e.location_id) ?? <span className="text-slate-600">—</span>,
    },
    {
      key: 'face_enrolled',
      header: 'Face',
      align: 'center' as const,
      sortable: true,
      sortValue: (e: Employee) => (e.face_enrolled ? 1 : 0),
      cell: (e: Employee) => (
        <Badge tone={e.face_enrolled ? 'ok' : 'warn'}>{e.face_enrolled ? 'Enrolled' : 'Missing'}</Badge>
      ),
    },
    {
      key: 'rfid',
      header: 'RFID',
      align: 'center' as const,
      sortable: true,
      sortValue: (e: Employee) => e.active_rfid_cards_count ?? 0,
      cell: (e: Employee) => (
        <Badge tone={(e.active_rfid_cards_count ?? 0) > 0 ? 'ok' : 'neutral'}>
          {(e.active_rfid_cards_count ?? 0) > 0 ? 'Assigned' : 'None'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center' as const,
      sortable: true,
      sortValue: (e: Employee) => (e.is_active ? 1 : 0),
      cell: (e: Employee) => (
        <Badge tone={e.is_active ? 'ok' : 'danger'}>{e.is_active ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      width: '7rem',
      cell: (e: Employee) => (
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
  ]

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

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {showOrgSidebar && (
          <aside className="lg:sticky lg:top-6 lg:w-72 lg:shrink-0">
            <OrgFilterSidebar
              tree={orgTree}
              counts={orgNodeCounts}
              selectedId={orgNodeId}
              onSelect={setOrgNodeId}
              loading={orgTreeLoading}
            />
          </aside>
        )}

        <div className="min-w-0 flex-1">
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

          {selectedNodeName && (
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
              <span>
                Filtered to <span className="font-medium text-slate-200">{selectedNodeName}</span>{' '}
                and its sub-units
              </span>
              <button
                type="button"
                onClick={() => setOrgNodeId(null)}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/10"
              >
                Clear
              </button>
            </div>
          )}

          <DataTable
            data={employees}
            rowKey={(e) => e.id}
            pageSize={10}
            loading={loading}
            empty={
              search
                ? `No employees match “${search}”`
                : selectedNodeName
                  ? `No employees in ${selectedNodeName}`
                  : 'No employees found'
            }
            columns={columns}
          />
        </div>
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
          {showOrgSidebar && (
            <Label>
              Organization unit
              <Combobox
                value={form.organization_id}
                onChange={(value) => setForm({ ...form, organization_id: value })}
                options={orgOptions}
              />
            </Label>
          )}
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
    </div>
  )
}
