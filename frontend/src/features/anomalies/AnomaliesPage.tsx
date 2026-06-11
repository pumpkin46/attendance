import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { PageHeader } from '@/shared/ui/PageHeader'
import { DataTable } from '@/shared/ui/DataTable'
import { Pagination } from '@/shared/ui/Pagination'
import { SidePanel } from '@/shared/ui/SidePanel'
import { cn } from '@/shared/lib/cn'
import { initialsOf, relativeTime } from '@/shared/lib/format'
import type { AttendanceAnomaly } from '@/shared/types'
import {
  useAnomalies,
  useAnomalySummary,
  useRunDetection,
  useUpdateAnomalyStatus,
} from '@/features/anomalies/api/queries'
import { TYPE_LABELS, type AnomalyDecision } from '@/features/anomalies/types'

type Severity = AttendanceAnomaly['severity']
type Status = AttendanceAnomaly['status']

const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; bg: string; bar: string; accent: string }> = {
  critical: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/15', bar: 'bg-red-500', accent: 'border-l-red-500' },
  high: { dot: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/15', bar: 'bg-orange-500', accent: 'border-l-orange-500' },
  medium: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/15', bar: 'bg-amber-500', accent: 'border-l-amber-500' },
  low: { dot: 'bg-slate-500', text: 'text-slate-300', bg: 'bg-slate-500/15', bar: 'bg-slate-500', accent: 'border-l-slate-500' },
}

const STATUS_TONE: Record<Status, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  open: 'warn',
  acknowledged: 'neutral',
  resolved: 'ok',
  false_positive: 'neutral',
}

const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  false_positive: 'Dismissed',
}

const STATUS_TABS: { id: string; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'acknowledged', label: 'Acknowledged' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'false_positive', label: 'Dismissed' },
  { id: '', label: 'All' },
]

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

function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLE[severity]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', s.bg, s.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {severity}
    </span>
  )
}

function ScoreMeter({ score, severity, wide }: { score: number; severity: Severity; wide?: boolean }) {
  const pct = Math.round(score * 100)
  return (
    <div className="flex items-center gap-2">
      <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-700', wide ? 'flex-1' : 'w-16')}>
        <div className={cn('h-full rounded-full', SEVERITY_STYLE[severity].bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-400">{pct}%</span>
    </div>
  )
}

function EmployeeIdentity({ anomaly, large }: { anomaly: AttendanceAnomaly; large?: boolean }) {
  const e = anomaly.employee
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full bg-slate-700 font-semibold text-slate-200',
          large ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-xs'
        )}
      >
        {e ? initialsOf(e.first_name, e.last_name) : '#'}
      </span>
      <div className="min-w-0">
        <div className={cn('truncate font-medium text-slate-100', large ? 'text-base' : 'text-sm')}>
          {e ? `${e.first_name} ${e.last_name}` : `#${anomaly.employee_id}`}
        </div>
        {e?.employee_code && <div className="truncate text-xs text-slate-500">{e.employee_code}</div>}
      </div>
    </div>
  )
}

function EvidenceList({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence)
  if (entries.length === 0) return null
  return (
    <dl className="divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-4 px-3 py-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{key.replace(/_/g, ' ')}</dt>
          <dd className="break-all text-right font-mono text-xs text-slate-300">
            {typeof value === 'object' && value !== null ? JSON.stringify(value, null, 0) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function TimelineRow({ label, at, detail }: { label: string; at: string | null | undefined; detail?: string }) {
  if (!at) return null
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-300">
        {new Date(at).toLocaleString()}
        <span className="ml-1.5 text-xs text-slate-500">({relativeTime(at)})</span>
        {detail && <span className="block text-xs text-slate-500">{detail}</span>}
      </span>
    </div>
  )
}

const PER_PAGE = 10

export default function AnomaliesPage() {
  const [statusFilter, setStatusFilter] = useState('open')
  const [severityFilter, setSeverityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [detectResult, setDetectResult] = useState<string | null>(null)
  // `selected` keeps the last opened anomaly mounted while the panel animates out.
  const [selected, setSelected] = useState<AttendanceAnomaly | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const { data: summary } = useAnomalySummary()
  const { data: list, isPending: loading } = useAnomalies({
    status: statusFilter || undefined,
    severity: severityFilter || undefined,
    anomaly_type: typeFilter || undefined,
    page,
    per_page: PER_PAGE,
  })
  const anomalies = list?.data ?? []

  const setFilter = (set: (value: string) => void, value: string) => {
    set(value)
    setPage(1)
  }
  const toggleSeverity = (severity: string) =>
    setFilter(setSeverityFilter, severityFilter === severity ? '' : severity)
  const toggleType = (type: string) => setFilter(setTypeFilter, typeFilter === type ? '' : type)

  // Resolving the last item on a trailing page leaves `page` past the end —
  // follow the list as it shrinks (render-phase adjustment, re-renders before commit).
  if (list && page > list.last_page) setPage(list.last_page)

  const detection = useRunDetection()
  const statusMutation = useUpdateAnomalyStatus()
  const pendingId = statusMutation.isPending ? statusMutation.variables?.id : null

  const runDetection = () => {
    setDetectResult(null)
    detection.mutate(undefined, {
      onSuccess: (data) =>
        setDetectResult(
          `Analysed ${data.records_analyzed} records — ${data.anomalies_detected} anomalies found in ${data.processing_ms}ms`
        ),
    })
  }

  const updateStatus = (id: number, status: AnomalyDecision) =>
    statusMutation.mutate(
      { id, status },
      {
        // Keep the open detail panel showing the post-transition state.
        onSuccess: (updated) => setSelected((prev) => (prev?.id === updated.id ? updated : prev)),
      }
    )

  const openDetail = (anomaly: AttendanceAnomaly) => {
    setSelected(anomaly)
    setPanelOpen(true)
  }

  const byType = Object.entries(summary?.by_type ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const byTypeMax = Math.max(1, ...byType.map(([, n]) => n))
  const hasFilters = severityFilter !== '' || typeFilter !== ''

  const actionButtons = (a: AttendanceAnomaly, size: 'sm' | 'md') => {
    const busy = pendingId === a.id
    if (a.status === 'resolved' || a.status === 'false_positive') return null
    return (
      <>
        {a.status === 'open' && (
          <Button variant="ghost" size={size} disabled={busy} onClick={() => updateStatus(a.id, 'acknowledged')}>
            Acknowledge
          </Button>
        )}
        <Button variant="success" size={size} disabled={busy} onClick={() => updateStatus(a.id, 'resolved')}>
          Resolve
        </Button>
        <Button variant="ghost" size={size} disabled={busy} onClick={() => updateStatus(a.id, 'false_positive')}>
          Dismiss
        </Button>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Anomalies"
        description="AI-powered detection of unusual patterns — rules plus Isolation Forest ML"
        actions={
          <Button onClick={runDetection} isLoading={detection.isPending}>
            Run detection
          </Button>
        }
      />

      {detectResult && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span className="flex-1">{detectResult}</span>
          <button
            type="button"
            onClick={() => setDetectResult(null)}
            aria-label="Dismiss"
            className="rounded p-0.5 text-emerald-400/70 transition-colors hover:text-emerald-200"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {summary && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
            <SeverityTile
              label="Open total"
              value={summary.open_total}
              dot="bg-blue-400"
              accent="border-l-blue-500"
              active={severityFilter === ''}
              onClick={() => setFilter(setSeverityFilter, '')}
            />
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <SeverityTile
                key={sev}
                label={sev}
                value={summary[sev]}
                dot={SEVERITY_STYLE[sev].dot}
                accent={SEVERITY_STYLE[sev].accent}
                active={severityFilter === sev}
                onClick={() => toggleSeverity(sev)}
              />
            ))}
          </div>

          <Card>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Most frequent open types
            </h2>
            {byType.length > 0 ? (
              <ul className="space-y-1">
                {byType.map(([type, count]) => (
                  <li key={type}>
                    <button
                      type="button"
                      onClick={() => toggleType(type)}
                      aria-pressed={typeFilter === type}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-slate-800',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                        typeFilter === type && 'bg-slate-800 ring-1 ring-blue-500/50'
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="truncate text-slate-300">{TYPE_LABELS[type] ?? type}</span>
                        <span className="font-mono text-slate-400">{count}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${(count / byTypeMax) * 100}%` }}
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No open anomalies — run detection to scan recent attendance.</p>
            )}
          </Card>
        </div>
      )}

      <Card padding={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-4">
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

          <Combobox value={typeFilter} onChange={(v) => setFilter(setTypeFilter, v)} className="min-w-44">
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Combobox>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSeverityFilter('')
                setTypeFilter('')
                setPage(1)
              }}
              className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
            >
              Clear filters
            </button>
          )}

          <span className="ml-auto text-sm text-slate-500">
            {list?.total ?? 0} {(list?.total ?? 0) === 1 ? 'result' : 'results'}
          </span>
        </div>

        <DataTable
          data={anomalies}
          rowKey={(a) => a.id}
          loading={loading}
          onRowClick={openDetail}
          empty="No anomalies found — run detection to scan recent attendance"
          columns={[
            {
              key: 'detected',
              header: 'Detected',
              width: '9rem',
              className: 'whitespace-nowrap',
              cell: (a) => (
                <div>
                  <div className="text-sm text-slate-300">{relativeTime(a.detected_at)}</div>
                  <div className="text-xs text-slate-500">{new Date(a.detected_at).toLocaleString()}</div>
                </div>
              ),
            },
            {
              key: 'employee',
              header: 'Employee',
              cell: (a) => <EmployeeIdentity anomaly={a} />,
            },
            {
              key: 'anomaly',
              header: 'Anomaly',
              className: 'max-w-sm',
              cell: (a) => (
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-200">
                    {a.title || TYPE_LABELS[a.anomaly_type] || a.anomaly_type}
                  </div>
                  <div className="truncate text-xs text-slate-500">{a.description}</div>
                </div>
              ),
            },
            {
              key: 'severity',
              header: 'Severity',
              width: '7rem',
              cell: (a) => <SeverityBadge severity={a.severity} />,
            },
            {
              key: 'score',
              header: 'Score',
              width: '8rem',
              cell: (a) => <ScoreMeter score={a.score} severity={a.severity} />,
            },
            {
              key: 'status',
              header: 'Status',
              width: '8rem',
              cell: (a) => <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>,
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
        title="Anomaly details"
        description={selected ? TYPE_LABELS[selected.anomaly_type] ?? selected.anomaly_type : undefined}
        onClose={() => setPanelOpen(false)}
        footer={selected ? <div className="flex gap-2">{actionButtons(selected, 'md')}</div> : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selected.severity} />
              <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
            </div>

            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {selected.title || TYPE_LABELS[selected.anomaly_type] || selected.anomaly_type}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{selected.description}</p>
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Anomaly score</h4>
              <ScoreMeter score={selected.score} severity={selected.severity} wide />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Employee</h4>
              <EmployeeIdentity anomaly={selected} large />
            </div>

            {selected.evidence && Object.keys(selected.evidence).length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Evidence</h4>
                <EvidenceList evidence={selected.evidence} />
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Timeline</h4>
              <div className="space-y-2">
                <TimelineRow label="Detected" at={selected.detected_at} />
                <TimelineRow label="Acknowledged" at={selected.acknowledged_at} />
                <TimelineRow
                  label={selected.status === 'false_positive' ? 'Dismissed' : 'Resolved'}
                  at={selected.resolved_at}
                />
              </div>
            </div>

            {selected.detection_run_id && (
              <p className="break-all text-xs text-slate-600">Detection run {selected.detection_run_id}</p>
            )}
          </div>
        )}
      </SidePanel>
    </div>
  )
}
