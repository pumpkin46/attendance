import { useState } from 'react'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { downloadBlob } from '@/shared/lib/download'
import { initials, relativeTime } from '@/shared/lib/format'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { DataTable } from '@/shared/ui/DataTable'
import { DateRangePicker } from '@/shared/ui/DateRangePicker'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Pagination } from '@/shared/ui/Pagination'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
import { StatCard } from '@/shared/ui/StatCard'
import {
  fetchAuditExport,
  useAuditFacets,
  useAuditLogs,
  useAuditStats,
} from '@/features/audit/api/queries'
import type { AuditExportFormat, AuditLog } from '@/features/audit/types'

/* ------------------------------------------------------------------ *
 * Action categories — colour-code by verb for quick scanning.
 * ------------------------------------------------------------------ */

type ActionCategory = 'create' | 'delete' | 'update' | 'auth' | 'other'

const CATEGORY_STYLE: Record<ActionCategory, { dot: string; text: string; bg: string }> = {
  create: { dot: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  delete: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/15' },
  update: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/15' },
  auth: { dot: 'bg-blue-500', text: 'text-blue-400', bg: 'bg-blue-500/15' },
  other: { dot: 'bg-slate-500', text: 'text-slate-300', bg: 'bg-slate-500/15' },
}

function actionCategory(action: string): ActionCategory {
  const a = action.toLowerCase()
  if (/(login|logout|auth|sign|password|token)/.test(a)) return 'auth'
  if (/(delet|remov|revoke|purge|erase|blacklist)/.test(a)) return 'delete'
  if (/(creat|add|register|enroll|check)/.test(a)) return 'create'
  if (/(updat|edit|change|modif|set)/.test(a)) return 'update'
  return 'other'
}

function ActionBadge({ action }: { action: string }) {
  const s = CATEGORY_STYLE[actionCategory(action)]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs font-medium',
        s.bg,
        s.text
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', s.dot)} />
      {action}
    </span>
  )
}

function ActorIdentity({ log, large }: { log: AuditLog; large?: boolean }) {
  const system = !log.user
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full font-semibold',
          large ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs',
          system ? 'bg-slate-800 text-slate-500' : 'bg-slate-700 text-slate-200'
        )}
      >
        {system ? (
          <svg viewBox="0 0 24 24" className={large ? 'h-5 w-5' : 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9 9h6v6H9z" />
          </svg>
        ) : (
          initials(log.user!.name)
        )}
      </span>
      <div className="min-w-0">
        <div className={cn('truncate font-medium text-slate-100', large ? 'text-base' : 'text-sm')}>
          {log.user?.name ?? 'System'}
        </div>
        <div className="truncate text-xs text-slate-500">
          {log.user?.email ?? 'Automated process'}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Change payload rendering (old_values / new_values)
 * ------------------------------------------------------------------ */

const fmtValue = (v: unknown): string => {
  if (v == null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

interface FieldChange {
  key: string
  from?: unknown
  to?: unknown
}

/** Per-field diff between the stored before/after payloads. */
function fieldChanges(log: AuditLog): FieldChange[] {
  const oldV = log.old_values ?? null
  const newV = log.new_values ?? null
  if (!oldV && !newV) return []
  if (oldV && newV) {
    const keys = [...new Set([...Object.keys(oldV), ...Object.keys(newV)])]
    return keys
      .filter((k) => JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]))
      .map((k) => ({ key: k, from: oldV[k], to: newV[k] }))
  }
  const only = oldV ?? newV!
  return Object.keys(only).map((k) =>
    oldV ? { key: k, from: only[k] } : { key: k, to: only[k] }
  )
}

function ChangesSummaryCell({ log }: { log: AuditLog }) {
  const n = fieldChanges(log).length
  if (n === 0) return <span className="text-slate-600">—</span>
  return (
    <span className="text-xs text-slate-400">
      {n} {n === 1 ? 'field' : 'fields'}
    </span>
  )
}

function ChangeList({ changes }: { changes: FieldChange[] }) {
  return (
    <dl className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
      {changes.map((c) => (
        <div key={c.key} className="px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {c.key.replace(/_/g, ' ')}
          </dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-xs">
            {'from' in c && (
              <span className={cn('break-all', 'to' in c ? 'text-red-400/90 line-through decoration-red-500/50' : 'text-slate-300')}>
                {fmtValue(c.from)}
              </span>
            )}
            {'from' in c && 'to' in c && <span className="text-slate-600">&rarr;</span>}
            {'to' in c && <span className="break-all text-emerald-400">{fmtValue(c.to)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 py-0.5 pl-2.5 pr-1 text-xs text-blue-200">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="grid h-4 w-4 place-items-center rounded-full text-blue-300/70 transition-colors hover:bg-blue-500/20 hover:text-blue-100"
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-right text-slate-300">{children}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

const PER_PAGE = 15

const DownloadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export default function AuditLogsPage() {
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState<AuditExportFormat | null>(null)
  // `selected` keeps the last opened event mounted while the panel animates out.
  const [selected, setSelected] = useState<AuditLog | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const debouncedSearch = useDebouncedValue(search)

  const filters = {
    q: debouncedSearch.trim() || undefined,
    action: actionFilter || undefined,
    entity_type: entityFilter || undefined,
    user_id: actorFilter ? Number(actorFilter) : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }

  const { data: stats } = useAuditStats()
  const { data: facets } = useAuditFacets()
  const { data: list, isPending, isError, error } = useAuditLogs({
    ...filters,
    page,
    per_page: PER_PAGE,
  })
  const logs = list?.data ?? []

  // Follow the list as it shrinks (render-phase adjustment, re-renders before commit).
  if (list && page > list.last_page) setPage(list.last_page)

  const setFilter = (set: (value: string) => void, value: string) => {
    set(value)
    setPage(1)
  }
  const actorName = (id: string) =>
    facets?.actors.find((u) => String(u.id) === id)?.name ?? `#${id}`
  const chips: { key: string; label: string; remove: () => void }[] = [
    search.trim() && { key: 'q', label: `Search: "${search.trim()}"`, remove: () => setSearch('') },
    actionFilter && { key: 'action', label: `Action: ${actionFilter}`, remove: () => setActionFilter('') },
    entityFilter && { key: 'entity', label: `Entity: ${entityFilter}`, remove: () => setEntityFilter('') },
    actorFilter && { key: 'actor', label: `Actor: ${actorName(actorFilter)}`, remove: () => setActorFilter('') },
    dateFrom && { key: 'from', label: `From: ${fmtDay(dateFrom)}`, remove: () => setDateFrom('') },
    dateTo && { key: 'to', label: `To: ${fmtDay(dateTo)}`, remove: () => setDateTo('') },
  ]
    .filter((c): c is { key: string; label: string; remove: () => void } => Boolean(c))
    .map((c) => ({ ...c, remove: () => { c.remove(); setPage(1) } }))
  const hasFilters = chips.length > 0
  const clearFilters = () => {
    setSearch('')
    setActionFilter('')
    setEntityFilter('')
    setActorFilter('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const runExport = async (format: AuditExportFormat) => {
    setExporting(format)
    try {
      const { blob, filename } = await fetchAuditExport({ ...filters, format })
      downloadBlob(blob, filename ?? `audit-trail.${format}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Export failed'))
    } finally {
      setExporting(null)
    }
  }

  const openDetail = (log: AuditLog) => {
    setSelected(log)
    setPanelOpen(true)
  }

  const errorMsg = isError ? getApiErrorMessage(error, 'Failed to load audit logs') : undefined
  const selectedChanges = selected ? fieldChanges(selected) : []
  const changesTitle = !selected?.old_values
    ? 'Recorded values'
    : selected?.new_values
      ? 'Changed fields'
      : 'Removed snapshot'

  const actionOptions = [
    { value: '', label: 'All actions' },
    ...(facets?.actions ?? []).map((a) => ({ value: a, label: a })),
  ]
  const entityOptions = [
    { value: '', label: 'All entities' },
    ...(facets?.entity_types ?? []).map((e) => ({ value: e, label: e })),
  ]
  const actorOptions = [
    { value: '', label: 'All actors' },
    ...(facets?.actors ?? []).map((u) => ({ value: String(u.id), label: u.name })),
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Immutable, GDPR-ready trail of every sensitive action — who did what, when and from where"
        actions={
          <>
            <Button
              variant="ghost"
              leftIcon={DownloadIcon}
              isLoading={exporting === 'csv'}
              disabled={!!exporting}
              onClick={() => runExport('csv')}
            >
              CSV
            </Button>
            <Button
              variant="ghost"
              leftIcon={DownloadIcon}
              isLoading={exporting === 'xlsx'}
              disabled={!!exporting}
              onClick={() => runExport('xlsx')}
            >
              Excel
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total events" value={stats?.total ?? '—'} />
        <StatCard label="Events today" value={stats?.today ?? '—'} tone={stats?.today ? 'warn' : undefined} />
        <StatCard label="Actors" value={stats?.actors ?? '—'} />
        <StatCard label="Action types" value={stats?.action_types ?? '—'} />
      </div>

      <Card padding={false} className="overflow-hidden">
        {/* Combobox/DatePicker roots are w-full — size them via wrapper divs. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3">
          <SearchBox
            className="w-60"
            placeholder="Search action, actor, entity, IP…"
            value={search}
            onChange={(v) => setFilter(setSearch, v)}
          />
          <div className="w-44">
            <Combobox
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(v) => setFilter(setActionFilter, v)}
              options={actionOptions}
            />
          </div>
          <div className="w-40">
            <Combobox
              aria-label="Filter by entity type"
              value={entityFilter}
              onChange={(v) => setFilter(setEntityFilter, v)}
              options={entityOptions}
            />
          </div>
          <div className="w-44">
            <Combobox
              aria-label="Filter by actor"
              value={actorFilter}
              onChange={(v) => setFilter(setActorFilter, v)}
              options={actorOptions}
            />
          </div>
          <div className="w-60">
            <DateRangePicker
              aria-label="Filter by date range"
              from={dateFrom}
              to={dateTo}
              onChange={({ from, to }) => {
                setDateFrom(from)
                setDateTo(to)
                setPage(1)
              }}
            />
          </div>

          <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-slate-500">
            {(list?.total ?? 0).toLocaleString()} {(list?.total ?? 0) === 1 ? 'event' : 'events'}
          </span>
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Filters
            </span>
            {chips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} onRemove={chip.remove} />
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
            >
              Clear all
            </button>
          </div>
        )}

        <DataTable
          data={logs}
          rowKey={(log) => log.id}
          loading={isPending}
          error={errorMsg}
          onRowClick={openDetail}
          empty={
            hasFilters
              ? 'No audit events match these filters'
              : 'No audit events recorded yet'
          }
          columns={[
            {
              key: 'time',
              header: 'Time',
              width: '10rem',
              className: 'whitespace-nowrap',
              cell: (log) => (
                <div>
                  <div className="text-sm text-slate-300">{relativeTime(log.created_at)}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(log.created_at).toLocaleString()}
                  </div>
                </div>
              ),
            },
            {
              key: 'actor',
              header: 'Actor',
              cell: (log) => <ActorIdentity log={log} />,
            },
            {
              key: 'action',
              header: 'Action',
              cell: (log) => <ActionBadge action={log.action} />,
            },
            {
              key: 'entity',
              header: 'Entity',
              className: 'text-slate-400',
              cell: (log) =>
                log.entity_type ? (
                  <span>
                    {log.entity_type}
                    {log.entity_id != null && <span className="text-slate-600">#{log.entity_id}</span>}
                  </span>
                ) : (
                  <span className="text-slate-600">—</span>
                ),
            },
            {
              key: 'changes',
              header: 'Changes',
              width: '6rem',
              cell: (log) => <ChangesSummaryCell log={log} />,
            },
            {
              key: 'ip',
              header: 'IP address',
              width: '9rem',
              className: 'font-mono text-xs text-slate-400',
              cell: (log) => log.ip_address ?? '—',
            },
          ]}
        />

        {list && list.last_page > 1 && (
          <div className="border-t border-slate-800 p-4">
            <Pagination
              page={list.current_page}
              pageCount={list.last_page}
              onPageChange={setPage}
              totalItems={list.total}
              pageSize={PER_PAGE}
            />
          </div>
        )}
      </Card>

      <SidePanel
        open={panelOpen}
        title="Audit event"
        description={selected ? `Event #${selected.id}` : undefined}
        onClose={() => setPanelOpen(false)}
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <ActionBadge action={selected.action} />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Actor
              </h4>
              <ActorIdentity log={selected} large />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Event
              </h4>
              <div className="space-y-2">
                <DetailRow label="Timestamp">
                  {new Date(selected.created_at).toLocaleString()}
                  <span className="ml-1.5 text-xs text-slate-500">
                    ({relativeTime(selected.created_at)})
                  </span>
                </DetailRow>
                <DetailRow label="Entity">
                  {selected.entity_type
                    ? `${selected.entity_type}${selected.entity_id != null ? ` #${selected.entity_id}` : ''}`
                    : '—'}
                </DetailRow>
                <DetailRow label="IP address">
                  <span className="font-mono text-xs">{selected.ip_address ?? '—'}</span>
                </DetailRow>
              </div>
            </div>

            {selectedChanges.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {changesTitle}
                </h4>
                <ChangeList changes={selectedChanges} />
              </div>
            )}

            {selected.user_agent && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  User agent
                </h4>
                <p className="break-all rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-400">
                  {selected.user_agent}
                </p>
              </div>
            )}
          </div>
        )}
      </SidePanel>
    </div>
  )
}
