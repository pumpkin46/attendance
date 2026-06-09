import { useMemo, useState } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchBox } from '@/shared/ui/SearchBox'
import { StatCard } from '@/shared/ui/StatCard'
import { DataTable } from '@/shared/ui/DataTable'
import {
  useAcknowledgeAlert,
  useResolveAlert,
  useSecurityAlerts,
  useSecurityDashboard,
  useSecurityMonitoringConfig,
} from '@/features/security/api/queries'
import { SECURITY_SEVERITY_TONE as severityTone } from '@/features/security/types'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low']

const SEVERITY_CHIP: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400',
  high: 'bg-orange-500/15 text-orange-400',
  medium: 'bg-amber-500/15 text-amber-400',
  low: 'bg-slate-500/15 text-slate-300',
}

const statusTone = (status: string): 'ok' | 'warn' | 'neutral' =>
  status === 'resolved' ? 'ok' : status === 'open' ? 'warn' : 'neutral'

const prettify = (s: string) => s.replace(/_/g, ' ')

export default function SecurityMonitoringPage() {
  // Live via WebSocket; fall back to polling only when the socket is down.
  const poll = useFallbackPoll(60_000)
  const { data: config } = useSecurityMonitoringConfig()
  const dashboardQuery = useSecurityDashboard(poll)
  const alertsQuery = useSecurityAlerts(poll)

  const dashboard = dashboardQuery.data
  const alerts = useMemo(() => alertsQuery.data?.data ?? [], [alertsQuery.data])

  const ackMutation = useAcknowledgeAlert()
  const resolveMutation = useResolveAlert()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')

  const statusOptions = useMemo(() => {
    const set = new Set(alerts.map((a) => a.status).filter(Boolean))
    return [
      { value: '', label: 'All statuses' },
      ...Array.from(set, (s) => ({ value: s, label: prettify(s) })),
    ]
  }, [alerts])

  const severityOptions = useMemo(() => {
    const present = new Set(alerts.map((a) => a.severity))
    return [
      { value: '', label: 'All severities' },
      ...SEVERITY_ORDER.filter((s) => present.has(s)).map((s) => ({ value: s, label: prettify(s) })),
    ]
  }, [alerts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false
      if (severityFilter && a.severity !== severityFilter) return false
      if (q) {
        const hay = `${a.title} ${a.description ?? ''} ${a.alert_type}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [alerts, search, statusFilter, severityFilter])

  const errorMsg = alertsQuery.isError
    ? getApiErrorMessage(alertsQuery.error, 'Failed to load security alerts')
    : undefined

  const bySeverity = dashboard?.by_severity ?? {}
  const byType = Object.entries(dashboard?.by_type ?? {}).sort((a, b) => b[1] - a[1])

  return (
    <div>
      <PageHeader
        title="AI Security Monitoring"
        description="Real-time alerts for unknown persons, spoof attempts, access denials, after-hours entry, and tailgating."
        actions={
          config && (
            <Badge tone={config.enabled ? 'ok' : 'neutral'}>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    config.enabled ? 'bg-emerald-400' : 'bg-slate-500'
                  )}
                />
                {config.enabled ? 'Monitoring active' : 'Monitoring disabled'}
              </span>
            </Badge>
          )
        }
      />

      {config && !config.enabled && (
        <Card className="mb-6 border-amber-700/50 bg-amber-950/30">
          <p className="text-sm font-medium text-amber-200">AI security monitoring is disabled</p>
          <p className="mt-1 text-xs text-slate-400">
            Existing alerts are shown below, but new ones will not be generated until monitoring is
            enabled in the server configuration.
          </p>
        </Card>
      )}

      {errorMsg && (
        <Card className="mb-6 border-red-700/50 bg-red-950/30">
          <p className="text-sm font-medium text-red-300">{errorMsg}</p>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Open alerts"
          value={dashboard?.open_alerts ?? 0}
          tone={dashboard?.open_alerts ? 'warn' : undefined}
        />
        <StatCard
          label="Critical"
          value={bySeverity.critical ?? 0}
          tone={bySeverity.critical ? 'danger' : undefined}
        />
        <StatCard label="Acknowledged" value={dashboard?.acknowledged_alerts ?? 0} />
        <StatCard
          label="Resolved"
          value={dashboard?.resolved_alerts ?? 0}
          tone={dashboard?.resolved_alerts ? 'ok' : undefined}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            By severity
          </h2>
          {SEVERITY_ORDER.some((s) => bySeverity[s]) ? (
            <div className="flex flex-wrap gap-2">
              {SEVERITY_ORDER.filter((s) => bySeverity[s]).map((s) => (
                <span
                  key={s}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize',
                    SEVERITY_CHIP[s]
                  )}
                >
                  {s}
                  <span className="font-mono">{bySeverity[s]}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No alerts recorded.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            By type
          </h2>
          {byType.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {byType.map(([type, count]) => (
                <span
                  key={type}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-700/40 px-2.5 py-1 text-xs font-medium capitalize text-slate-300"
                >
                  {prettify(type)}
                  <span className="font-mono text-slate-400">{count}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No alerts recorded.</p>
          )}
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            className="w-64"
            placeholder="Search title, type, message…"
            value={search}
            onChange={setSearch}
          />
          <Combobox
            className="w-44"
            value={severityFilter}
            onChange={setSeverityFilter}
            options={severityOptions}
          />
          <Combobox
            className="w-44"
            value={statusFilter}
            onChange={setStatusFilter}
            options={statusOptions}
          />
        </div>
        <span className="text-xs text-slate-500">
          {filtered.length} {filtered.length === 1 ? 'alert' : 'alerts'}
        </span>
      </div>

      <DataTable
        data={filtered}
        rowKey={(a) => a.id}
        pageSize={12}
        loading={alertsQuery.isPending}
        error={errorMsg}
        empty="No security alerts match these filters"
        columns={[
          {
            key: 'time',
            header: 'Time',
            cell: (a) => {
              if (!a.created_at) return <span className="text-slate-500">—</span>
              const d = new Date(a.created_at)
              return (
                <div className="whitespace-nowrap">
                  <div className="text-slate-200">{d.toLocaleDateString()}</div>
                  <div className="text-xs text-slate-500">
                    {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )
            },
          },
          {
            key: 'severity',
            header: 'Severity',
            cell: (a) => (
              <Badge tone={severityTone[a.severity] ?? 'neutral'}>
                <span className="capitalize">{a.severity}</span>
              </Badge>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            className: 'text-xs capitalize text-slate-400',
            cell: (a) => prettify(a.alert_type),
          },
          {
            key: 'alert',
            header: 'Alert',
            cell: (a) => (
              <div>
                <div className="font-medium text-slate-100">{a.title}</div>
                {a.description && <div className="text-xs text-slate-400">{a.description}</div>}
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (a) => (
              <Badge tone={statusTone(a.status)}>
                <span className="capitalize">{a.status}</span>
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (a) => (
              <div className="flex gap-1">
                {a.status === 'open' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    isLoading={ackMutation.isPending}
                    onClick={() => ackMutation.mutate(a.id)}
                  >
                    Acknowledge
                  </Button>
                )}
                {a.status !== 'resolved' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    isLoading={resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate(a.id)}
                  >
                    Resolve
                  </Button>
                )}
                {a.status === 'resolved' && <span className="text-xs text-slate-500">—</span>}
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
