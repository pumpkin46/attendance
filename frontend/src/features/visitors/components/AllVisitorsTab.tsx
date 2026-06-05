import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input, Select } from '@/shared/ui/Input'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { FaceCaptureModal } from '@/shared/components/FaceCaptureModal'
import {
  useCancelVisit,
  useCheckInVisitor,
  useCheckOutVisitor,
  useEnrollVisitorFace,
  useVisitorsList,
} from '@/features/visitors/api/queries'
import { STATUS_TONE } from '@/features/visitors/types'

export function AllVisitorsTab({ onSelect }: { onSelect: (id: number) => void }) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [query, setQuery] = useState({ search: '', status: '' })
  const [enrollId, setEnrollId] = useState<number | null>(null)

  const { data: list, isLoading } = useVisitorsList(query.search, query.status)
  const visitors = list?.data ?? []
  const checkIn = useCheckInVisitor()
  const checkOut = useCheckOutVisitor()
  const cancel = useCancelVisit()
  const enrollFace = useEnrollVisitorFace()

  const runSearch = () => setQuery({ search, status: statusFilter })

  const onCancel = (id: number) => {
    if (confirm('Cancel this visit?')) cancel.mutate(id)
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search name, company, code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          className="max-w-xs"
        />
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[180px]">
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="pending_approval">Pending approval</option>
          <option value="checked_in">Checked in</option>
          <option value="checked_out">Checked out</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Button variant="ghost" onClick={runSearch}>Search</Button>
      </div>
      <TableShell>
        <TableHead>
          <Th>Visitor</Th>
          <Th>Category / Type</Th>
          <Th>Host</Th>
          <Th>Visit window</Th>
          <Th>Code / Badge</Th>
          <Th>Face</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {isLoading ? (
            <tr>
              <Td colSpan={8} className="text-center text-slate-500">Loading…</Td>
            </tr>
          ) : visitors.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-center text-slate-500">No visitors found.</Td>
            </tr>
          ) : (
            visitors.map((v) => (
              <tr key={v.id}>
                <Td>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-slate-500">{v.company ?? '—'}</div>
                  {v.visitor_code && <div className="font-mono text-xs text-slate-600">{v.visitor_code}</div>}
                </Td>
                <Td className="text-xs capitalize">
                  {v.visitor_category?.replace(/_/g, ' ') ?? '—'}
                  {v.visit_type && <div className="text-slate-500">{v.visit_type.replace(/_/g, ' ')}</div>}
                </Td>
                <Td>{v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}</Td>
                <Td className="text-xs">
                  {new Date(v.visit_start_at).toLocaleString()} – {new Date(v.visit_end_at).toLocaleString()}
                </Td>
                <Td className="font-mono text-xs">
                  {v.check_in_code ?? '—'}
                  {v.badge_number && <div className="text-slate-500">{v.badge_number}</div>}
                  {v.pin_code && <div className="text-slate-600">PIN: {v.pin_code}</div>}
                </Td>
                <Td>
                  <Badge tone={v.face_registered ? 'ok' : 'neutral'}>
                    {v.face_registered ? 'Enrolled' : 'No face'}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>{v.status.replace(/_/g, ' ')}</Badge>
                </Td>
                <Td className="space-x-1">
                  <Button variant="ghost" onClick={() => onSelect(v.id)}>View</Button>
                  {v.status === 'scheduled' && (
                    <Button variant="ghost" onClick={() => checkIn.mutate(v.id)}>Check in</Button>
                  )}
                  {v.status === 'checked_in' && (
                    <Button variant="ghost" onClick={() => checkOut.mutate(v.id)}>Check out</Button>
                  )}
                  {!v.face_registered && !['expired', 'cancelled', 'checked_out'].includes(v.status) && (
                    <Button variant="ghost" onClick={() => setEnrollId(v.id)}>Enroll face</Button>
                  )}
                  {!['cancelled', 'checked_out', 'expired'].includes(v.status) && (
                    <Button variant="ghost" onClick={() => onCancel(v.id)}>Cancel</Button>
                  )}
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>

      {enrollId !== null && (
        <FaceCaptureModal
          title="Enroll visitor face"
          description="Capture a clear, front-facing photo of the visitor."
          submitting={enrollFace.isPending}
          onClose={() => setEnrollId(null)}
          onCapture={async (image) => {
            try {
              await enrollFace.mutateAsync({ id: enrollId, image })
              setEnrollId(null)
            } catch {
              /* error toast handled globally; keep modal open to retry */
            }
          }}
        />
      )}
    </>
  )
}
