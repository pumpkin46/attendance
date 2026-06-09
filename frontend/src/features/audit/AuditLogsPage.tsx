import { useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { Combobox } from '@/shared/ui/Combobox'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchBox } from '@/shared/ui/SearchBox'
import { StatCard } from '@/shared/ui/StatCard'
import { DataTable } from '@/shared/ui/DataTable'
import { useAuditLogs } from '@/features/audit/api/queries'
import type { AuditLog } from '@/features/audit/types'

/** Colour-code an action by its verb for quick scanning. */
function actionStyle(action: string): string {
  const a = action.toLowerCase()
  if (/(creat|add|register|enroll)/.test(a)) return 'bg-emerald-500/15 text-emerald-400'
  if (/(delet|remov|revoke|purge)/.test(a)) return 'bg-red-500/15 text-red-400'
  if (/(updat|edit|change|modif)/.test(a)) return 'bg-amber-500/15 text-amber-400'
  if (/(login|logout|auth|sign)/.test(a)) return 'bg-blue-500/15 text-blue-400'
  return 'bg-slate-500/15 text-slate-300'
}

const isToday = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export default function AuditLogsPage() {
  const { data, isPending, isError, error } = useAuditLogs()
  const logs = useMemo(() => data?.data ?? [], [data])

  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  const actionOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.action).filter(Boolean))
    return [
      { value: '', label: 'All actions' },
      ...Array.from(set)
        .sort()
        .map((a) => ({ value: a, label: a })),
    ]
  }, [logs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((l) => {
      if (actionFilter && l.action !== actionFilter) return false
      if (q) {
        const hay = [
          l.action,
          l.user?.name,
          l.user?.email,
          l.entity_type,
          l.entity_id != null ? String(l.entity_id) : '',
          l.ip_address,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [logs, search, actionFilter])

  const stats = useMemo(
    () => ({
      total: logs.length,
      actors: new Set(logs.map((l) => l.user?.email ?? 'system')).size,
      actions: new Set(logs.map((l) => l.action)).size,
      today: logs.filter((l) => isToday(l.created_at)).length,
    }),
    [logs]
  )

  const errorMsg = isError ? getApiErrorMessage(error, 'Failed to load audit logs') : undefined

  return (
    <div>
      <PageHeader title="Audit Logs" description="GDPR-ready activity trail for compliance." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total events" value={stats.total} />
        <StatCard label="Events today" value={stats.today} tone={stats.today ? 'warn' : undefined} />
        <StatCard label="Actors" value={stats.actors} />
        <StatCard label="Action types" value={stats.actions} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            className="w-72"
            placeholder="Search action, user, entity, IP…"
            value={search}
            onChange={setSearch}
          />
          <Combobox
            className="w-56"
            value={actionFilter}
            onChange={setActionFilter}
            options={actionOptions}
          />
        </div>
        <span className="text-xs text-slate-500">
          {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      <DataTable
        data={filtered}
        rowKey={(log) => log.id}
        pageSize={12}
        loading={isPending}
        error={errorMsg}
        empty="No audit events match these filters"
        columns={[
          {
            key: 'time',
            header: 'Time',
            cell: (log: AuditLog) => {
              const d = new Date(log.created_at)
              return (
                <div>
                  <div className="text-slate-200">{d.toLocaleDateString()}</div>
                  <div className="text-xs text-slate-500">
                    {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )
            },
          },
          {
            key: 'user',
            header: 'User',
            cell: (log) =>
              log.user ? (
                <div>
                  <div className="text-slate-200">{log.user.name}</div>
                  <div className="text-xs text-slate-500">{log.user.email}</div>
                </div>
              ) : (
                <span className="text-slate-500">System</span>
              ),
          },
          {
            key: 'action',
            header: 'Action',
            cell: (log) => (
              <span
                className={cn(
                  'inline-block rounded-md px-2 py-0.5 font-mono text-xs font-medium',
                  actionStyle(log.action)
                )}
              >
                {log.action}
              </span>
            ),
          },
          {
            key: 'entity',
            header: 'Entity',
            className: 'text-slate-400',
            cell: (log) =>
              log.entity_type ? (
                <span>
                  {log.entity_type}
                  <span className="text-slate-600">#{log.entity_id}</span>
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'ip',
            header: 'IP address',
            className: 'font-mono text-xs text-slate-400',
            cell: (log) => log.ip_address ?? '—',
          },
        ]}
      />
    </div>
  )
}
