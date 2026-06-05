import { Button } from '@/shared/ui/Button'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useActiveVisitors, useCheckOutVisitor } from '@/features/visitors/api/queries'
import { formatDuration } from '@/features/visitors/types'

export function OnSiteTab() {
  const { data: activeVisitors = [] } = useActiveVisitors()
  const checkOut = useCheckOutVisitor()

  return (
    <TableShell>
      <TableHead>
        <Th>Visitor</Th>
        <Th>Host</Th>
        <Th>Zone</Th>
        <Th>Check-in</Th>
        <Th>Duration</Th>
        <Th>Actions</Th>
      </TableHead>
      <TableBody>
        {activeVisitors.length === 0 ? (
          <tr>
            <Td colSpan={6} className="text-center text-slate-500">No visitors on site.</Td>
          </tr>
        ) : (
          activeVisitors.map((v) => (
            <tr key={v.id}>
              <Td>
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-slate-500">{v.badge_number}</div>
              </Td>
              <Td>{v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}</Td>
              <Td>{v.current_zone ?? 'Reception'}</Td>
              <Td className="text-xs">{v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '—'}</Td>
              <Td>{v.checked_in_at ? formatDuration(v.checked_in_at) : '—'}</Td>
              <Td>
                <Button variant="ghost" onClick={() => checkOut.mutate(v.id)}>Check out</Button>
              </Td>
            </tr>
          ))
        )}
      </TableBody>
    </TableShell>
  )
}
