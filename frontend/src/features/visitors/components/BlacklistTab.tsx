import { useState, type FormEvent } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { DataTable } from '@/shared/ui/DataTable'
import { useAddBlacklist, useBlacklist, useRemoveBlacklist } from '@/features/visitors/api/queries'

const emptyForm = { name: '', id_number: '', reason: 'blocked', notes: '' }

const REASON_TONE: Record<string, 'danger' | 'warn' | 'neutral'> = {
  blocked: 'danger',
  watchlist: 'warn',
  former_employee: 'neutral',
  restricted_contractor: 'warn',
}

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
      <Card padding={false} className="mb-6 overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">Add to blacklist / watchlist</h3>
          <p className="mt-0.5 text-xs text-slate-500">Blocked individuals are flagged on recognition and denied access.</p>
        </div>
        <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={submit}>
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
            <Combobox value={form.reason} onChange={(value) => setForm({ ...form, reason: value })}>
              <option value="blocked">Blocked</option>
              <option value="watchlist">Watchlist</option>
              <option value="former_employee">Former employee</option>
              <option value="restricted_contractor">Restricted contractor</option>
            </Combobox>
          </Label>
          <Label>
            Notes
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Label>
          <div className="sm:col-span-2">
            <Button type="submit" variant="danger" isLoading={add.isPending}>
              Add to blacklist
            </Button>
          </div>
        </form>
      </Card>
      <DataTable
        data={blacklist}
        rowKey={(b) => b.id}
        pageSize={10}
        empty="No blacklist entries."
        columns={[
          { key: 'name', header: 'Name', cell: (b) => <span className="font-medium text-slate-100">{b.name}</span> },
          { key: 'id_number', header: 'ID number', className: 'font-mono text-xs', cell: (b) => b.id_number ?? '—' },
          {
            key: 'reason',
            header: 'Reason',
            cell: (b) => (
              <Badge tone={REASON_TONE[b.reason] ?? 'neutral'} className="capitalize">
                {b.reason.replace(/_/g, ' ')}
              </Badge>
            ),
          },
          { key: 'notes', header: 'Notes', cell: (b) => b.notes ?? '—' },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (b) => (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={() => remove.mutate(b.id)}
              >
                Remove
              </Button>
            ),
          },
        ]}
      />
    </>
  )
}
