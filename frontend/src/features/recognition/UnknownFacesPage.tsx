import { useEffect, useState, type ReactNode } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { DatePicker } from '@/shared/ui/DatePicker'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SnapshotImage } from '@/shared/components/SnapshotImage'
import { DataTable } from '@/shared/ui/DataTable'
import { useUnknownFaces } from '@/features/recognition/api/queries'
import type { RecognitionEvent } from '@/shared/types'

export default function UnknownFacesPage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  const { data, isPending, isError, error } = useUnknownFaces(dateFrom, dateTo)
  const events = data?.data ?? []
  const [index, setIndex] = useState<number | null>(null)

  return (
    <div>
      <PageHeader
        title="Unknown Faces"
        description="FR-011: Flagged unrecognized persons with saved snapshots and admin alerts"
        actions={
          <>
            <DatePicker value={dateFrom} onChange={(value) => setDateFrom(value)} />
            <span className="text-slate-500">to</span>
            <DatePicker value={dateTo} onChange={(value) => setDateTo(value)} />
          </>
        }
      />

      <DataTable
        data={events}
        rowKey={(e) => e.id}
        pageSize={10}
        loading={isPending}
        error={isError ? getApiErrorMessage(error, 'Failed to load unknown face events') : undefined}
        empty="No unknown face events in this period"
        columns={[
          {
            key: 'snapshot',
            header: 'Snapshot',
            cell: (e, i) =>
              e.snapshot_path ? (
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  title="View details"
                  className="rounded-lg ring-blue-500/0 transition hover:ring-2 hover:ring-blue-500/70 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <SnapshotImage
                    eventId={e.id}
                    className="h-16 w-16 cursor-pointer rounded-lg object-cover"
                  />
                </button>
              ) : (
                <span className="text-slate-500">—</span>
              ),
          },
          { key: 'time', header: 'Time', cell: (e) => new Date(e.recognized_at).toLocaleString() },
          { key: 'camera', header: 'Camera', cell: (e) => e.camera?.name ?? '—' },
          {
            key: 'confidence',
            header: 'Confidence',
            cell: (e) =>
              e.confidence != null ? `${(Number(e.confidence) * 100).toFixed(1)}%` : '—',
          },
          {
            key: 'alert',
            header: 'Alert sent',
            cell: (e) => (
              <Badge tone={e.notified_at ? 'ok' : 'neutral'}>{e.notified_at ? 'Yes' : 'No'}</Badge>
            ),
          },
          { key: 'source', header: 'Source', cell: (e) => e.metadata?.source ?? '—' },
        ]}
      />

      {index !== null && events[index] && (
        <UnknownFaceModal
          events={events}
          index={index}
          onClose={() => setIndex(null)}
          onIndexChange={setIndex}
        />
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800 py-2 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  )
}

function UnknownFaceModal({
  events,
  index,
  onClose,
  onIndexChange,
}: {
  events: RecognitionEvent[]
  index: number
  onClose: () => void
  onIndexChange: (i: number) => void
}) {
  const event = events[index]
  const hasPrev = index > 0
  const hasNext = index < events.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < events.length - 1) onIndexChange(index + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, events.length, onClose, onIndexChange])

  const liveness =
    event.liveness_passed == null ? null : event.liveness_passed ? 'Passed' : 'Failed'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Unknown face</h2>
            <p className="mt-1 text-sm text-slate-400">
              {index + 1} of {events.length}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="overflow-hidden rounded-xl bg-black">
            {event.snapshot_path ? (
              <SnapshotImage
                eventId={event.id}
                alt="Unknown face snapshot"
                className="aspect-square w-full object-contain"
              />
            ) : (
              <div className="grid aspect-square place-items-center text-sm text-slate-500">
                No snapshot
              </div>
            )}
          </div>

          <div className="text-sm">
            <DetailRow label="Time" value={new Date(event.recognized_at).toLocaleString()} />
            <DetailRow
              label="Confidence"
              value={
                event.confidence != null
                  ? `${(Number(event.confidence) * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <DetailRow
              label="Liveness"
              value={
                liveness == null ? (
                  '—'
                ) : (
                  <Badge tone={event.liveness_passed ? 'ok' : 'danger'}>{liveness}</Badge>
                )
              }
            />
            <DetailRow label="Camera" value={event.camera?.name ?? '—'} />
            <DetailRow label="Source" value={event.metadata?.source ?? '—'} />
            <DetailRow label="Result" value={<span className="capitalize">{event.result}</span>} />
            <DetailRow
              label="Processing"
              value={event.processing_ms != null ? `${event.processing_ms} ms` : '—'}
            />
            <DetailRow
              label="Alert sent"
              value={
                <Badge tone={event.notified_at ? 'ok' : 'neutral'}>
                  {event.notified_at ? 'Yes' : 'No'}
                </Badge>
              }
            />
            <DetailRow label="Event ID" value={`#${event.id}`} />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <Button variant="ghost" disabled={!hasPrev} onClick={() => onIndexChange(index - 1)}>
            ← Previous
          </Button>
          <span className="text-xs text-slate-500">Use ← → arrow keys</span>
          <Button variant="ghost" disabled={!hasNext} onClick={() => onIndexChange(index + 1)}>
            Next →
          </Button>
        </div>
      </div>
    </div>
  )
}
