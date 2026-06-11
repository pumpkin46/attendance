import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { SidePanel } from '@/shared/ui/SidePanel'
import { DataTable } from '@/shared/ui/DataTable'
import type { Shift } from '@/shared/types'
import { useActiveEmployees } from '@/features/employees/api/queries'
import {
  useAssignShift,
  useAttendanceConfig,
  useDeleteShift,
  usePolicies,
  useSaveShift,
  useShifts,
} from '@/features/shifts/api/queries'
import { SHIFT_TYPE_FALLBACK } from '@/features/shifts/types'

const emptyForm = {
  name: '',
  type: 'fixed',
  rotation_slot: '',
  start_time: '09:00',
  end_time: '18:00',
  grace_minutes: '15',
  break_minutes: '0',
  attendance_policy_id: '',
}
type ShiftForm = typeof emptyForm

export function ShiftsTab() {
  const { data: shifts = [], isPending } = useShifts()
  const { data: config } = useAttendanceConfig()
  const { data: policies = [] } = usePolicies()
  const { data: employeesResp } = useActiveEmployees()
  const employees = employeesResp?.data ?? []

  const saveShift = useSaveShift()
  const deleteShift = useDeleteShift()
  const assignShift = useAssignShift()

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ShiftForm>(emptyForm)
  const [assignFor, setAssignFor] = useState<Shift | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assign, setAssign] = useState({ employee_id: '', effective_from: '', effective_to: '' })

  const shiftTypes = config?.shift_types ?? SHIFT_TYPE_FALLBACK

  // State resets happen in openCreate/openEdit so the exit animation doesn't flash.
  const close = () => setFormOpen(false)

  const openCreate = () => {
    setAssignOpen(false)
    setEditingId(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (s: Shift) => {
    setAssignOpen(false)
    setEditingId(s.id)
    setForm({
      name: s.name,
      type: s.type,
      rotation_slot: s.rotation_slot ?? '',
      start_time: s.start_time ?? '09:00',
      end_time: s.end_time ?? '18:00',
      grace_minutes: String(s.grace_minutes ?? 15),
      break_minutes: '0',
      attendance_policy_id: '',
    })
    setFormOpen(true)
  }

  const openAssign = (s: Shift) => {
    setFormOpen(false)
    setAssignFor(s)
    setAssign({ employee_id: '', effective_from: '', effective_to: '' })
    setAssignOpen(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      name: form.name.trim(),
      type: form.type,
      rotation_slot: form.type === 'rotational' ? form.rotation_slot || null : null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      grace_minutes: Number(form.grace_minutes) || 0,
      break_minutes: Number(form.break_minutes) || 0,
      attendance_policy_id: form.attendance_policy_id ? Number(form.attendance_policy_id) : null,
    }
    saveShift.mutate({ id: editingId ?? undefined, payload }, { onSuccess: close })
  }

  const submitAssign = (e: React.FormEvent) => {
    e.preventDefault()
    if (!assignFor || !assign.employee_id || !assign.effective_from) return
    assignShift.mutate(
      {
        shiftId: assignFor.id,
        payload: {
          employee_id: Number(assign.employee_id),
          effective_from: assign.effective_from,
          effective_to: assign.effective_to || null,
        },
      },
      {
        onSuccess: () => setAssignOpen(false),
      }
    )
  }

  const schedule = (s: Shift) =>
    s.type === 'split' && s.segments?.length
      ? s.segments.map((seg) => `${seg.start}–${seg.end}`).join(', ')
      : `${s.start_time ?? '—'}–${s.end_time ?? '—'}`

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Shift schedules</h2>
          <p className="text-xs text-slate-400">Define working hours and assign them to employees.</p>
        </div>
        <Button onClick={openCreate}>+ New shift</Button>
      </div>

      <SidePanel
        open={formOpen}
        title={editingId ? 'Edit shift' : 'New shift'}
        description="Working hours, grace, and policy"
        onClose={close}
        footer={
          <>
            <Button type="submit" form="shift-form" isLoading={saveShift.isPending}>
              {editingId ? 'Save changes' : 'Create shift'}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </>
        }
      >
        <form id="shift-form" className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Label className="sm:col-span-2">
            Name *
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            Type
            <Combobox value={form.type} onChange={(value) => setForm({ ...form, type: value })}>
              {Object.entries(shiftTypes).map(([k, meta]) => (
                <option key={k} value={k}>
                  {meta.label}
                </option>
              ))}
            </Combobox>
          </Label>
          {form.type === 'rotational' && (
            <Label>
              Rotation slot
              <Combobox
                value={form.rotation_slot}
                onChange={(value) => setForm({ ...form, rotation_slot: value })}
              >
                <option value="">—</option>
                <option value="morning">Morning</option>
                <option value="evening">Evening</option>
                <option value="night">Night</option>
              </Combobox>
            </Label>
          )}
          <Label>
            Start time
            <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </Label>
          <Label>
            End time
            <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
          </Label>
          <Label>
            Grace (min)
            <Input type="number" min={0} value={form.grace_minutes} onChange={(e) => setForm({ ...form, grace_minutes: e.target.value })} />
          </Label>
          <Label>
            Break (min)
            <Input type="number" min={0} value={form.break_minutes} onChange={(e) => setForm({ ...form, break_minutes: e.target.value })} />
          </Label>
          <Label className="sm:col-span-2">
            Attendance policy
            <Combobox
              value={form.attendance_policy_id}
              onChange={(value) => setForm({ ...form, attendance_policy_id: value })}
            >
              <option value="">Default</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Combobox>
          </Label>
        </form>
      </SidePanel>

      <SidePanel
        open={assignOpen}
        title="Assign shift"
        description={assignFor ? `Assign “${assignFor.name}” to an employee` : undefined}
        onClose={() => setAssignOpen(false)}
        footer={
          <>
            <Button type="submit" form="assign-form" isLoading={assignShift.isPending}>
              Assign
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <form id="assign-form" className="grid gap-4" onSubmit={submitAssign}>
          <Label>
            Employee
            <Combobox value={assign.employee_id} onChange={(value) => setAssign({ ...assign, employee_id: value })} required>
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.first_name} {e.last_name}
                </option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Effective from
            <DatePicker value={assign.effective_from} onChange={(value) => setAssign({ ...assign, effective_from: value })} required />
          </Label>
          <Label>
            Effective to
            <DatePicker value={assign.effective_to} onChange={(value) => setAssign({ ...assign, effective_to: value })} />
          </Label>
        </form>
      </SidePanel>

      <DataTable
        data={shifts}
        rowKey={(s) => s.id}
        loading={isPending}
        empty="No shifts yet"
        columns={[
          { key: 'name', header: 'Name', cell: (s) => <span className="font-medium text-slate-100">{s.name}</span> },
          {
            key: 'type',
            header: 'Type',
            cell: (s) => (
              <Badge tone="neutral">
                <span className="capitalize">{s.type}</span>
                {s.rotation_slot ? ` · ${s.rotation_slot}` : ''}
              </Badge>
            ),
          },
          { key: 'schedule', header: 'Schedule', className: 'font-mono text-xs text-slate-300', cell: (s) => schedule(s) },
          { key: 'grace', header: 'Grace', cell: (s) => `${s.grace_minutes}m` },
          {
            key: 'status',
            header: 'Status',
            cell: (s) => <Badge tone={s.is_active ? 'ok' : 'neutral'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>,
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (s) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openAssign(s)}>
                  Assign
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deleteShift.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove shift "${s.name}"?`)) deleteShift.mutate(s.id)
                  }}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />
    </Card>
  )
}
