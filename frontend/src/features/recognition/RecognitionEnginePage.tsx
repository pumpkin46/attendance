import { useState, type ReactNode } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
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
  useReloadIndex,
  useRemoveStream,
  useSaveEngineConfig,
  useToggleEngine,
} from '@/features/recognition/api/queries'
import type { EngineAlert, EngineConfigDict } from '@/features/recognition/types'
import WebcamMonitor from '@/features/recognition/WebcamMonitor'

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: string
  tone?: 'ok' | 'warn' | 'danger'
}) {
  return (
    <Card>
      <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span
        className={cn(
          'mt-1 block text-2xl font-semibold text-slate-100',
          tone === 'ok' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'danger' && 'text-red-400'
        )}
      >
        {value}
      </span>
      {sub && <span className="mt-1 block text-xs text-slate-500">{sub}</span>}
    </Card>
  )
}

function InfoCard({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-slate-100">{title}</h2>
      <dl className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <dt className="text-slate-400">{label}</dt>
            <dd className="font-medium text-slate-200">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function StatusPill({ running }: { running: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium',
        running ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', running ? 'bg-emerald-400' : 'bg-slate-500')} />
      {running ? 'Running' : 'Stopped'}
    </span>
  )
}

export default function RecognitionEnginePage() {
  useEngineLiveFeed() // live status + streams over WebSocket (replaces 5s polling)
  const { data: status, isPending: loading, error: queryError } = useEngineStatus()
  const toggleEngine = useToggleEngine()
  const { data: streamsData } = useEngineStreams()
  const { data: engineConfig } = useEngineConfig()
  const streams = Object.values(streamsData?.streams ?? {})
  const invalidateEngine = useInvalidateEngine()

  const [streamForm, setStreamForm] = useState({ camera_id: '', stream_url: '', protocol: 'rtsp' })

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
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
      </div>
    )
  }

  const metrics = status?.metrics?.recognition_metrics
  const pipeline = status?.metrics?.pipeline_performance
  const sla = status?.sla_compliance
  const running = status?.running ?? false

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Recognition Engine"
        description="Real-time face detection, tracking, identification, and attendance generation."
        actions={
          <>
            <StatusPill running={running} />
            {running ? (
              <Button variant="danger" disabled={actionLoading} onClick={() => toggleEngine.mutate('stop')}>
                Stop engine
              </Button>
            ) : (
              <Button disabled={actionLoading} onClick={() => toggleEngine.mutate('start')}>
                Start engine
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Metric label="Detections" value={metrics?.total_detections ?? 0} />
        <Metric
          label="Recognized"
          value={metrics?.total_recognized ?? 0}
          sub={`${((metrics?.recognition_rate ?? 0) * 100).toFixed(1)}% rate`}
          tone="ok"
        />
        <Metric
          label="Unknown"
          value={metrics?.total_unknown ?? 0}
          sub={`${((metrics?.unknown_rate ?? 0) * 100).toFixed(1)}% rate`}
          tone="warn"
        />
        <Metric label="Liveness pass" value={metrics?.total_liveness_passed ?? 0} />
        <Metric label="Quality rejected" value={metrics?.total_quality_rejected ?? 0} />
        <Metric label="Attendance events" value={status?.attendance?.total_events_generated ?? 0} />
      </div>

      {/* Local webcam monitor */}
      <WebcamMonitor />

      {/* Pipeline & SLA */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-100">Pipeline performance</h2>
          <div className="space-y-3">
            {pipeline?.stage_averages_ms &&
              Object.entries(pipeline.stage_averages_ms).map(([stage, ms]) => (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-40 truncate text-sm capitalize text-slate-300">
                    {stage.replace(/_/g, ' ')}
                  </span>
                  <div className="h-2 flex-1 rounded-full bg-slate-800">
                    <div
                      className="h-2 rounded-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min(100, ms)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-xs text-slate-400">
                    {ms.toFixed(1)}ms
                  </span>
                </div>
              ))}
            {pipeline && (
              <div className="flex justify-between border-t border-slate-800 pt-3">
                <span className="text-sm font-medium text-slate-200">Total pipeline</span>
                <span className="font-mono text-sm font-semibold text-slate-100">
                  {pipeline.total_pipeline_avg_ms.toFixed(1)}ms
                </span>
              </div>
            )}
            {!pipeline && <p className="text-sm text-slate-500">No pipeline data yet.</p>}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-100">SLA compliance</h2>
          {sla ? (
            <div>
              {Object.entries(sla).map(([key, item]) => (
                <div
                  key={key}
                  className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0"
                >
                  <span className="text-sm capitalize text-slate-300">{key.replace(/_/g, ' ')}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-slate-400">
                      {item.actual_ms.toFixed(1)} / {item.target_ms} ms
                    </span>
                    <Badge tone={item.met ? 'ok' : 'danger'}>{item.met ? 'Met' : 'Missed'}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No SLA data yet.</p>
          )}
        </Card>
      </div>

      {/* Streams / tracking / index */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <InfoCard
          title="Camera streams"
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
          rows={[
            ['Active tracks', status?.tracking?.total_tracks ?? 0],
            ['Recognized', status?.tracking?.recognized_tracks ?? 0],
            ['Unknown', status?.tracking?.unknown_tracks ?? 0],
          ]}
        />
        <InfoCard
          title="Vector index"
          rows={[
            ['Embeddings', status?.search_index?.total_embeddings ?? 0],
            ['Employees', status?.search_index?.total_employees ?? 0],
            ['Duplicates prevented', status?.attendance?.duplicates_prevented ?? 0],
          ]}
        />
      </div>

      {/* Alerts */}
      {status?.metrics?.alerts?.recent && status.metrics.alerts.recent.length > 0 && (
        <Card>
          <h2 className="mb-4 text-base font-semibold text-slate-100">Recent alerts</h2>
          <div className="space-y-2">
            {status.metrics.alerts.recent.map((alert: EngineAlert, i: number) => (
              <div key={i} className="flex items-center gap-3 rounded-lg bg-slate-800/50 p-2">
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
      )}

      {/* Stream management */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Manage streams</h2>
          <Button variant="ghost" disabled={reloadIndex.isPending} onClick={() => reloadIndex.mutate()}>
            Reload index
          </Button>
        </div>
        <form
          className="mb-4 grid items-end gap-3 sm:grid-cols-4"
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
          <Label className="sm:col-span-2">
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
          <div className="sm:col-span-4">
            <Button type="submit" disabled={addStream.isPending}>
              Add stream
            </Button>
          </div>
        </form>
        <DataTable
          data={streams}
          rowKey={(s) => s.camera_id}
          empty="No streams registered"
          columns={[
            { key: 'camera', header: 'Camera', cell: (s) => `#${s.camera_id}` },
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
              header: 'Actions',
              cell: (s) => (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={controlStream.isPending}
                    onClick={() => controlStream.mutate({ action: 'start', camera_id: s.camera_id })}
                  >
                    Start
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={controlStream.isPending}
                    onClick={() => controlStream.mutate({ action: 'stop', camera_id: s.camera_id })}
                  >
                    Stop
                  </Button>
                  <Button
                    variant="danger"
                    disabled={removeStream.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove stream #${s.camera_id}?`)) removeStream.mutate(s.camera_id)
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* Runtime configuration */}
      {engineConfig && <EngineConfigForm initial={engineConfig} onSaved={invalidateEngine} />}
    </div>
  )
}

function EngineConfigForm({
  initial,
  onSaved,
}: {
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
      { onSuccess: onSaved }
    )

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold text-slate-100">Runtime configuration</h2>
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
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
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={save.isPending}>
            Save configuration
          </Button>
        </div>
      </form>
    </Card>
  )
}
