import { useState } from 'react'
import { getApiErrorMessage } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
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

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

function SlaIndicator({ name, target, actual, met }: { name: string; target: number; actual: number; met: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-300">{name}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono">{actual.toFixed(1)}ms / {target}ms</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${met ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
          {met ? '✓ Met' : '✗ Missed'}
        </span>
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
  const handleStart = () => toggleEngine.mutate('start')
  const handleStop = () => toggleEngine.mutate('stop')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const metrics = status?.metrics?.recognition_metrics
  const pipeline = status?.metrics?.pipeline_performance
  const sla = status?.sla_compliance

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Recognition Engine</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real-time face detection, tracking, identification, and attendance generation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${status?.running ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
            {status?.running ? '● Running' : '○ Stopped'}
          </span>
          {status?.running ? (
            <button onClick={handleStop} disabled={actionLoading} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
              Stop Engine
            </button>
          ) : (
            <button onClick={handleStart} disabled={actionLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              Start Engine
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard label="Detections" value={metrics?.total_detections ?? 0} />
        <StatCard label="Recognized" value={metrics?.total_recognized ?? 0} sub={`${((metrics?.recognition_rate ?? 0) * 100).toFixed(1)}% rate`} />
        <StatCard label="Unknown" value={metrics?.total_unknown ?? 0} sub={`${((metrics?.unknown_rate ?? 0) * 100).toFixed(1)}% rate`} />
        <StatCard label="Liveness Pass" value={metrics?.total_liveness_passed ?? 0} />
        <StatCard label="Quality Rejected" value={metrics?.total_quality_rejected ?? 0} />
        <StatCard label="Attendance Events" value={status?.attendance?.total_events_generated ?? 0} />
      </div>

      {/* Local webcam monitor */}
      <WebcamMonitor />

      {/* Pipeline & Streams */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Performance */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Pipeline Performance</h2>
          <div className="space-y-3">
            {pipeline?.stage_averages_ms && Object.entries(pipeline.stage_averages_ms).map(([stage, ms]) => (
              <div key={stage} className="flex items-center gap-3">
                <span className="text-sm text-gray-600 dark:text-gray-300 w-40 truncate">{stage.replace(/_/g, ' ')}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (ms / 100) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-gray-500 w-16 text-right">{ms.toFixed(1)}ms</span>
              </div>
            ))}
            {pipeline && (
              <div className="pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Total Pipeline</span>
                <span className="text-sm font-mono font-bold">{pipeline.total_pipeline_avg_ms.toFixed(1)}ms</span>
              </div>
            )}
          </div>
        </div>

        {/* SLA Compliance */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">SLA Compliance</h2>
          <div>
            {sla && Object.entries(sla).map(([key, item]) => (
              <SlaIndicator
                key={key}
                name={key.replace(/_/g, ' ')}
                target={item.target_ms}
                actual={item.actual_ms}
                met={item.met}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Streams & Tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Camera Streams</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Active</span>
              <span className="font-medium">{status?.streams?.active_streams ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-medium">{status?.streams?.total_streams ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Avg FPS</span>
              <span className="font-medium">{status?.metrics?.camera_health?.avg_fps?.toFixed(1) ?? '-'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Avg Latency</span>
              <span className="font-medium">{status?.metrics?.camera_health?.avg_latency_ms?.toFixed(0) ?? '-'}ms</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Face Tracking</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Active Tracks</span>
              <span className="font-medium">{status?.tracking?.total_tracks ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Recognized</span>
              <span className="font-medium">{status?.tracking?.recognized_tracks ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Unknown</span>
              <span className="font-medium">{status?.tracking?.unknown_tracks ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Vector Index</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Embeddings</span>
              <span className="font-medium">{status?.search_index?.total_embeddings ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Employees</span>
              <span className="font-medium">{status?.search_index?.total_employees ?? 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Duplicates Prevented</span>
              <span className="font-medium">{status?.attendance?.duplicates_prevented ?? 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {status?.metrics?.alerts?.recent && status.metrics.alerts.recent.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Alerts</h2>
          <div className="space-y-2">
            {status.metrics.alerts.recent.map((alert: EngineAlert, i: number) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                <span className={`w-2 h-2 rounded-full ${alert.severity === 'critical' ? 'bg-red-500' : alert.severity === 'warning' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
                <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">{alert.message}</span>
                <span className="text-xs text-gray-400">{new Date(alert.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stream Management */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">Camera streams</h2>
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
            Camera ID
            <Input
              type="number"
              value={streamForm.camera_id}
              onChange={(e) => setStreamForm({ ...streamForm, camera_id: e.target.value })}
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
            <Select
              value={streamForm.protocol}
              onChange={(e) => setStreamForm({ ...streamForm, protocol: e.target.value })}
            >
              <option value="rtsp">RTSP</option>
              <option value="http">HTTP</option>
              <option value="webrtc">WebRTC</option>
              <option value="usb">USB / Webcam</option>
            </Select>
          </Label>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={addStream.isPending}>
              Add stream
            </Button>
          </div>
        </form>
        <TableShell>
          <TableHead>
            <Th>Camera</Th>
            <Th>Status</Th>
            <Th>FPS</Th>
            <Th>Latency</Th>
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {streams.length === 0 ? (
              <tr>
                <Td colSpan={5} className="text-slate-400">
                  No streams registered
                </Td>
              </tr>
            ) : (
              streams.map((s) => (
                <tr key={s.camera_id}>
                  <Td>#{s.camera_id}</Td>
                  <Td>
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
                  </Td>
                  <Td>{s.health?.fps ?? '—'}</Td>
                  <Td>{s.health?.latency_ms != null ? `${s.health.latency_ms}ms` : '—'}</Td>
                  <Td>
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
                  </Td>
                </tr>
              ))
            )}
          </TableBody>
        </TableShell>
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
      <h2 className="mb-4 text-lg font-medium text-slate-100">Runtime configuration</h2>
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
        <Label className="flex-row items-center gap-2">
          <input
            type="checkbox"
            checked={form.liveness_enabled}
            onChange={(e) => setForm({ ...form, liveness_enabled: e.target.checked })}
          />
          Liveness enabled
        </Label>
        <Label className="flex-row items-center gap-2">
          <input
            type="checkbox"
            checked={form.unknown_person_enabled}
            onChange={(e) => setForm({ ...form, unknown_person_enabled: e.target.checked })}
          />
          Unknown-person alerts
        </Label>
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" disabled={save.isPending}>
            Save configuration
          </Button>
        </div>
      </form>
    </Card>
  )
}
