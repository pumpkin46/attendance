import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { SidePanel } from '@/shared/ui/SidePanel'
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

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setFormOpen(true)
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
    <Card padding={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Attendance policies</h2>
          <p className="text-xs text-slate-400">Grace, work limits, breaks, and overtime rules.</p>
        </div>
        <Button onClick={openCreate}>+ New policy</Button>
      </div>

      {formOpen && (
        <SidePanel
          title={editingId ? 'Edit policy' : 'New policy'}
          description="All thresholds are in minutes"
          onClose={close}
          footer={
            <>
              <Button type="submit" form="policy-form" isLoading={savePolicy.isPending}>
                {editingId ? 'Save changes' : 'Create policy'}
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </>
          }
        >
          <form id="policy-form" className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <Label className="sm:col-span-2">
              Name *
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Label>
            {numField('grace_minutes', 'Grace (min)')}
            {numField('break_minutes', 'Break (min)')}
            {numField('min_work_minutes', 'Min work (min)')}
            {numField('max_work_minutes', 'Max work (min)')}
            {numField('overtime_after_minutes', 'Overtime after (min)')}
            {numField('half_day_minutes', 'Half-day (min)')}
            <div className="sm:col-span-2">
              <Checkbox
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                label="Set as default policy"
              />
            </div>
          </form>
        </SidePanel>
      )}

      <DataTable
        data={policies}
        rowKey={(p) => p.id}
        loading={isPending}
        empty="No policies yet"
        columns={[
          {
            key: 'name',
            header: 'Name',
            cell: (p) => (
              <span className="flex items-center gap-2">
                <span className="font-medium text-slate-100">{p.name}</span>
                {p.is_default && <Badge tone="ok">Default</Badge>}
              </span>
            ),
          },
          { key: 'grace', header: 'Grace', cell: (p) => `${p.grace_minutes}m` },
          {
            key: 'work',
            header: 'Work min/max',
            className: 'font-mono text-xs text-slate-300',
            cell: (p) => `${p.min_work_minutes}–${p.max_work_minutes}m`,
          },
          { key: 'break', header: 'Break', cell: (p) => `${p.break_minutes}m` },
          { key: 'overtime', header: 'Overtime after', cell: (p) => `${p.overtime_after_minutes}m` },
          {
            key: 'actions',
            header: 'Actions',
            cell: (p) => (
              <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
    </Card>
  )
}
