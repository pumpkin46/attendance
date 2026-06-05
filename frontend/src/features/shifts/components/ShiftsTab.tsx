import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Employee, Paginated, Shift } from '@/shared/types'
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
  const { data: employeesResp } = useApiQuery<Paginated<Employee>>(
    ['employees', 'active'],
    '/employees',
    { per_page: 100, is_active: true }
  )
  const employees = employeesResp?.data ?? []

  const saveShift = useSaveShift()
  const deleteShift = useDeleteShift()
  const assignShift = useAssignShift()

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ShiftForm>(emptyForm)
  const [assignFor, setAssignFor] = useState<Shift | null>(null)
  const [assign, setAssign] = useState({ employee_id: '', effective_from: '', effective_to: '' })

  const shiftTypes = config?.shift_types ?? SHIFT_TYPE_FALLBACK

  const close = () => {
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const openEdit = (s: Shift) => {
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
        onSuccess: () => {
          setAssignFor(null)
          setAssign({ employee_id: '', effective_from: '', effective_to: '' })
        },
      }
    )
  }

  const schedule = (s: Shift) =>
    s.type === 'split' && s.segments?.length
      ? s.segments.map((seg) => `${seg.start}–${seg.end}`).join(', ')
      : `${s.start_time ?? '—'}–${s.end_time ?? '—'}`

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={formOpen ? close : () => setFormOpen(true)}>
          {formOpen ? 'Cancel' : 'New shift'}
        </Button>
      </div>

      {formOpen && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">{editingId ? 'Edit shift' : 'New shift'}</h2>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
            <Label>
              Name *
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Label>
            <Label>
              Type
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(shiftTypes).map(([k, meta]) => (
                  <option key={k} value={k}>
                    {meta.label}
                  </option>
                ))}
              </Select>
            </Label>
            {form.type === 'rotational' && (
              <Label>
                Rotation slot
                <Select
                  value={form.rotation_slot}
                  onChange={(e) => setForm({ ...form, rotation_slot: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="morning">Morning</option>
                  <option value="evening">Evening</option>
                  <option value="night">Night</option>
                </Select>
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
            <Label>
              Attendance policy
              <Select
                value={form.attendance_policy_id}
                onChange={(e) => setForm({ ...form, attendance_policy_id: e.target.value })}
              >
                <option value="">Default</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={saveShift.isPending}>
                {editingId ? 'Save changes' : 'Create shift'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {assignFor && (
        <Card className="mb-6 border-indigo-700/40">
          <h2 className="mb-4 text-lg font-medium">Assign “{assignFor.name}” to employee</h2>
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={submitAssign}>
            <Label>
              Employee
              <Select value={assign.employee_id} onChange={(e) => setAssign({ ...assign, employee_id: e.target.value })} required>
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.first_name} {e.last_name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Effective from
              <Input type="date" value={assign.effective_from} onChange={(e) => setAssign({ ...assign, effective_from: e.target.value })} required />
            </Label>
            <Label>
              Effective to
              <Input type="date" value={assign.effective_to} onChange={(e) => setAssign({ ...assign, effective_to: e.target.value })} />
            </Label>
            <div className="flex items-end gap-2 sm:col-span-3">
              <Button type="submit" disabled={assignShift.isPending}>
                Assign
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAssignFor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Schedule</Th>
          <Th>Grace</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {isPending ? (
            <tr>
              <Td colSpan={6} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : shifts.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-slate-400">
                No shifts yet
              </Td>
            </tr>
          ) : (
            shifts.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}</Td>
                <Td className="capitalize">
                  {s.type}
                  {s.rotation_slot ? ` (${s.rotation_slot})` : ''}
                </Td>
                <Td>{schedule(s)}</Td>
                <Td>{s.grace_minutes}</Td>
                <Td>
                  <Badge tone={s.is_active ? 'ok' : 'neutral'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                </Td>
                <Td>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => openEdit(s)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => setAssignFor(s)}>
                      Assign
                    </Button>
                    <Button
                      variant="danger"
                      disabled={deleteShift.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove shift "${s.name}"?`)) deleteShift.mutate(s.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
