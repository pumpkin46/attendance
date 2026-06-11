import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { SidePanel } from '@/shared/ui/SidePanel'
import { DataTable } from '@/shared/ui/DataTable'
import { useCreateHoliday, useHolidays } from '@/features/shifts/api/queries'

const emptyForm = { name: '', date: '', is_recurring: false }

export function HolidaysTab() {
  const { data: holidays = [], isPending } = useHolidays()
  const createHoliday = useCreateHoliday()
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)

  // Form resets on open so the exit animation doesn't flash cleared fields.
  const close = () => setFormOpen(false)

  const openCreate = () => {
    setForm(emptyForm)
    setFormOpen(true)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    createHoliday.mutate(
      { name: form.name.trim(), date: form.date, is_recurring: form.is_recurring },
      { onSuccess: close }
    )
  }

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Holiday calendar</h2>
          <p className="text-xs text-slate-400">Company holidays excluded from attendance rules.</p>
        </div>
        <Button onClick={openCreate}>+ Add holiday</Button>
      </div>

      <SidePanel
        open={formOpen}
        title="Add holiday"
        description="A non-working day for the organization"
        onClose={close}
        footer={
          <>
            <Button type="submit" form="holiday-form" isLoading={createHoliday.isPending}>
              Add holiday
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </>
        }
      >
        <form id="holiday-form" className="grid gap-4" onSubmit={submit}>
          <Label>
            Name *
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            Date *
            <DatePicker value={form.date} onChange={(value) => setForm({ ...form, date: value })} required />
          </Label>
          <Checkbox
            checked={form.is_recurring}
            onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
            label="Recurs every year"
          />
        </form>
      </SidePanel>

      <DataTable
        data={holidays}
        rowKey={(h) => h.id}
        pageSize={10}
        loading={isPending}
        empty="No holidays configured"
        columns={[
          { key: 'date', header: 'Date', className: 'font-mono text-xs text-slate-300', cell: (h) => h.date },
          { key: 'name', header: 'Name', cell: (h) => <span className="font-medium text-slate-100">{h.name}</span> },
          {
            key: 'recurring',
            header: 'Recurring',
            cell: (h) => (h.is_recurring ? <Badge tone="neutral">Yearly</Badge> : <span className="text-slate-600">—</span>),
          },
        ]}
      />
    </Card>
  )
}
