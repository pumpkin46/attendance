import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { PageHeader } from '@/shared/ui/PageHeader'
import { DataTable } from '@/shared/ui/DataTable'
import { cn } from '@/shared/lib/cn'
import { initialsOf } from '@/shared/lib/format'
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

const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; bg: string; bar: string }> = {
  critical: { dot: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/15', bar: 'bg-red-500' },
  high: { dot: 'bg-orange-500', text: 'text-orange-400', bg: 'bg-orange-500/15', bar: 'bg-orange-500' },
  medium: { dot: 'bg-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/15', bar: 'bg-amber-500' },
  low: { dot: 'bg-slate-500', text: 'text-slate-300', bg: 'bg-slate-500/15', bar: 'bg-slate-500' },
}

const STATUS_STYLE: Record<Status, string> = {
  open: 'bg-amber-500/15 text-amber-400',
  acknowledged: 'bg-blue-500/15 text-blue-400',
  resolved: 'bg-emerald-500/15 text-emerald-400',
  false_positive: 'bg-slate-500/15 text-slate-400',
}

const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  false_positive: 'False positive',
}

function SeverityTile({
  label,
  value,
  tone,
  accent,
}: {
  label: string
  value: number
  tone: string
  accent: string
}) {
  return (
    <Card className={cn('border-l-4', accent)}>
      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span className={cn('h-2 w-2 rounded-full', tone)} />
        {label}
      </span>
      <span className="mt-2 block text-3xl font-semibold text-slate-100">{value}</span>
    </Card>
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

function ScoreMeter({ score, severity }: { score: number; severity: Severity }) {
  const pct = Math.round(score * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-700">
        <div className={cn('h-full rounded-full', SEVERITY_STYLE[severity].bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-400">{pct}%</span>
    </div>
  )
}

export default function AnomaliesPage() {
  const [statusFilter, setStatusFilter] = useState('open')
  const [severityFilter, setSeverityFilter] = useState('')
  const [detectResult, setDetectResult] = useState<string | null>(null)

  const { data: summary } = useAnomalySummary()
  const { data: list, isPending: loading } = useAnomalies(statusFilter, severityFilter)
  const anomalies = list?.data ?? []

  const detection = useRunDetection()
  const statusMutation = useUpdateAnomalyStatus()

  const runDetection = () => {
    setDetectResult(null)
    detection.mutate(undefined, {
      onSuccess: (data) =>
        setDetectResult(
          `Analysed ${data.records_analyzed} records — ${data.anomalies_found} anomalies found in ${data.processing_ms}ms`
        ),
    })
  }
  const updateStatus = (id: number, status: AnomalyDecision) => statusMutation.mutate({ id, status })

  const byType = Object.entries(summary?.by_type ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const byTypeMax = Math.max(1, ...byType.map(([, n]) => n))

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
          {detectResult}
        </div>
      )}

      {summary && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
            <SeverityTile label="Open total" value={summary.open_total} tone="bg-blue-400" accent="border-blue-500" />
            <SeverityTile label="Critical" value={summary.critical} tone={SEVERITY_STYLE.critical.dot} accent="border-red-500" />
            <SeverityTile label="High" value={summary.high} tone={SEVERITY_STYLE.high.dot} accent="border-orange-500" />
            <SeverityTile label="Medium" value={summary.medium} tone={SEVERITY_STYLE.medium.dot} accent="border-amber-500" />
            <SeverityTile label="Low" value={summary.low} tone={SEVERITY_STYLE.low.dot} accent="border-slate-600" />
          </div>

          <Card>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Most frequent types
            </h2>
            {byType.length > 0 ? (
              <ul className="space-y-2.5">
                {byType.map(([type, count]) => (
                  <li key={type}>
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
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No anomalies recorded yet.</p>
            )}
          </Card>
        </div>
      )}

      <Card padding={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 p-4">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Filters</span>
          <Combobox value={statusFilter} onChange={setStatusFilter} className="min-w-40">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False positive</option>
          </Combobox>
          <Combobox value={severityFilter} onChange={setSeverityFilter} className="min-w-40">
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Combobox>
          <span className="ml-auto text-sm text-slate-500">{anomalies.length} shown</span>
        </div>

        <DataTable
          data={anomalies}
          rowKey={(a) => a.id}
          pageSize={10}
          loading={loading}
          empty="No anomalies found — run detection to scan recent attendance"
          columns={[
            {
              key: 'detected',
              header: 'Detected',
              className: 'whitespace-nowrap text-xs text-slate-400',
              cell: (a) => new Date(a.detected_at).toLocaleString(),
            },
            {
              key: 'employee',
              header: 'Employee',
              cell: (a) => (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
                    {a.employee ? initialsOf(a.employee.first_name, a.employee.last_name) : '#'}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">
                      {a.employee ? `${a.employee.first_name} ${a.employee.last_name}` : `#${a.employee_id}`}
                    </div>
                    {a.employee?.employee_code && (
                      <div className="truncate text-xs text-slate-500">{a.employee.employee_code}</div>
                    )}
                  </div>
                </div>
              ),
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
              cell: (a) => <SeverityBadge severity={a.severity} />,
            },
            {
              key: 'score',
              header: 'Score',
              cell: (a) => <ScoreMeter score={a.score} severity={a.severity} />,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (a) => (
                <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLE[a.status])}>
                  {STATUS_LABEL[a.status]}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (a) => (
                <div className="flex gap-1">
                  {a.status === 'open' && (
                    <Button variant="ghost" size="sm" onClick={() => updateStatus(a.id, 'acknowledged')}>
                      Ack
                    </Button>
                  )}
                  {a.status !== 'resolved' && a.status !== 'false_positive' && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => updateStatus(a.id, 'resolved')}>
                        Resolve
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => updateStatus(a.id, 'false_positive')}>
                        Dismiss
                      </Button>
                    </>
                  )}
                  {(a.status === 'resolved' || a.status === 'false_positive') && (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
