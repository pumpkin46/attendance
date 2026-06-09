import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DataTable } from '@/shared/ui/DataTable'
import { useActiveEmployees } from '@/features/employees/api/queries'
import { useDecideLeave, useLeaveRequests } from '@/features/shifts/api/queries'

const STATUS_TONE = { approved: 'ok', rejected: 'danger', pending: 'warn' } as const

export function LeaveTab() {
  const { data: leaveResp, isPending } = useLeaveRequests()
  const decide = useDecideLeave()
  const { data: employeesResp } = useActiveEmployees()

  const leave = leaveResp?.data ?? []
  const empName = new Map(
    (employeesResp?.data ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`])
  )

  return (
    <DataTable
      data={leave}
      rowKey={(l) => l.id}
      pageSize={10}
      loading={isPending}
      empty="No leave requests"
      columns={[
        { key: 'employee', header: 'Employee', cell: (l) => empName.get(l.employee_id) ?? `#${l.employee_id}` },
        { key: 'type', header: 'Type', className: 'capitalize', cell: (l) => l.type },
        { key: 'from', header: 'From', cell: (l) => l.start_date },
        { key: 'to', header: 'To', cell: (l) => l.end_date },
        { key: 'reason', header: 'Reason', className: 'max-w-xs truncate text-slate-400', cell: (l) => l.reason ?? '—' },
        { key: 'status', header: 'Status', cell: (l) => <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge> },
        {
          key: 'actions',
          header: 'Actions',
          cell: (l) =>
            l.status === 'pending' ? (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: l.id, status: 'approved' })}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
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
  )
}
