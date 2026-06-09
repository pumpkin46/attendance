import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { StatCardSkeleton } from '@/shared/ui/Skeleton'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveVisitors, useVisitorStats } from '@/features/visitors/api/queries'
import { formatDuration } from '@/features/visitors/types'
import { Kpi, VisitorCell } from '@/features/visitors/components/VisitorUI'

const i = 'h-5 w-5'
const OnSiteIcon = (
  <svg viewBox="0 0 24 24" className={i} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5 1 0 2 .2 2.8.6M16 18l2 2 4-4" /></svg>
)
const CalendarIcon = (
  <svg viewBox="0 0 24 24" className={i} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /></svg>
)
const LoginIcon = (
  <svg viewBox="0 0 24 24" className={i} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
)
const LogoutIcon = (
  <svg viewBox="0 0 24 24" className={i} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M16 17l5-5-5-5M21 12H9" /></svg>
)
const OverdueIcon = (
  <svg viewBox="0 0 24 24" className={i} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>
)
const PendingIcon = (
  <svg viewBox="0 0 24 24" className={i} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12M6 21h12M7 3c0 4 4 5 4 9s-4 5-4 9M17 3c0 4-4 5-4 9s4 5 4 9" /></svg>
)

export function VisitorDashboardTab() {
  // Live via WebSocket 'visitors.changed'; resynced on reconnect.
  const { data: stats, isLoading } = useVisitorStats()
  const { data: activeVisitors = [] } = useActiveVisitors()

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {isLoading || !stats ? (
          Array.from({ length: 6 }).map((_, idx) => <StatCardSkeleton key={idx} />)
        ) : (
          <>
            <Kpi label="On site" value={stats.on_site} tone="ok" icon={OnSiteIcon} />
            <Kpi label="Expected" value={stats.expected} tone="accent" icon={CalendarIcon} />
            <Kpi label="Checked in" value={stats.checked_in_today} tone="ok" icon={LoginIcon} />
            <Kpi label="Checked out" value={stats.checked_out_today} icon={LogoutIcon} />
            <Kpi label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : 'neutral'} icon={OverdueIcon} />
            <Kpi
              label="Pending approval"
              value={stats.pending_approval}
              tone={stats.pending_approval > 0 ? 'warn' : 'neutral'}
              icon={PendingIcon}
            />
          </>
        )}
      </div>

      <Card padding={false}>
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">Currently on site</h3>
          <Badge tone={activeVisitors.length > 0 ? 'ok' : 'neutral'}>{activeVisitors.length} on site</Badge>
        </div>
        {activeVisitors.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">No visitors on site.</p>
        ) : (
          <DataTable
            data={activeVisitors}
            rowKey={(v) => v.id}
            className="border-0"
            columns={[
              {
                key: 'visitor',
                header: 'Visitor',
                cell: (v) => <VisitorCell name={v.name} seed={v.id} sub={v.company ?? '—'} />,
              },
              { key: 'host', header: 'Host', cell: (v) => (v.host ? `${v.host.first_name} ${v.host.last_name}` : '—') },
              { key: 'zone', header: 'Zone', cell: (v) => v.current_zone ?? 'Reception' },
              {
                key: 'checkin',
                header: 'Check-in',
                className: 'text-xs',
                cell: (v) => (v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString() : '—'),
              },
              {
                key: 'duration',
                header: 'Duration',
                cell: (v) =>
                  v.checked_in_at ? (
                    <Badge tone="neutral">{formatDuration(v.checked_in_at)}</Badge>
                  ) : (
                    '—'
                  ),
              },
              { key: 'status', header: 'Status', align: 'center', cell: () => <Badge tone="ok">On site</Badge> },
            ]}
          />
        )}
      </Card>
    </>
  )
}
