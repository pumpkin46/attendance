import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
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
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Label>
          <Label className="flex-row items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_recurring}
              onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
            />
            Recurring
          </Label>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={createHoliday.isPending}>
              Add holiday
            </Button>
          </div>
        </form>
      </Card>

      <TableShell>
        <TableHead>
          <Th>Date</Th>
          <Th>Name</Th>
          <Th>Recurring</Th>
        </TableHead>
        <TableBody>
          {isPending ? (
            <tr>
              <Td colSpan={3} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : holidays.length === 0 ? (
            <tr>
              <Td colSpan={3} className="text-slate-400">
                No holidays configured
              </Td>
            </tr>
          ) : (
            holidays.map((h) => (
              <tr key={h.id}>
                <Td>{h.date}</Td>
                <Td>{h.name}</Td>
                <Td>{h.is_recurring && <Badge tone="neutral">Yearly</Badge>}</Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
