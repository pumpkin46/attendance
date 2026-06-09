import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DataTable } from '@/shared/ui/DataTable'
import { usePendingApprovals } from '@/features/visitors/api/queries'
import { VisitorCell } from '@/features/visitors/components/VisitorUI'

export function ApprovalsTab({ onSelect }: { onSelect: (id: number) => void }) {
  const { data: pendingApprovals = [] } = usePendingApprovals()

  return (
    <>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-600/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>Pre-registered visitors require manager and security approval before check-in.</span>
      </div>
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
              <VisitorCell name={v.name} seed={v.id} sub={v.visitor_category?.replace(/_/g, ' ')} />
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
            align: 'center',
            cell: (v) => (
              <Badge tone="warn" className="capitalize">
                {v.approval_status?.replace(/_/g, ' ') ?? 'pending'}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (v) => (
              <Button size="sm" onClick={() => onSelect(v.id)}>
                Review
              </Button>
            ),
          },
        ]}
      />
    </>
  )
}
