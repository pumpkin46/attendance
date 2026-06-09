import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { StatCard } from '@/shared/ui/StatCard'
import { StatCardSkeleton } from '@/shared/ui/Skeleton'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveVisitors, useVisitorStats } from '@/features/visitors/api/queries'
import { formatDuration } from '@/features/visitors/types'

export function VisitorDashboardTab() {
  // Live via WebSocket 'visitors.changed'; resynced on reconnect.
  const { data: stats, isLoading } = useVisitorStats()
  const { data: activeVisitors = [] } = useActiveVisitors()

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {isLoading || !stats ? (
          Array.from({ length: 6 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard label="On site" value={stats.on_site} tone="ok" />
            <StatCard label="Expected today" value={stats.expected} />
            <StatCard label="Checked in today" value={stats.checked_in_today} tone="ok" />
            <StatCard label="Checked out today" value={stats.checked_out_today} />
            <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : undefined} />
            <StatCard
              label="Pending approval"
              value={stats.pending_approval}
              tone={stats.pending_approval > 0 ? 'warn' : undefined}
            />
          </>
        )}
      </div>
      <Card>
        <h3 className="mb-4 text-sm font-semibold text-slate-300">Currently on site</h3>
        {activeVisitors.length === 0 ? (
          <p className="text-sm text-slate-500">No visitors on site.</p>
        ) : (
          <DataTable
            data={activeVisitors}
            rowKey={(v) => v.id}
            columns={[
              {
                key: 'visitor',
                header: 'Visitor',
                cell: (v) => (
                  <>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-slate-500">{v.company ?? '—'}</div>
                  </>
                ),
              },
              { key: 'host', header: 'Host', cell: (v) => (v.host ? `${v.host.first_name} ${v.host.last_name}` : '—') },
              { key: 'zone', header: 'Zone', cell: (v) => v.current_zone ?? 'Reception' },
              {
                key: 'checkin',
                header: 'Check-in',
                className: 'text-xs',
                cell: (v) => (v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString() : '—'),
              },
              { key: 'duration', header: 'Duration', cell: (v) => (v.checked_in_at ? formatDuration(v.checked_in_at) : '—') },
              { key: 'status', header: 'Status', cell: () => <Badge tone="ok">On site</Badge> },
            ]}
          />
        )}
      </Card>
    </>
  )
}
