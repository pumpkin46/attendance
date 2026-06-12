import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { confirmDialog } from '@/shared/ui/dialogs'
import { SearchBox } from '@/shared/ui/SearchBox'
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
import { VisitorCell } from '@/features/visitors/components/VisitorUI'

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

  const onCancel = async (id: number) => {
    const ok = await confirmDialog({
      title: 'Cancel visit',
      message: 'Cancel this visit? The visitor will no longer be able to check in.',
      confirmLabel: 'Cancel visit',
      cancelLabel: 'Keep visit',
    })
    if (ok) cancel.mutate(id)
  }

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox
          placeholder="Search name, company, code…"
          value={search}
          onChange={setSearch}
          onSearch={runSearch}
          className="max-w-xs flex-1"
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
        <Button onClick={runSearch}>Search</Button>
      </Card>
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
              <VisitorCell name={v.name} seed={v.id} photoUrl={v.photo_url} sub={v.company ?? '—'} code={v.visitor_code} />
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
            align: 'center',
            cell: (v) => (
              <Badge tone={v.face_registered ? 'ok' : 'neutral'}>
                {v.face_registered ? 'Enrolled' : 'No face'}
              </Badge>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            align: 'center',
            cell: (v) => (
              <Badge tone={STATUS_TONE[v.status] ?? 'neutral'} className="capitalize">
                {v.status.replace(/_/g, ' ')}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (v) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => onSelect(v.id)}>View</Button>
                {v.status === 'scheduled' && (
                  <Button size="sm" variant="ghost" onClick={() => checkIn.mutate(v.id)}>Check in</Button>
                )}
                {v.status === 'checked_in' && (
                  <Button size="sm" variant="ghost" onClick={() => checkOut.mutate(v.id)}>Check out</Button>
                )}
                {!v.face_registered && !['expired', 'cancelled', 'checked_out'].includes(v.status) && (
                  <Button size="sm" variant="ghost" onClick={() => setEnrollId(v.id)}>Enroll face</Button>
                )}
                {!['cancelled', 'checked_out', 'expired'].includes(v.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => onCancel(v.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
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
