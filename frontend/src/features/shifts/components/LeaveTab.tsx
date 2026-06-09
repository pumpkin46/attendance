import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveEmployees } from '@/features/employees/api/queries'
import { useDecideLeave, useLeaveRequests } from '@/features/shifts/api/queries'
import { initials } from '@/shared/lib/format'

const STATUS_TONE = { approved: 'ok', rejected: 'danger', pending: 'warn' } as const

export function LeaveTab() {
  const { data: leaveResp, isPending } = useLeaveRequests()
  const decide = useDecideLeave()
  const { data: employeesResp } = useActiveEmployees()

  const leave = leaveResp?.data ?? []
  const empName = new Map(
    (employeesResp?.data ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`])
  )
  const pendingCount = leave.filter((l) => l.status === 'pending').length

  return (
    <Card padding={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Leave requests</h2>
          <p className="text-xs text-slate-400">Review and approve employee time-off requests.</p>
        </div>
        {pendingCount > 0 && <Badge tone="warn">{pendingCount} pending</Badge>}
      </div>

      <DataTable
        data={leave}
        rowKey={(l) => l.id}
        pageSize={10}
        loading={isPending}
        empty="No leave requests"
        columns={[
          {
            key: 'employee',
            header: 'Employee',
            cell: (l) => {
              const name = empName.get(l.employee_id) ?? `#${l.employee_id}`
              return (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
                    {empName.get(l.employee_id) ? initials(name) : '#'}
                  </span>
                  <span className="text-sm font-medium text-slate-100">{name}</span>
                </div>
              )
            },
          },
          { key: 'type', header: 'Type', className: 'capitalize', cell: (l) => l.type },
          { key: 'from', header: 'From', className: 'font-mono text-xs text-slate-300', cell: (l) => l.start_date },
          { key: 'to', header: 'To', className: 'font-mono text-xs text-slate-300', cell: (l) => l.end_date },
          { key: 'reason', header: 'Reason', className: 'max-w-xs truncate text-slate-400', cell: (l) => l.reason ?? '—' },
          { key: 'status', header: 'Status', cell: (l) => <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge> },
          {
            key: 'actions',
            header: 'Actions',
            cell: (l) =>
              l.status === 'pending' ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: l.id, status: 'approved' })}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: l.id, status: 'rejected' })}
                  >
                    Reject
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-slate-500">—</span>
              ),
          },
        ]}
      />
    </Card>
  )
}
