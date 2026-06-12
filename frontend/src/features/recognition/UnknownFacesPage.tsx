import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getApiErrorMessage } from '@/shared/api/client'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Combobox } from '@/shared/ui/Combobox'
import { DataTable } from '@/shared/ui/DataTable'
import { DateRangePicker } from '@/shared/ui/DateRangePicker'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Pagination } from '@/shared/ui/Pagination'
import { Skeleton } from '@/shared/ui/Skeleton'
import { StatCard } from '@/shared/ui/StatCard'
import { SnapshotImage } from '@/shared/components/SnapshotImage'
import {
  UNKNOWN_FACES_PER_PAGE,
  useEventFeedback,
  useUnknownFaces,
  useUnknownFacesSummary,
} from '@/features/recognition/api/queries'
import type { RecognitionEvent } from '@/shared/types'

type View = 'gallery' | 'table'

const isoDaysAgo = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
const fmtConfidence = (c?: number) => (c != null ? `${(Number(c) * 100).toFixed(1)}%` : '—')

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export default function UnknownFacesPage() {
  // Initial range can be deep-linked (e.g. /unknown-faces?from=...&to=... from
  // the dashboard's "Unknown today" KPI); the pickers take over from there.
  const [searchParams] = useSearchParams()
  const paramDate = (key: string) => {
    const v = searchParams.get(key)
    return v && ISO_DATE.test(v) ? v : null
  }
  const [dateFrom, setDateFrom] = useState(() => paramDate('from') ?? isoDaysAgo(7))
  const [dateTo, setDateTo] = useState(
    () => paramDate('to') ?? new Date().toISOString().slice(0, 10)
  )
  const [cameraFilter, setCameraFilter] = useState('')
  const [alertsOnly, setAlertsOnly] = useState(false)
  const [view, setView] = useState<View>('gallery')
  const [index, setIndex] = useState<number | null>(null)
  const [page, setPage] = useState(1)

  // Filter/date changes redefine the result set, so navigation restarts at page 1.
  const changeDateRange = (from: string, to: string) => {
    setDateFrom(from)
    setDateTo(to)
    setPage(1)
  }
  const changeCameraFilter = (v: string) => {
    setCameraFilter(v)
    setPage(1)
    setIndex(null)
  }
  const changeAlertsOnly = (v: boolean) => {
    setAlertsOnly(v)
    setPage(1)
    setIndex(null)
  }
  const changePage = (p: number) => {
    setPage(p)
    setIndex(null)
  }

  // Camera/alerts filters are server-side (the list is paginated — filtering
  // the current page locally would miss matches on other pages).
  const { data, isPending, isError, error } = useUnknownFaces(
    dateFrom,
    dateTo,
    page,
    cameraFilter,
    alertsOnly
  )
  const events = useMemo(() => data?.data ?? [], [data])

  // Stat cards + camera options come from range-wide server aggregates, not
  // from the rows of the current page.
  const { data: summary } = useUnknownFacesSummary(dateFrom, dateTo)
  const cameraOptions = useMemo(
    () => [
      { value: '', label: 'All cameras' },
      ...(summary?.cameras ?? []).map((c) => ({
        value: String(c.id),
        label: c.name ?? `Camera #${c.id}`,
      })),
    ],
    [summary]
  )
  const stats = {
    total: summary?.total ?? 0,
    alerts: summary?.alerts ?? 0,
    cameras: summary?.cameras.length ?? 0,
    spoof: summary?.spoof ?? 0,
  }

  const errorMsg = isError ? getApiErrorMessage(error, 'Failed to load unknown face events') : null

  return (
    <div>
      <PageHeader
        title="Unknown Faces"
        description="Review unrecognized faces captured by cameras, with snapshots and liveness results."
        actions={
          <DateRangePicker
            className="w-60"
            aria-label="Filter by date range"
            from={dateFrom}
            to={dateTo}
            onChange={({ from, to }) => changeDateRange(from, to)}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Flagged faces" value={stats.total} />
        <StatCard label="Alerts sent" value={stats.alerts} tone={stats.alerts ? 'warn' : undefined} />
        <StatCard label="Cameras involved" value={stats.cameras} />
        <StatCard
          label="Liveness failures"
          value={stats.spoof}
          tone={stats.spoof ? 'danger' : undefined}
        />
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Combobox
            className="w-52"
            value={cameraFilter}
            onChange={changeCameraFilter}
            options={cameraOptions}
          />
          <Checkbox
            checked={alertsOnly}
            onChange={(e) => changeAlertsOnly(e.target.checked)}
            label="Alerts only"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {data?.total ?? 0} {(data?.total ?? 0) === 1 ? 'result' : 'results'}
          </span>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {view === 'gallery' ? (
        <GalleryView
          events={events}
          loading={isPending}
          error={errorMsg}
          onOpen={setIndex}
        />
      ) : (
        <DataTable
          data={events}
          rowKey={(e) => e.id}
          loading={isPending}
          error={errorMsg ?? undefined}
          empty="No unknown face events match these filters"
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
                    className="rounded-lg transition hover:ring-2 hover:ring-blue-500/70 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <SnapshotImage
                      eventId={e.id}
                      className="h-14 w-14 cursor-pointer rounded-lg object-cover"
                    />
                  </button>
                ) : (
                  <span className="text-slate-500">—</span>
                ),
            },
            { key: 'time', header: 'Time', cell: (e) => fmtTime(e.recognized_at) },
            { key: 'camera', header: 'Camera', cell: (e) => e.camera?.name ?? '—' },
            { key: 'confidence', header: 'Confidence', cell: (e) => fmtConfidence(e.confidence) },
            {
              key: 'liveness',
              header: 'Liveness',
              cell: (e) =>
                e.liveness_passed == null ? (
                  <span className="text-slate-500">—</span>
                ) : (
                  <Badge tone={e.liveness_passed ? 'ok' : 'danger'}>
                    {e.liveness_passed ? 'Pass' : 'Fail'}
                  </Badge>
                ),
            },
            {
              key: 'alert',
              header: 'Alert sent',
              cell: (e) => (
                <Badge tone={e.notified_at ? 'warn' : 'neutral'}>
                  {e.notified_at ? 'Yes' : 'No'}
                </Badge>
              ),
            },
            { key: 'source', header: 'Source', cell: (e) => e.metadata?.source ?? '—' },
          ]}
        />
      )}

      {data && data.last_page > 1 && (
        <Pagination
          className="mt-4"
          page={data.current_page}
          pageCount={data.last_page}
          onPageChange={changePage}
          totalItems={data.total}
          pageSize={UNKNOWN_FACES_PER_PAGE}
        />
      )}

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

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
      {(['gallery', 'table'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
            view === v ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function GalleryView({
  events,
  loading,
  error,
  onOpen,
}: {
  events: RecognitionEvent[]
  loading: boolean
  error: string | null
  onOpen: (index: number) => void
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Card key={i} padding={false} className="overflow-hidden">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="flex items-center justify-between p-2.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-10" />
            </div>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="py-12 text-center text-rose-400">{error}</Card>
    )
  }

  if (events.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-slate-500">
          <FaceIcon />
        </span>
        <p className="text-sm font-medium text-slate-300">No unknown faces</p>
        <p className="text-xs text-slate-500">
          Nothing matched these filters. Try widening the date range.
        </p>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {events.map((e, i) => (
        <button
          key={e.id}
          type="button"
          onClick={() => onOpen(i)}
          className="group overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-left transition-colors hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <div className="relative aspect-square overflow-hidden bg-black">
            <SnapshotImage
              eventId={e.id}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute left-2 top-2 flex flex-wrap gap-1">
              {e.notified_at && <Badge tone="warn">Alerted</Badge>}
              {e.liveness_passed === false && <Badge tone="danger">Liveness</Badge>}
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2.5">
              <p className="truncate text-xs font-medium text-white">
                {new Date(e.recognized_at).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 p-2.5 text-xs">
            <span className="truncate text-slate-300">{e.camera?.name ?? 'Unknown camera'}</span>
            <span className="shrink-0 text-slate-500">{fmtConfidence(e.confidence)}</span>
          </div>
        </button>
      ))}
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

  // Ground-truth labels recorded during this review session (event id → label).
  const [labels, setLabels] = useState<Record<number, string>>({})
  const feedback = useEventFeedback()
  const recordFeedback = (outcome: 'correct' | 'incorrect') =>
    feedback.mutate(
      { eventId: event.id, outcome },
      { onSuccess: (res) => setLabels((prev) => ({ ...prev, [event.id]: res.label })) }
    )
  const label = labels[event.id]

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Unknown face</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Event #{event.id} · {index + 1} of {events.length}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-xl bg-black">
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
            {hasPrev && (
              <button
                type="button"
                onClick={() => onIndexChange(index - 1)}
                aria-label="Previous"
                className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
              >
                <ChevronIcon dir="left" />
              </button>
            )}
            {hasNext && (
              <button
                type="button"
                onClick={() => onIndexChange(index + 1)}
                aria-label="Next"
                className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
              >
                <ChevronIcon dir="right" />
              </button>
            )}
          </div>

          <div className="text-sm">
            <DetailRow label="Time" value={fmtTime(event.recognized_at)} />
            <DetailRow label="Confidence" value={fmtConfidence(event.confidence)} />
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
                <Badge tone={event.notified_at ? 'warn' : 'neutral'}>
                  {event.notified_at ? 'Yes' : 'No'}
                </Badge>
              }
            />

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-800/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Ground truth
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Is this really an unknown person? Your verdict feeds the measured
                accuracy and false-rejection metrics.
              </p>
              {label ? (
                <div className="mt-3">
                  <Badge tone={label === 'true_reject' ? 'ok' : 'danger'}>
                    Labeled: {label.replace(/_/g, ' ')}
                  </Badge>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={feedback.isPending}
                    onClick={() => recordFeedback('correct')}
                  >
                    Truly unknown
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    disabled={feedback.isPending}
                    onClick={() => recordFeedback('incorrect')}
                  >
                    Enrolled person missed
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
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

const FaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" strokeLinecap="round" />
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
    <path d="M9 15s1 1.5 3 1.5 3-1.5 3-1.5" strokeLinecap="round" />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
    <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
    <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
  </svg>
)

const ChevronIcon = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
    <polyline
      points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
