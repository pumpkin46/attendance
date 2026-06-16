import { useState, type ReactNode } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { confirmDialog } from '@/shared/ui/dialogs'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Loading } from '@/shared/ui/Loading'
import { SidePanel } from '@/shared/ui/SidePanel'
import { CameraSelect } from '@/features/cameras/components/CameraSelect'
import { DataTable } from '@/shared/ui/DataTable'
import { cn } from '@/shared/lib/cn'
import {
  useAddStream,
  useControlStream,
  useEngineConfig,
  useEngineLiveFeed,
  useEngineStatus,
  useEngineStreams,
  useInvalidateEngine,
  usePerformanceCompliance,
  useReloadIndex,
  useRemoveStream,
  useSaveEngineConfig,
  useToggleEngine,
} from '@/features/recognition/api/queries'
import type {
  EngineAlert,
  EngineConfigDict,
  RequirementCompliance,
} from '@/features/recognition/types'
import WebcamMonitor from '@/features/recognition/WebcamMonitor'

/* ------------------------------------------------------------------ *
 * Icons (local, not exported)
 * ------------------------------------------------------------------ */
const ico = 'h-4 w-4'
const ScanIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="11" r="3" />
  </svg>
)
const UserCheckIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5 1 0 2 .2 2.8.6M16 18l2 2 4-4" />
  </svg>
)
const UserQuestionIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5M16.5 13.5a2 2 0 0 1 3.5 1.3c0 1.3-1.7 1.7-1.7 2.7M18.3 20h.01" />
  </svg>
)
const EyeIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="2.5" />
  </svg>
)
const FilterIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />
  </svg>
)
const ClipboardCheckIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="3" width="8" height="4" rx="1" /><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3M9 14l2 2 4-4" />
  </svg>
)
const CameraIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" /><circle cx="12" cy="12.5" r="3.2" />
  </svg>
)
const TrackIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
)
const DatabaseIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
)
const ChipIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </svg>
)
const BoltIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </svg>
)

/* ------------------------------------------------------------------ *
 * Presentational helpers (local)
 * ------------------------------------------------------------------ */

type Tone = 'ok' | 'warn' | 'danger' | 'accent'

const toneText: Record<Tone, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
  accent: 'text-blue-400',
}
const toneChip: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-red-500/15 text-red-400',
  accent: 'bg-blue-500/15 text-blue-400',
}
const toneAccent: Record<Tone, string> = {
  ok: 'border-l-emerald-500',
  warn: 'border-l-amber-500',
  danger: 'border-l-red-500',
  accent: 'border-l-blue-500',
}

/** "2d 4h" / "3h 24m" / "12m" / "45s" — engine session uptime. */
function fmtUptime(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(seconds)}s`
}

function Metric({
  label,
  value,
  sub,
  tone = 'accent',
  icon,
}: {
  label: string
  value: ReactNode
  sub?: string
  tone?: Tone
  icon?: ReactNode
}) {
  return (
    <Card className={cn('flex flex-col gap-2 border-l-4', toneAccent[tone])}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
        {icon && (
          <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg', toneChip[tone])}>
            {icon}
          </span>
        )}
      </div>
      <span className="text-2xl font-semibold leading-none text-slate-100">{value}</span>
      {sub && <span className={cn('text-xs', toneText[tone])}>{sub}</span>}
    </Card>
  )
}

function HeroStat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function InfoCard({
  title,
  icon,
  healthy,
  rows,
}: {
  title: string
  icon?: ReactNode
  /** Colors the title dot: true = emerald, false = slate (idle). */
  healthy?: boolean
  rows: [string, ReactNode][]
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-400">{icon}</span>}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <span
          className={cn(
            'ml-auto h-2 w-2 rounded-full',
            healthy ? 'bg-emerald-400' : 'bg-slate-600'
          )}
        />
      </div>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <dt className="text-slate-400">{label}</dt>
            <dd className="font-mono font-medium text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

/** Rates render as percentages; *_ms metrics render as milliseconds. */
function fmtComplianceValue(req: RequirementCompliance): string {
  if (req.measured == null) return '—'
  return req.metric.endsWith('_ms')
    ? `${req.measured.toFixed(1)} ms`
    : `${(req.measured * 100).toFixed(2)}%`
}

function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Pipeline flow
 * ------------------------------------------------------------------ */

/** Canonical stage order + labels/icons; unknown stages append at the end. */
const STAGE_META: Record<string, { label: string; icon: ReactNode }> = {
  face_detection: { label: 'Face detection', icon: ScanIcon },
  face_tracking: { label: 'Tracking', icon: TrackIcon },
  quality_assessment: { label: 'Quality gate', icon: FilterIcon },
  liveness_detection: { label: 'Liveness', icon: EyeIcon },
  embedding_generation: { label: 'Embedding', icon: ChipIcon },
  vector_search: { label: 'Vector search', icon: DatabaseIcon },
  identity_verification: { label: 'Identity check', icon: UserCheckIcon },
  event_creation: { label: 'Attendance', icon: ClipboardCheckIcon },
}
const STAGE_ORDER = Object.keys(STAGE_META)

function orderedStages(averages: Record<string, number>): [string, number][] {
  const known = STAGE_ORDER.filter((k) => k in averages).map(
    (k) => [k, averages[k]] as [string, number]
  )
  const extra = Object.entries(averages).filter(([k]) => !(k in STAGE_META))
  return [...known, ...extra]
}

function PipelineStage({
  index,
  stage,
  ms,
  maxMs,
  slowest,
}: {
  index: number
  stage: string
  ms: number
  maxMs: number
  slowest: boolean
}) {
  const meta = STAGE_META[stage]
  return (
    <div
      className={cn(
        'rounded-xl border bg-slate-900 p-3',
        slowest ? 'border-amber-500/40' : 'border-slate-800'
      )}
      title={slowest ? 'Slowest stage in the pipeline' : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold text-slate-600">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className={cn('shrink-0', slowest ? 'text-amber-400' : 'text-slate-500')}>
          {meta?.icon ?? BoltIcon}
        </span>
      </div>
      <div className="mt-2 truncate text-xs font-medium text-slate-300">
        {meta?.label ?? stage.replace(/_/g, ' ')}
      </div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-100">
        {ms.toFixed(1)}
        <span className="ml-0.5 text-[10px] font-normal text-slate-500">ms</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={cn('h-full rounded-full', slowest ? 'bg-amber-500' : 'bg-blue-500')}
          style={{ width: `${Math.max(6, (ms / maxMs) * 100)}%` }}
        />
      </div>
    </div>
  )
}

export default function RecognitionEnginePage() {
  useEngineLiveFeed() // live status + streams over WebSocket (replaces 5s polling)
  const { data: status, isPending: loading, error: queryError } = useEngineStatus()
  const toggleEngine = useToggleEngine()
  const { data: streamsData } = useEngineStreams()
  const { data: engineConfig } = useEngineConfig()
  const { data: compliance } = usePerformanceCompliance()
  const streams = Object.values(streamsData?.streams ?? {})
  const invalidateEngine = useInvalidateEngine()

  const [streamForm, setStreamForm] = useState({ camera_id: '', stream_url: '', protocol: 'rtsp' })
  const [streamsPanelOpen, setStreamsPanelOpen] = useState(false)
  const [configPanelOpen, setConfigPanelOpen] = useState(false)

  const addStream = useAddStream()
  const controlStream = useControlStream()
  const removeStream = useRemoveStream()
  const reloadIndex = useReloadIndex()

  const error = toggleEngine.error
    ? getApiErrorMessage(toggleEngine.error)
    : queryError
      ? getApiErrorMessage(queryError, 'Failed to fetch engine status')
      : null
  const actionLoading = toggleEngine.isPending

  if (loading) {
    return <Loading label="Loading engine status…" />
  }

  const metrics = status?.metrics?.recognition_metrics
  const pipeline = status?.metrics?.pipeline_performance
  const sla = status?.sla_compliance
  const running = status?.running ?? false
  const uptime = running ? fmtUptime(status?.metrics?.uptime_seconds) : null

  // Recognition outcome breakdown for the status hero bar.
  const recognized = metrics?.total_recognized ?? 0
  const unknown = metrics?.total_unknown ?? 0
  const qualityRejected = metrics?.total_quality_rejected ?? 0
  const breakdownTotal = recognized + unknown + qualityRejected

  // Normalise pipeline bars against the slowest stage (more meaningful than raw ms-as-%).
  const stageEntries = pipeline?.stage_averages_ms ? orderedStages(pipeline.stage_averages_ms) : []
  const maxStageMs = Math.max(...stageEntries.map(([, ms]) => ms), 0.0001)

  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Recognition Engine"
        description="Real-time face detection, tracking, identification, and attendance generation."
      />

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Command center — status, controls and headline figures */}
      <Card
        className={cn(
          'relative overflow-hidden border-l-4',
          running ? 'border-l-emerald-500' : 'border-l-slate-600'
        )}
      >
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-r to-transparent',
            running ? 'from-emerald-500/[0.06] via-transparent' : 'from-slate-500/[0.05] via-transparent'
          )}
        />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="relative flex h-4 w-4">
                {running && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                )}
                <span className={cn('relative inline-flex h-4 w-4 rounded-full', running ? 'bg-emerald-500' : 'bg-slate-500')} />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-lg font-semibold text-slate-100">
                    {running ? 'Engine operational' : 'Engine stopped'}
                  </span>
                  {uptime && (
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 font-mono text-xs text-slate-300">
                      up {uptime}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-400">
                  {running
                    ? 'Processing camera streams and generating attendance in real time.'
                    : 'Start the engine to begin real-time recognition and attendance.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setStreamsPanelOpen(true)}>
                Manage streams
              </Button>
              <Button variant="ghost" onClick={() => setConfigPanelOpen(true)}>
                Configuration
              </Button>
              {running ? (
                <Button size="lg" variant="danger" isLoading={actionLoading} onClick={() => toggleEngine.mutate('stop')}>
                  Stop engine
                </Button>
              ) : (
                <Button size="lg" isLoading={actionLoading} onClick={() => toggleEngine.mutate('start')}>
                  Start engine
                </Button>
              )}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-800 pt-4 sm:grid-cols-4">
            <HeroStat
              label="Active streams"
              value={`${status?.streams?.active_streams ?? 0} / ${status?.streams?.total_streams ?? 0}`}
            />
            <HeroStat
              label="Embeddings indexed"
              value={(status?.search_index?.total_embeddings ?? 0).toLocaleString()}
              sub={`${status?.search_index?.total_employees ?? 0} employees`}
            />
            <HeroStat
              label="Attendance events"
              value={(status?.attendance?.total_events_generated ?? 0).toLocaleString()}
              sub={`${status?.attendance?.duplicates_prevented ?? 0} duplicates prevented`}
            />
            <HeroStat
              label="Camera health"
              value={
                status?.metrics?.camera_health?.avg_fps
                  ? `${status.metrics.camera_health.avg_fps.toFixed(1)} fps`
                  : '—'
              }
              sub={
                status?.metrics?.camera_health?.avg_latency_ms != null
                  ? `${status.metrics.camera_health.avg_latency_ms.toFixed(0)} ms latency`
                  : undefined
              }
            />
          </div>

          {breakdownTotal > 0 && (
            <div className="mt-5">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="bg-emerald-500" style={{ width: `${(recognized / breakdownTotal) * 100}%` }} />
                <div className="bg-amber-500" style={{ width: `${(unknown / breakdownTotal) * 100}%` }} />
                <div className="bg-slate-500" style={{ width: `${(qualityRejected / breakdownTotal) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Recognized {recognized.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" />Unknown {unknown.toLocaleString()}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-500" />Quality rejected {qualityRejected.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Recognition pipeline — the engine's processing flow, stage by stage */}
      <section>
        <SectionHeading
          title="Recognition pipeline"
          description="Average processing time per stage; the slowest stage is highlighted"
          action={
            pipeline && stageEntries.length > 0 && (
              <span className="rounded-full bg-slate-800 px-3 py-1 font-mono text-xs text-slate-200">
                end-to-end {pipeline.total_pipeline_avg_ms.toFixed(1)} ms
              </span>
            )
          }
        />
        {stageEntries.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
            {stageEntries.map(([stage, ms], i) => (
              <PipelineStage
                key={stage}
                index={i}
                stage={stage}
                ms={ms}
                maxMs={maxStageMs}
                slowest={stageEntries.length > 1 && ms === maxStageMs}
              />
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-sm text-slate-500">
              No pipeline timings yet — stages report their averages once frames start flowing.
            </p>
          </Card>
        )}
      </section>

      {/* Live metrics */}
      <section>
        <SectionHeading title="Live metrics" description="Accumulated since the engine last started" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
          <Metric label="Detections" value={(metrics?.total_detections ?? 0).toLocaleString()} icon={ScanIcon} />
          <Metric
            label="Recognized"
            value={(metrics?.total_recognized ?? 0).toLocaleString()}
            sub={`${((metrics?.recognition_rate ?? 0) * 100).toFixed(1)}% rate`}
            tone="ok"
            icon={UserCheckIcon}
          />
          <Metric
            label="Unknown"
            value={(metrics?.total_unknown ?? 0).toLocaleString()}
            sub={`${((metrics?.unknown_rate ?? 0) * 100).toFixed(1)}% rate`}
            tone="warn"
            icon={UserQuestionIcon}
          />
          <Metric label="Liveness pass" value={(metrics?.total_liveness_passed ?? 0).toLocaleString()} tone="ok" icon={EyeIcon} />
          <Metric label="Quality rejected" value={(metrics?.total_quality_rejected ?? 0).toLocaleString()} tone="warn" icon={FilterIcon} />
          <Metric label="Attendance events" value={(status?.attendance?.total_events_generated ?? 0).toLocaleString()} icon={ClipboardCheckIcon} />
        </div>
      </section>

      {/* Live detection monitor (self-contained card) */}
      <section>
        <SectionHeading
          title="Live AI detection"
          description="Watch a registered camera with real-time face boxes and identities, or spot-check a local webcam"
        />
        <WebcamMonitor />
      </section>

      {/* Performance */}
      <section>
        <SectionHeading title="Performance" description="Latency SLAs and required accuracy targets" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <h3 className="mb-4 text-sm font-semibold text-slate-100">Latency SLAs</h3>
            {sla && Object.keys(sla).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(sla).map(([key, item]) => {
                  const ratio = item.target_ms ? Math.min(1, item.actual_ms / item.target_ms) : 0
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="capitalize text-slate-300">{key.replace(/_/g, ' ')}</span>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs tabular-nums text-slate-400">
                            {item.actual_ms.toFixed(1)} / {item.target_ms} ms
                          </span>
                          <Badge tone={item.met ? 'ok' : 'danger'}>{item.met ? 'Met' : 'Missed'}</Badge>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={cn('h-full rounded-full transition-all', item.met ? 'bg-emerald-500' : 'bg-red-500')}
                          style={{ width: `${ratio * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No SLA data yet.</p>
            )}
          </Card>

          <Card padding={false} className="overflow-hidden xl:col-span-3">
            <div className="border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-100">Required performance metrics</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {compliance && compliance.labeled_samples > 0
                  ? `Accuracy measured from ${compliance.labeled_samples} ground-truth-labeled sample(s); latency from live pipeline timings.`
                  : 'Accuracy targets need ground truth — label recognition events in the Unknown Faces review.'}
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-semibold">Metric</th>
                  <th className="px-4 py-3 font-semibold">Requirement</th>
                  <th className="px-4 py-3 text-right font-semibold">Measured</th>
                  <th className="px-4 py-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {(compliance?.requirements ?? []).map((req) => (
                  <tr key={req.metric} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3 capitalize text-slate-200">
                      {req.metric.replace(/_/g, ' ').replace(/ ms$/, '')}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400">{req.requirement}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-200">
                      {fmtComplianceValue(req)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {req.met == null ? (
                        <Badge tone="neutral">No data</Badge>
                      ) : (
                        <Badge tone={req.met ? 'ok' : 'danger'}>{req.met ? 'Met' : 'Missed'}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {(compliance?.requirements ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      No compliance data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      </section>

      {/* Infrastructure */}
      <section>
        <SectionHeading title="Infrastructure" description="Streams, tracking, and the vector index" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <InfoCard
            title="Camera streams"
            icon={CameraIcon}
            healthy={(status?.streams?.active_streams ?? 0) > 0}
            rows={[
              ['Active', status?.streams?.active_streams ?? 0],
              ['Total', status?.streams?.total_streams ?? 0],
              ['Avg FPS', status?.metrics?.camera_health?.avg_fps?.toFixed(1) ?? '—'],
              [
                'Avg latency',
                status?.metrics?.camera_health?.avg_latency_ms != null
                  ? `${status.metrics.camera_health.avg_latency_ms.toFixed(0)}ms`
                  : '—',
              ],
            ]}
          />
          <InfoCard
            title="Face tracking"
            icon={TrackIcon}
            healthy={(status?.tracking?.total_tracks ?? 0) > 0}
            rows={[
              ['Active tracks', status?.tracking?.total_tracks ?? 0],
              ['Recognized', status?.tracking?.recognized_tracks ?? 0],
              ['Unknown', status?.tracking?.unknown_tracks ?? 0],
            ]}
          />
          <InfoCard
            title="Vector index"
            icon={DatabaseIcon}
            healthy={(status?.search_index?.total_embeddings ?? 0) > 0}
            rows={[
              ['Embeddings', (status?.search_index?.total_embeddings ?? 0).toLocaleString()],
              ['Employees', status?.search_index?.total_employees ?? 0],
              ['Duplicates prevented', status?.attendance?.duplicates_prevented ?? 0],
            ]}
          />
        </div>
      </section>

      {/* Alerts */}
      {status?.metrics?.alerts?.recent && status.metrics.alerts.recent.length > 0 && (
        <section>
          <SectionHeading title="Recent alerts" />
          <Card>
            <div className="space-y-2">
              {status.metrics.alerts.recent.map((alert: EngineAlert, i: number) => (
                <div key={i} className="flex items-center gap-3 rounded-lg bg-slate-800/50 p-2.5">
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      alert.severity === 'critical'
                        ? 'bg-red-500'
                        : alert.severity === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-blue-500'
                    )}
                  />
                  <span className="flex-1 text-sm text-slate-200">{alert.message}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* Stream management (slide-over) */}
      <SidePanel
        open={streamsPanelOpen}
        title="Manage streams"
        description="Register RTSP / USB sources for server-side recognition"
        onClose={() => setStreamsPanelOpen(false)}
        footer={
          <>
            <Button type="submit" form="add-stream-form" isLoading={addStream.isPending}>
              Add stream
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={reloadIndex.isPending}
              onClick={() => reloadIndex.mutate()}
            >
              Reload index
            </Button>
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => setStreamsPanelOpen(false)}>
              Close
            </Button>
          </>
        }
      >
        <form
          id="add-stream-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (streamForm.camera_id && streamForm.stream_url)
              addStream.mutate(streamForm, {
                onSuccess: () => setStreamForm({ camera_id: '', stream_url: '', protocol: 'rtsp' }),
              })
          }}
        >
          <Label>
            Camera
            <CameraSelect
              value={streamForm.camera_id}
              onChange={(camera_id) => setStreamForm({ ...streamForm, camera_id })}
              onCameraChange={(camera) =>
                camera?.stream_url &&
                setStreamForm((prev) => ({ ...prev, stream_url: camera.stream_url ?? prev.stream_url }))
              }
              required
            />
          </Label>
          <Label>
            {streamForm.protocol === 'usb' ? 'Device index' : 'Stream URL'}
            <Input
              value={streamForm.stream_url}
              onChange={(e) => setStreamForm({ ...streamForm, stream_url: e.target.value })}
              placeholder={
                streamForm.protocol === 'usb'
                  ? '0  (first USB camera on the server, 1 = next…)'
                  : 'rtsp://user:pass@host:554/stream'
              }
              required
            />
          </Label>
          <Label>
            Protocol
            <Combobox
              value={streamForm.protocol}
              onChange={(value) => setStreamForm({ ...streamForm, protocol: value })}
            >
              <option value="rtsp">RTSP</option>
              <option value="http">HTTP</option>
              <option value="webrtc">WebRTC</option>
              <option value="usb">USB / Webcam</option>
            </Combobox>
          </Label>
        </form>

        <div className="mt-6 border-t border-slate-800 pt-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Registered streams
          </h3>
          <DataTable
            data={streams}
            rowKey={(s) => s.camera_id}
            empty="No streams registered"
            columns={[
              { key: 'camera', header: 'Camera', cell: (s) => <span className="font-mono text-slate-300">#{s.camera_id}</span> },
              {
                key: 'status',
                header: 'Status',
                cell: (s) => (
                  <Badge
                    tone={
                      s.status === 'streaming' || s.status === 'active'
                        ? 'ok'
                        : s.status === 'error'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {s.status}
                  </Badge>
                ),
              },
              { key: 'fps', header: 'FPS', cell: (s) => s.health?.fps ?? '—' },
              {
                key: 'latency',
                header: 'Latency',
                cell: (s) => (s.health?.latency_ms != null ? `${s.health.latency_ms}ms` : '—'),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                cell: (s) => (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={controlStream.isPending}
                      onClick={() => controlStream.mutate({ action: 'start', camera_id: s.camera_id })}
                    >
                      Start
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={controlStream.isPending}
                      onClick={() => controlStream.mutate({ action: 'stop', camera_id: s.camera_id })}
                    >
                      Stop
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      disabled={removeStream.isPending}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: 'Remove stream',
                          message: `Remove stream #${s.camera_id}? Recognition will stop for this camera.`,
                          confirmLabel: 'Remove',
                        })
                        if (ok) removeStream.mutate(s.camera_id)
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </SidePanel>

      {/* Runtime configuration (slide-over) */}
      {engineConfig && (
        <EngineConfigPanel
          open={configPanelOpen}
          onClose={() => setConfigPanelOpen(false)}
          initial={engineConfig}
          onSaved={invalidateEngine}
        />
      )}
    </div>
  )
}

function EngineConfigPanel({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  initial: EngineConfigDict
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    recognition_threshold: String(initial.search?.auto_accept_threshold ?? 0.9),
    liveness_min_score: String(initial.liveness?.min_score ?? 0.85),
    liveness_enabled: initial.liveness?.enabled ?? true,
    duplicate_window_seconds: String(initial.attendance?.duplicate_window_seconds ?? 300),
    unknown_person_enabled: initial.unknown_person?.enabled ?? true,
    max_faces_per_frame: String(initial.detection?.max_faces_per_frame ?? 10),
  })

  const save = useSaveEngineConfig()

  const submit = () =>
    save.mutate(
      {
        recognition_threshold: Number(form.recognition_threshold),
        liveness_min_score: Number(form.liveness_min_score),
        liveness_enabled: form.liveness_enabled,
        duplicate_window_seconds: Number(form.duplicate_window_seconds),
        unknown_person_enabled: form.unknown_person_enabled,
        max_faces_per_frame: Number(form.max_faces_per_frame),
      },
      {
        onSuccess: () => {
          onSaved()
          onClose()
        },
      }
    )

  return (
    <SidePanel
      open={open}
      title="Runtime configuration"
      description="Tune thresholds and safeguards without restarting"
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form="engine-config-form" isLoading={save.isPending}>
            Save configuration
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id="engine-config-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Label>
            Recognition threshold
            <Input
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={form.recognition_threshold}
              onChange={(e) => setForm({ ...form, recognition_threshold: e.target.value })}
            />
          </Label>
          <Label>
            Liveness min score
            <Input
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={form.liveness_min_score}
              onChange={(e) => setForm({ ...form, liveness_min_score: e.target.value })}
            />
          </Label>
          <Label>
            Duplicate window (s)
            <Input
              type="number"
              min={0}
              value={form.duplicate_window_seconds}
              onChange={(e) => setForm({ ...form, duplicate_window_seconds: e.target.value })}
            />
          </Label>
          <Label>
            Max faces / frame
            <Input
              type="number"
              min={1}
              value={form.max_faces_per_frame}
              onChange={(e) => setForm({ ...form, max_faces_per_frame: e.target.value })}
            />
          </Label>
        </div>

        <div className="mt-4 flex flex-wrap gap-6 border-t border-slate-800 pt-4">
          <Checkbox
            checked={form.liveness_enabled}
            onChange={(e) => setForm({ ...form, liveness_enabled: e.target.checked })}
            label="Liveness enabled"
          />
          <Checkbox
            checked={form.unknown_person_enabled}
            onChange={(e) => setForm({ ...form, unknown_person_enabled: e.target.checked })}
            label="Unknown-person alerts"
          />
        </div>
      </form>
    </SidePanel>
  )
}
