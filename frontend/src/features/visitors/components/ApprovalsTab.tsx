import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { DataTable } from '@/shared/ui/DataTable'
import { usePendingApprovals } from '@/features/visitors/api/queries'

export function ApprovalsTab({ onSelect }: { onSelect: (id: number) => void }) {
  const { data: pendingApprovals = [] } = usePendingApprovals()

  return (
    <>
      <Card className="mb-4">
        <p className="text-sm text-slate-400">
          Pre-registered visitors require manager and security approval before check-in.
        </p>
      </Card>
      <DataTable
        data={pendingApprovals}
        rowKey={(v) => v.id}
        pageSize={10}
        empty="No pending approvals."
        columns={[
          {
            key: 'visitor',
            header: 'Visitor',
            cell: (v) => (
              <>
                <div className="font-medium">{v.name}</div>
                <div className="text-xs capitalize text-slate-500">{v.visitor_category?.replace(/_/g, ' ')}</div>
              </>
            ),
          },
          { key: 'company', header: 'Company', cell: (v) => v.company ?? '—' },
          { key: 'host', header: 'Host', cell: (v) => (v.host ? `${v.host.first_name} ${v.host.last_name}` : '—') },
          {
            key: 'date',
            header: 'Visit date',
            className: 'text-xs',
            cell: (v) => new Date(v.visit_start_at).toLocaleString(),
          },
          {
            key: 'stage',
            header: 'Approval stage',
            cell: (v) => <Badge tone="warn">{v.approval_status?.replace(/_/g, ' ') ?? 'pending'}</Badge>,
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (v) => <Button variant="ghost" onClick={() => onSelect(v.id)}>Review</Button>,
          },
        ]}
      />
    </>
  )
}
