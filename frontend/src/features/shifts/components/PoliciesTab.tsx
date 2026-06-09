import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { DataTable } from '@/shared/ui/DataTable'
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
              <Checkbox
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                label="Default policy"
              />
            </Label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={savePolicy.isPending}>
                {editingId ? 'Save changes' : 'Create policy'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable
        data={policies}
        rowKey={(p) => p.id}
        loading={isPending}
        empty="No policies yet"
        columns={[
          { key: 'name', header: 'Name', cell: (p) => p.name },
          { key: 'grace', header: 'Grace', cell: (p) => `${p.grace_minutes}m` },
          {
            key: 'work',
            header: 'Work min/max',
            cell: (p) => (
              <>
                {p.min_work_minutes}–{p.max_work_minutes}m
              </>
            ),
          },
          { key: 'break', header: 'Break', cell: (p) => `${p.break_minutes}m` },
          { key: 'overtime', header: 'Overtime after', cell: (p) => `${p.overtime_after_minutes}m` },
          { key: 'default', header: 'Default', cell: (p) => p.is_default && <Badge tone="ok">Default</Badge> },
          {
            key: 'actions',
            header: 'Actions',
            cell: (p) => (
              <Button variant="ghost" onClick={() => openEdit(p)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
    </div>
  )
}
