import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Combobox } from '@/shared/ui/Combobox'
import { Input } from '@/shared/ui/Input'
import { DataTable } from '@/shared/ui/DataTable'
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
        <Combobox value={statusFilter} onChange={(value) => setStatusFilter(value)} className="max-w-[180px]">
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="pending_approval">Pending approval</option>
          <option value="checked_in">Checked in</option>
          <option value="checked_out">Checked out</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </Combobox>
        <Button variant="ghost" onClick={runSearch}>Search</Button>
      </div>
      <DataTable
        data={visitors}
        rowKey={(v) => v.id}
        pageSize={10}
        loading={isLoading}
        empty="No visitors found."
        columns={[
          {
            key: 'visitor',
            header: 'Visitor',
            cell: (v) => (
              <>
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-slate-500">{v.company ?? '—'}</div>
                {v.visitor_code && <div className="font-mono text-xs text-slate-600">{v.visitor_code}</div>}
              </>
            ),
          },
          {
            key: 'category',
            header: 'Category / Type',
            className: 'text-xs capitalize',
            cell: (v) => (
              <>
                {v.visitor_category?.replace(/_/g, ' ') ?? '—'}
                {v.visit_type && <div className="text-slate-500">{v.visit_type.replace(/_/g, ' ')}</div>}
              </>
            ),
          },
          {
            key: 'host',
            header: 'Host',
            cell: (v) => (v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'),
          },
          {
            key: 'window',
            header: 'Visit window',
            className: 'text-xs',
            cell: (v) => `${new Date(v.visit_start_at).toLocaleString()} – ${new Date(v.visit_end_at).toLocaleString()}`,
          },
          {
            key: 'code',
            header: 'Code / Badge',
            className: 'font-mono text-xs',
            cell: (v) => (
              <>
                {v.check_in_code ?? '—'}
                {v.badge_number && <div className="text-slate-500">{v.badge_number}</div>}
                {v.pin_code && <div className="text-slate-600">PIN: {v.pin_code}</div>}
              </>
            ),
          },
          {
            key: 'face',
            header: 'Face',
            cell: (v) => (
              <Badge tone={v.face_registered ? 'ok' : 'neutral'}>
                {v.face_registered ? 'Enrolled' : 'No face'}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (v) => <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>{v.status.replace(/_/g, ' ')}</Badge>,
          },
          {
            key: 'actions',
            header: 'Actions',
            className: 'space-x-1',
            cell: (v) => (
              <>
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
              </>
            ),
          },
        ]}
      />

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
