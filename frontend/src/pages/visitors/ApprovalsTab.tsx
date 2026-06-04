import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TableBody, TableHead, TableShell, Td, Th } from '../../components/ui/DataTable'
import { usePendingApprovals } from './queries'

export function ApprovalsTab({ onSelect }: { onSelect: (id: number) => void }) {
  const { data: pendingApprovals = [] } = usePendingApprovals()

  return (
    <>
      <Card className="mb-4">
        <p className="text-sm text-slate-400">
          Pre-registered visitors require manager and security approval before check-in.
        </p>
      </Card>
      <TableShell>
        <TableHead>
          <Th>Visitor</Th>
          <Th>Company</Th>
          <Th>Host</Th>
          <Th>Visit date</Th>
          <Th>Approval stage</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {pendingApprovals.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-center text-slate-500">No pending approvals.</Td>
            </tr>
          ) : (
            pendingApprovals.map((v) => (
              <tr key={v.id}>
                <Td>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs capitalize text-slate-500">{v.visitor_category?.replace(/_/g, ' ')}</div>
                </Td>
                <Td>{v.company ?? '—'}</Td>
                <Td>{v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}</Td>
                <Td className="text-xs">{new Date(v.visit_start_at).toLocaleString()}</Td>
                <Td>
                  <Badge tone="warn">{v.approval_status?.replace(/_/g, ' ') ?? 'pending'}</Badge>
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => onSelect(v.id)}>Review</Button>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </>
  )
}
