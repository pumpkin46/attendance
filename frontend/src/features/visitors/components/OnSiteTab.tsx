import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveVisitors, useCheckOutVisitor } from '@/features/visitors/api/queries'
import { formatDuration } from '@/features/visitors/types'
import { VisitorCell } from '@/features/visitors/components/VisitorUI'

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
          cell: (v) => <VisitorCell name={v.name} seed={v.id} sub={v.badge_number ? `Badge ${v.badge_number}` : '—'} />,
        },
        { key: 'host', header: 'Host', cell: (v) => (v.host ? `${v.host.first_name} ${v.host.last_name}` : '—') },
        { key: 'zone', header: 'Zone', cell: (v) => v.current_zone ?? 'Reception' },
        {
          key: 'checkin',
          header: 'Check-in',
          className: 'text-xs',
          cell: (v) => (v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '—'),
        },
        {
          key: 'duration',
          header: 'Duration',
          cell: (v) => (v.checked_in_at ? <Badge tone="neutral">{formatDuration(v.checked_in_at)}</Badge> : '—'),
        },
        {
          key: 'actions',
          header: '',
          align: 'right',
          cell: (v) => (
            <Button size="sm" variant="ghost" isLoading={checkOut.isPending} onClick={() => checkOut.mutate(v.id)}>
              Check out
            </Button>
          ),
        },
      ]}
    />
  )
}
