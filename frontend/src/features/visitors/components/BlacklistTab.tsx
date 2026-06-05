import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useAddBlacklist, useBlacklist, useRemoveBlacklist } from '@/features/visitors/api/queries'

const emptyForm = { name: '', id_number: '', reason: 'blocked', notes: '' }

export function BlacklistTab() {
  const [form, setForm] = useState(emptyForm)
  const { data: list } = useBlacklist()
  const blacklist = list?.data ?? []
  const add = useAddBlacklist()
  const remove = useRemoveBlacklist()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await add.mutateAsync(form)
    setForm(emptyForm)
  }

  return (
    <>
      <Card className="mb-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-300">Add to blacklist / watchlist</h3>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Label>
            Name *
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            ID number
            <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} />
          </Label>
          <Label>
            Reason
            <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              <option value="blocked">Blocked</option>
              <option value="watchlist">Watchlist</option>
              <option value="former_employee">Former employee</option>
              <option value="restricted_contractor">Restricted contractor</option>
            </Select>
          </Label>
          <Label>
            Notes
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={add.isPending}>Add to blacklist</Button>
          </div>
        </form>
      </Card>
      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>ID number</Th>
          <Th>Reason</Th>
          <Th>Notes</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {blacklist.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-center text-slate-500">No blacklist entries.</Td>
            </tr>
          ) : (
            blacklist.map((b) => (
              <tr key={b.id}>
                <Td>{b.name}</Td>
                <Td>{b.id_number ?? '—'}</Td>
                <Td className="capitalize">{b.reason.replace(/_/g, ' ')}</Td>
                <Td>{b.notes ?? '—'}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => remove.mutate(b.id)}>Remove</Button>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </>
  )
}
