import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
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
    <TableShell>
      <TableHead>
        <Th>Employee</Th>
        <Th>Type</Th>
        <Th>From</Th>
        <Th>To</Th>
        <Th>Reason</Th>
        <Th>Status</Th>
        <Th>Actions</Th>
      </TableHead>
      <TableBody>
        {isPending ? (
          <tr>
            <Td colSpan={7} className="text-slate-400">
              Loading…
            </Td>
          </tr>
        ) : leave.length === 0 ? (
          <tr>
            <Td colSpan={7} className="text-slate-400">
              No leave requests
            </Td>
          </tr>
        ) : (
          leave.map((l) => (
            <tr key={l.id}>
              <Td>{empName.get(l.employee_id) ?? `#${l.employee_id}`}</Td>
              <Td className="capitalize">{l.type}</Td>
              <Td>{l.start_date}</Td>
              <Td>{l.end_date}</Td>
              <Td className="max-w-xs truncate text-slate-400">{l.reason ?? '—'}</Td>
              <Td>
                <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
              </Td>
              <Td>
                {l.status === 'pending' ? (
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
                )}
              </Td>
            </tr>
          ))
        )}
      </TableBody>
    </TableShell>
  )
}
