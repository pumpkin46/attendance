import { Button } from '@/shared/ui/Button'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveVisitors, useCheckOutVisitor } from '@/features/visitors/api/queries'
import { formatDuration } from '@/features/visitors/types'

export function OnSiteTab() {
  const { data: activeVisitors = [] } = useActiveVisitors()
  const checkOut = useCheckOutVisitor()

  return (
    <DataTable
      data={activeVisitors}
      rowKey={(v) => v.id}
      pageSize={10}
      empty="No visitors on site."
      columns={[
        {
          key: 'visitor',
          header: 'Visitor',
          cell: (v) => (
            <>
              <div className="font-medium">{v.name}</div>
              <div className="text-xs text-slate-500">{v.badge_number}</div>
            </>
          ),
        },
        { key: 'host', header: 'Host', cell: (v) => (v.host ? `${v.host.first_name} ${v.host.last_name}` : '—') },
        { key: 'zone', header: 'Zone', cell: (v) => v.current_zone ?? 'Reception' },
        {
          key: 'checkin',
          header: 'Check-in',
          className: 'text-xs',
          cell: (v) => (v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '—'),
        },
        { key: 'duration', header: 'Duration', cell: (v) => (v.checked_in_at ? formatDuration(v.checked_in_at) : '—') },
        {
          key: 'actions',
          header: 'Actions',
          cell: (v) => <Button variant="ghost" onClick={() => checkOut.mutate(v.id)}>Check out</Button>,
        },
      ]}
    />
  )
}
