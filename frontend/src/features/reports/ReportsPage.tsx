import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { downloadBlob } from '@/shared/lib/download'
import { initialsOf, relativeTime } from '@/shared/lib/format'
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import { AuthImage } from '@/shared/components/AuthImage'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { DataTable } from '@/shared/ui/DataTable'
import { DateRangePicker } from '@/shared/ui/DateRangePicker'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Pagination } from '@/shared/ui/Pagination'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
import {
  fetchSecurityAlertExport,
  useAcknowledgeAlert,
  useResolveAlert,
  useSecurityAlerts,
  useSecurityDashboard,
  useSecurityMonitoringConfig,
} from '@/features/reports/api/queries'
import {
  ALERT_TYPE_LABELS,
  type AlertSeverity,
  type AlertStatus,
  type SecurityAlert,
  type SecurityExportFormat,
} from '@/features/reports/types'

const SEVERITY_ORDER: AlertSeverity[] = ['critical', 'high', 'medium', 'low']

const SEVERITY_STYLE: Record<AlertSeverity, { dot: string; text: string; bg: string; accent: string }> = {
  critical: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/15', accent: 'border-l-red-500' },
  high: { dot: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/15', accent: 'border-l-orange-500' },
  medium: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/15', accent: 'border-l-amber-500' },
  low: { dot: 'bg-slate-500', text: 'text-slate-300', bg: 'bg-slate-500/15', accent: 'border-l-slate-500' },
}

const STATUS_TONE: Record<AlertStatus, 'ok' | 'warn' | 'neutral'> = {
  open: 'warn',
  acknowledged: 'neutral',
  resolved: 'ok',
}

const STATUS_TABS: { id: string; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'resolved', label: 'Resolved' },
  { id: '', label: 'All' },
]

const PER_PAGE = 10

const prettify = (s: string) => s.replace(/_/g, ' ')
const typeLabel = (t: string) => ALERT_TYPE_LABELS[t] ?? prettify(t)

const DownloadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

// ── Building blocks ──────────────────────────────────────────────────────────

function SeverityTile({
  label,
  value,
  dot,
  accent,
  active,
  onClick,
}: {
  label: string
  value: number
  dot: string
  accent: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-xl border border-slate-700 border-l-4 bg-slate-900 p-4 text-left transition-colors',
        'hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        accent,
        active && 'bg-slate-800 ring-1 ring-blue-500/70'
      )}
    >
      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        {label}
      </span>
      <span className="mt-2 block text-3xl font-semibold text-slate-100">{value}</span>
    </button>
  )
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.low
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', s.bg, s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {severity}
    </span>
  )
}

function TrendChart({ trend }: { trend: { day: string; count: number }[] }) {
  const max = Math.max(1, ...trend.map((p) => p.count))
  const fmtDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <div>
      <div className="flex h-20 items-end gap-1" role="img" aria-label="Alerts per day, last 14 days">
        {trend.map((p) => (
          <div key={p.day} className="group relative flex-1">
            <div
              className={cn(
                'w-full rounded-sm transition-colors',
                p.count > 0 ? 'bg-blue-500/80 group-hover:bg-blue-400' : 'bg-slate-800'
              )}
              style={{ height: `${Math.max(p.count > 0 ? 8 : 3, (p.count / max) * 80)}px` }}
              title={`${fmtDay(p.day)}: ${p.count} ${p.count === 1 ? 'alert' : 'alerts'}`}
            />
          </div>
        ))}
      </div>
      {trend.length > 0 && (
        <div className="mt-1.5 flex justify-between text-[10px] text-slate-600">
          <span>{fmtDay(trend[0].day)}</span>
          <span>{fmtDay(trend[trend.length - 1].day)}</span>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-right text-slate-300">{children}</span>
    </div>
  )
}

function TimelineRow({ label, at }: { label: string; at?: string | null }) {
  if (!at) return null
  return (
    <DetailRow label={label}>
      {new Date(at).toLocaleString()}
      <span className="ml-1.5 text-xs text-slate-500">({relativeTime(at)})</span>
    </DetailRow>
  )
}

function MetadataList({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(([, v]) => v !== null && v !== undefined)
  if (entries.length === 0) return null
  return (
    <dl className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-4 px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{prettify(key)}</dt>
          <dd className="break-all text-right font-mono text-xs text-slate-300">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function AlertSource({ alert }: { alert: SecurityAlert }) {
  const e = alert.employee
  return (
    <div className="min-w-0">
      {e ? (
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-200">
            {initialsOf(e.first_name, e.last_name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm text-slate-200">{`${e.first_name} ${e.last_name}`}</div>
            {alert.camera && <div className="truncate text-xs text-slate-500">{alert.camera.name}</div>}
          </div>
        </div>
      ) : alert.camera ? (
        <span className="text-sm text-slate-300">{alert.camera.name}</span>
      ) : (
        <span className="text-xs text-slate-600">—</span>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  // Live via WebSocket ("security.changed" invalidates these queries);
  // fall back to polling only when the socket is down.
  const poll = useFallbackPoll(60_000)

  const [statusFilter, setStatusFilter] = useState('open')
  const [severityFilter, setSeverityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState<SecurityExportFormat | null>(null)
  // `selected` keeps the last opened alert mounted while the panel animates out.
  const [selected, setSelected] = useState<SecurityAlert | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const debouncedSearch = useDebouncedValue(search)
  const filters = {
    status: statusFilter || undefined,
    severity: severityFilter || undefined,
    alert_type: typeFilter || undefined,
    q: debouncedSearch.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }

  const { data: config } = useSecurityMonitoringConfig()
  const dashboardQuery = useSecurityDashboard(poll)
  const alertsQuery = useSecurityAlerts({ ...filters, page, per_page: PER_PAGE }, poll)

  const dashboard = dashboardQuery.data
  const list = alertsQuery.data
  const alerts = list?.data ?? []

  // Resolving the last item on a trailing page leaves `page` past the end —
  // follow the list as it shrinks (render-phase adjustment, re-renders before commit).
  if (list && list.last_page > 0 && page > list.last_page) setPage(list.last_page)

  const ackMutation = useAcknowledgeAlert()
  const resolveMutation = useResolveAlert()
  const pendingId = ackMutation.isPending
    ? ackMutation.variables
    : resolveMutation.isPending
      ? resolveMutation.variables
      : null

  const setFilter = (set: (value: string) => void, value: string) => {
    set(value)
    setPage(1)
  }
  const toggleSeverity = (severity: string) =>
    setFilter(setSeverityFilter, severityFilter === severity ? '' : severity)
  const hasFilters = Boolean(
    severityFilter || typeFilter || search.trim() || dateFrom || dateTo
  )
  const clearFilters = () => {
    setSeverityFilter('')
    setTypeFilter('')
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const typeOptions = useMemo(() => {
    const present = Object.keys(dashboard?.by_type ?? {}).sort()
    return [
      { value: '', label: 'All types' },
      ...present.map((t) => ({ value: t, label: typeLabel(t) })),
    ]
  }, [dashboard?.by_type])

  const bySeverity = dashboard?.by_severity ?? {}
  const trendTotal = (dashboard?.trend ?? []).reduce((sum, p) => sum + p.count, 0)

  const errorMsg = alertsQuery.isError
    ? getApiErrorMessage(alertsQuery.error, 'Failed to load security alerts')
    : undefined

  const runExport = async (format: SecurityExportFormat) => {
    setExporting(format)
    try {
      const { blob, filename } = await fetchSecurityAlertExport({ ...filters, format })
      downloadBlob(blob, filename ?? `security-alerts.${format}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Export failed'))
    } finally {
      setExporting(null)
    }
  }

  // Failures surface via the global mutation error toast.
  const transition = (mutation: typeof ackMutation, id: number) =>
    mutation.mutate(id, {
      // Keep the open detail panel showing the post-transition state.
      onSuccess: (updated) => setSelected((prev) => (prev?.id === updated.id ? updated : prev)),
    })

  const openDetail = (alert: SecurityAlert) => {
    setSelected(alert)
    setPanelOpen(true)
  }

  const actionButtons = (a: SecurityAlert, size: 'sm' | 'md') => {
    if (a.status === 'resolved') return null
    const busy = pendingId === a.id
    return (
      <>
        {a.status === 'open' && (
          <Button variant="ghost" size={size} disabled={busy} onClick={() => transition(ackMutation, a.id)}>
            Acknowledge
          </Button>
        )}
        <Button variant="success" size={size} disabled={busy} onClick={() => transition(resolveMutation, a.id)}>
          Resolve
        </Button>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Review, triage, and export AI security alerts."
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
            <Button
              variant="ghost"
              leftIcon={DownloadIcon}
              isLoading={exporting === 'pdf'}
              disabled={!!exporting}
              onClick={() => runExport('pdf')}
            >
              PDF
            </Button>
          </>
        }
      />

      {config && !config.enabled && (
        <Card className="border-amber-700/50 bg-amber-950/30">
          <p className="text-sm font-medium text-amber-200">AI security monitoring is disabled</p>
          <p className="mt-1 text-xs text-slate-400">
            Existing alerts are shown below, but new ones will not be generated until monitoring
            is enabled in the server configuration.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
          <SeverityTile
            label="Open alerts"
            value={dashboard?.open_alerts ?? 0}
            dot="bg-blue-400"
            accent="border-l-blue-500"
            active={severityFilter === ''}
            onClick={() => setFilter(setSeverityFilter, '')}
          />
          {SEVERITY_ORDER.map((sev) => (
            <SeverityTile
              key={sev}
              label={sev}
              value={bySeverity[sev] ?? 0}
              dot={SEVERITY_STYLE[sev].dot}
              accent={SEVERITY_STYLE[sev].accent}
              active={severityFilter === sev}
              onClick={() => toggleSeverity(sev)}
            />
          ))}
          <div className="rounded-xl border border-slate-700 border-l-4 border-l-emerald-500 bg-slate-900 p-4">
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Resolved
            </span>
            <span className="mt-2 block text-3xl font-semibold text-slate-100">
              {dashboard?.resolved_alerts ?? 0}
            </span>
          </div>
        </div>

        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Last 14 days
            </h2>
            <span className="text-xs text-slate-500">
              {trendTotal} {trendTotal === 1 ? 'alert' : 'alerts'}
            </span>
          </div>
          <TrendChart trend={dashboard?.trend ?? []} />
          {config && (
            <div className="mt-4 space-y-1.5 border-t border-slate-800 pt-3">
              <DetailRow label="After-hours window">
                <span className="font-mono text-xs">
                  {config.after_hours_start} – {config.after_hours_end}
                </span>
              </DetailRow>
              <DetailRow label="Tailgating window">
                <span className="font-mono text-xs">{config.tailgating_window}s</span>
              </DetailRow>
              <DetailRow label="Alert cooldown">
                <span className="font-mono text-xs">{config.alert_cooldown}s</span>
              </DetailRow>
            </div>
          )}
        </Card>
      </div>

      <Card padding={false} className="overflow-hidden">
        {/* Combobox/DatePicker roots are w-full — size them via wrapper divs. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 p-3">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5" role="group" aria-label="Filter by status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={statusFilter === tab.id}
                onClick={() => setFilter(setStatusFilter, tab.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  statusFilter === tab.id
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <SearchBox
            className="w-56"
            placeholder="Search title, message, type…"
            value={search}
            onChange={(v) => setFilter(setSearch, v)}
          />
          <div className="w-44">
            <Combobox
              aria-label="Filter by alert type"
              value={typeFilter}
              onChange={(v) => setFilter(setTypeFilter, v)}
              options={typeOptions}
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

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-slate-500">
            {(list?.total ?? 0).toLocaleString()} {(list?.total ?? 0) === 1 ? 'alert' : 'alerts'}
          </span>
        </div>

        <DataTable
          data={alerts}
          rowKey={(a) => a.id}
          loading={alertsQuery.isPending}
          error={errorMsg}
          onRowClick={openDetail}
          empty={
            hasFilters || statusFilter
              ? 'No security alerts match these filters'
              : 'No security alerts recorded'
          }
          columns={[
            {
              key: 'occurred',
              header: 'Occurred',
              width: '9rem',
              className: 'whitespace-nowrap',
              cell: (a) => {
                const at = a.occurred_at ?? a.created_at
                if (!at) return <span className="text-slate-500">—</span>
                return (
                  <div>
                    <div className="text-sm text-slate-300">{relativeTime(at)}</div>
                    <div className="text-xs text-slate-500">{new Date(at).toLocaleString()}</div>
                  </div>
                )
              },
            },
            {
              key: 'severity',
              header: 'Severity',
              width: '7rem',
              cell: (a) => <SeverityBadge severity={a.severity} />,
            },
            {
              key: 'type',
              header: 'Type',
              width: '10rem',
              cell: (a) => (
                <span className="inline-flex rounded-full bg-slate-700/40 px-2.5 py-1 text-xs font-medium text-slate-300">
                  {typeLabel(a.alert_type)}
                </span>
              ),
            },
            {
              key: 'alert',
              header: 'Alert',
              className: 'max-w-sm',
              cell: (a) => (
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-200">{a.title}</div>
                  {a.description && (
                    <div className="truncate text-xs text-slate-500">{a.description}</div>
                  )}
                </div>
              ),
            },
            {
              key: 'source',
              header: 'Source',
              width: '12rem',
              cell: (a) => <AlertSource alert={a} />,
            },
            {
              key: 'status',
              header: 'Status',
              width: '8rem',
              cell: (a) => (
                <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>
                  <span className="capitalize">{a.status}</span>
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (a) => (
                // Quick actions must not also open the detail panel.
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  {actionButtons(a, 'sm') ?? <span className="pr-2 text-xs text-slate-600">—</span>}
                </div>
              ),
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
        title="Alert details"
        description={selected ? typeLabel(selected.alert_type) : undefined}
        onClose={() => setPanelOpen(false)}
        footer={selected ? <div className="flex gap-2">{actionButtons(selected, 'md')}</div> : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selected.severity} />
              <Badge tone={STATUS_TONE[selected.status] ?? 'neutral'}>
                <span className="capitalize">{selected.status}</span>
              </Badge>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-100">{selected.title}</h3>
              {selected.description && (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
                  {selected.description}
                </p>
              )}
            </div>

            {selected.snapshot_path && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Snapshot
                </h4>
                <AuthImage
                  src={`/security-monitoring/alerts/${selected.id}/snapshot`}
                  alt="Alert snapshot"
                  className="max-h-72 w-full rounded-lg border border-slate-800 object-contain"
                  cache
                  fallback="Snapshot unavailable"
                />
              </div>
            )}

            {(selected.employee || selected.camera) && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Source
                </h4>
                <div className="space-y-1.5">
                  {selected.employee && (
                    <DetailRow label="Employee">
                      {`${selected.employee.first_name} ${selected.employee.last_name}`}
                      {selected.employee.employee_code && (
                        <span className="ml-1.5 text-xs text-slate-500">
                          ({selected.employee.employee_code})
                        </span>
                      )}
                    </DetailRow>
                  )}
                  {selected.camera && <DetailRow label="Camera">{selected.camera.name}</DetailRow>}
                </div>
              </div>
            )}

            {selected.metadata_json && Object.keys(selected.metadata_json).length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Detection details
                </h4>
                <MetadataList metadata={selected.metadata_json} />
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Timeline
              </h4>
              <div className="space-y-2">
                <TimelineRow label="Occurred" at={selected.occurred_at ?? selected.created_at} />
                <TimelineRow label="Acknowledged" at={selected.acknowledged_at} />
                <TimelineRow label="Resolved" at={selected.resolved_at} />
              </div>
            </div>
          </div>
        )}
      </SidePanel>
    </div>
  )
}
