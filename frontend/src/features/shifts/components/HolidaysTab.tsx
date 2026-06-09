import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { DataTable } from '@/shared/ui/DataTable'
import { useCreateHoliday, useHolidays } from '@/features/shifts/api/queries'

export function HolidaysTab() {
  const { data: holidays = [], isPending } = useHolidays()
  const createHoliday = useCreateHoliday()
  const [form, setForm] = useState({ name: '', date: '', is_recurring: false })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    createHoliday.mutate(
      { name: form.name.trim(), date: form.date, is_recurring: form.is_recurring },
      { onSuccess: () => setForm({ name: '', date: '', is_recurring: false }) }
    )
  }

  return (
    <div>
      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-medium">Add holiday</h2>
        <form className="grid items-end gap-4 sm:grid-cols-4" onSubmit={submit}>
          <Label className="sm:col-span-2">
            Name *
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            Date *
            <DatePicker value={form.date} onChange={(value) => setForm({ ...form, date: value })} required />
          </Label>
          <Label className="flex-row items-center gap-2">
            <Checkbox
              checked={form.is_recurring}
              onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
              label="Recurring"
            />
          </Label>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={createHoliday.isPending}>
              Add holiday
            </Button>
          </div>
        </form>
      </Card>

      <DataTable
        data={holidays}
        rowKey={(h) => h.id}
        pageSize={10}
        loading={isPending}
        empty="No holidays configured"
        columns={[
          { key: 'date', header: 'Date', cell: (h) => h.date },
          { key: 'name', header: 'Name', cell: (h) => h.name },
          { key: 'recurring', header: 'Recurring', cell: (h) => h.is_recurring && <Badge tone="neutral">Yearly</Badge> },
        ]}
      />
    </div>
  )
}
