import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { usePolicies, useSavePolicy } from '@/features/shifts/api/queries'
import type { AttendancePolicy } from '@/features/shifts/types'

const emptyForm = {
  name: '',
  grace_minutes: '15',
  min_work_minutes: '240',
  max_work_minutes: '600',
  break_minutes: '60',
  overtime_after_minutes: '480',
  half_day_minutes: '240',
  is_default: false,
}
type PolicyForm = typeof emptyForm

const NUM_FIELDS: (keyof PolicyForm)[] = [
  'grace_minutes',
  'min_work_minutes',
  'max_work_minutes',
  'break_minutes',
  'overtime_after_minutes',
  'half_day_minutes',
]

export function PoliciesTab() {
  const { data: policies = [], isPending } = usePolicies()
  const savePolicy = useSavePolicy()
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<PolicyForm>(emptyForm)

  const close = () => {
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm)
  }

  const openEdit = (p: AttendancePolicy) => {
    setEditingId(p.id)
    setForm({
      name: p.name,
      grace_minutes: String(p.grace_minutes),
      min_work_minutes: String(p.min_work_minutes),
      max_work_minutes: String(p.max_work_minutes),
      break_minutes: String(p.break_minutes),
      overtime_after_minutes: String(p.overtime_after_minutes),
      half_day_minutes: String(p.half_day_minutes),
      is_default: p.is_default,
    })
    setFormOpen(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: Record<string, unknown> = { name: form.name.trim(), is_default: form.is_default }
    for (const f of NUM_FIELDS) payload[f] = Number(form[f]) || 0
    savePolicy.mutate({ id: editingId ?? undefined, payload }, { onSuccess: close })
  }

  const numField = (key: keyof PolicyForm, label: string) => (
    <Label>
      {label}
      <Input
        type="number"
        min={0}
        value={String(form[key])}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </Label>
  )

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={formOpen ? close : () => setFormOpen(true)}>
          {formOpen ? 'Cancel' : 'New policy'}
        </Button>
      </div>

      {formOpen && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">{editingId ? 'Edit policy' : 'New policy'}</h2>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit}>
            <Label>
              Name *
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Label>
            {numField('grace_minutes', 'Grace (min)')}
            {numField('break_minutes', 'Break (min)')}
            {numField('min_work_minutes', 'Min work (min)')}
            {numField('max_work_minutes', 'Max work (min)')}
            {numField('overtime_after_minutes', 'Overtime after (min)')}
            {numField('half_day_minutes', 'Half-day (min)')}
            <Label className="flex-row items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              />
              Default policy
            </Label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={savePolicy.isPending}>
                {editingId ? 'Save changes' : 'Create policy'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Grace</Th>
          <Th>Work min/max</Th>
          <Th>Break</Th>
          <Th>Overtime after</Th>
          <Th>Default</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {isPending ? (
            <tr>
              <Td colSpan={7} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : policies.length === 0 ? (
            <tr>
              <Td colSpan={7} className="text-slate-400">
                No policies yet
              </Td>
            </tr>
          ) : (
            policies.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}</Td>
                <Td>{p.grace_minutes}m</Td>
                <Td>
                  {p.min_work_minutes}–{p.max_work_minutes}m
                </Td>
                <Td>{p.break_minutes}m</Td>
                <Td>{p.overtime_after_minutes}m</Td>
                <Td>{p.is_default && <Badge tone="ok">Default</Badge>}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => openEdit(p)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
