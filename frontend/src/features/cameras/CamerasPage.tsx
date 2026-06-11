import { useMemo, useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { confirmDialog } from '@/shared/ui/dialogs'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SidePanel } from '@/shared/ui/SidePanel'
import { StatCard } from '@/shared/ui/StatCard'
import { Skeleton } from '@/shared/ui/Skeleton'
import { cn } from '@/shared/lib/cn'
import type { Camera } from '@/shared/types'
import {
  useCameras,
  useCameraConfig,
  useCaptureFromStream,
  useCreateCamera,
  useDeleteCamera,
  useLocations,
  useUpdateCamera,
} from '@/features/cameras/api/queries'
import {
  CAMERA_TYPE_FALLBACK,
  STATUS_LABELS,
  ZONE_FALLBACK,
  type CaptureResult,
} from '@/features/cameras/types'

const emptyForm = {
  location_id: '',
  name: '',
  camera_type: 'rtsp',
  zone: '',
  floor: '',
  stream_url: '',
  target_fps: '15',
  resolution_width: '1920',
  resolution_height: '1080',
  status: 'active' as Camera['status'],
  direction: 'both',
  deployment_mode: 'cloud' as Camera['deployment_mode'],
}

const CameraGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </svg>
)

const isOnline = (c: Camera) => c.health?.online ?? c.online ?? false
const eventsToday = (c: Camera) => c.health?.recognition_events_today ?? c.recognition_count_today ?? 0

function MetricCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-sm font-medium text-slate-200">{value}</div>
    </div>
  )
}

function CameraTile({
  camera,
  capturing,
  deleting,
  onEdit,
  onTest,
  onDelete,
}: {
  camera: Camera
  capturing: boolean
  deleting: boolean
  onEdit: () => void
  onTest: () => void
  onDelete: () => void
}) {
  const online = isOnline(camera)
  const statusTone =
    camera.status === 'active' ? 'ok' : camera.status === 'maintenance' ? 'warn' : 'neutral'
  const resolution =
    camera.resolution ??
    (camera.resolution_width && camera.resolution_height
      ? `${camera.resolution_width}×${camera.resolution_height}`
      : null)
  const fps = camera.health?.fps != null ? camera.health.fps.toFixed(1) : camera.frame_rate_fps ?? '—'

  return (
    <Card padding={false} className="flex flex-col overflow-hidden">
      {/* Preview band */}
      <div
        className={cn(
          'relative flex aspect-video items-center justify-center',
          'bg-[radial-gradient(circle_at_center,_theme(colors.slate.800)_0%,_theme(colors.slate.950)_100%)]'
        )}
      >
        <span className={cn('h-12 w-12', online ? 'text-slate-600' : 'text-slate-700')}>{CameraGlyph}</span>

        {/* Top-left: online status */}
        <span
          className={cn(
            'absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur',
            online ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-900/70 text-slate-400'
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', online ? 'bg-emerald-400' : 'bg-slate-500')} />
          {online ? 'Online' : 'Offline'}
        </span>

        {/* Top-right: type */}
        <span className="absolute right-2 top-2 rounded-md bg-slate-900/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-300 backdrop-blur">
          {camera.camera_type ?? 'rtsp'}
        </span>

        {/* Bottom: name + location */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2.5 pt-8">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-white">{camera.name}</h3>
              <p className="truncate text-xs text-slate-300">
                {camera.location?.name ?? '—'}
                {(camera.zone || camera.floor) && ` · ${[camera.zone, camera.floor].filter(Boolean).join(' · ')}`}
              </p>
            </div>
            <Badge tone={statusTone}>{STATUS_LABELS[camera.status]}</Badge>
          </div>
        </div>
      </div>

      {/* Health metrics */}
      <div className="grid grid-cols-3 gap-px bg-slate-800">
        <MetricCell label="FPS" value={fps} />
        <MetricCell label="Latency" value={camera.health?.latency_ms != null ? `${camera.health.latency_ms}ms` : '—'} />
        <MetricCell label="Events" value={eventsToday(camera)} />
        <MetricCell label="CPU" value={camera.health?.cpu_usage_percent != null ? `${camera.health.cpu_usage_percent}%` : '—'} />
        <MetricCell label="GPU" value={camera.health?.gpu_usage_percent != null ? `${camera.health.gpu_usage_percent}%` : '—'} />
        <MetricCell label="Dropped" value={camera.health?.dropped_frames ?? 0} />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-2.5">
        <span className="truncate text-xs text-slate-500">
          {resolution ?? (camera.target_fps ? `${camera.target_fps} fps target` : '—')}
        </span>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          {camera.stream_url && (
            <Button size="sm" variant="ghost" isLoading={capturing} onClick={onTest}>
              Test
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
            disabled={deleting}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  )
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'offline', label: 'Offline' },
] as const
type FilterKey = (typeof FILTERS)[number]['key']

export default function CamerasPage() {
  const { data: camerasData, isPending, isError } = useCameras()
  const { data: config } = useCameraConfig()
  const { data: locationsData } = useLocations()
  const createCamera = useCreateCamera()
  const updateCamera = useUpdateCamera()
  const deleteCamera = useDeleteCamera()
  const captureMutation = useCaptureFromStream()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [capturing, setCapturing] = useState<number | null>(null)
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [filter, setFilter] = useState<FilterKey>('all')

  const cameras = useMemo(() => camerasData?.data ?? [], [camerasData])
  const locations = locationsData ?? []

  const cameraTypes = config?.camera_types ?? CAMERA_TYPE_FALLBACK
  const zones = config?.zones ?? ZONE_FALLBACK

  const onlineCount = cameras.filter(isOnline).length
  const filtered = useMemo(() => {
    if (filter === 'online') return cameras.filter(isOnline)
    if (filter === 'offline') return cameras.filter((c) => !isOnline(c))
    return cameras
  }, [cameras, filter])

  const startEdit = (camera: Camera) => {
    setEditingId(camera.id)
    setShowForm(true)
    setForm({
      location_id: String(camera.location?.id ?? ''),
      name: camera.name,
      camera_type: camera.camera_type ?? 'rtsp',
      zone: camera.zone ?? '',
      floor: camera.floor ?? '',
      stream_url: camera.stream_url ?? '',
      target_fps: String(camera.target_fps ?? 15),
      resolution_width: String(camera.resolution_width ?? 1920),
      resolution_height: String(camera.resolution_height ?? 1080),
      status: camera.status,
      direction: camera.direction ?? 'both',
      deployment_mode: camera.deployment_mode ?? 'cloud',
    })
  }

  // State resets happen in openCreate/startEdit so the exit animation doesn't flash.
  const closePanel = () => setShowForm(false)

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const saveCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      location_id: Number(form.location_id),
      name: form.name,
      camera_type: form.camera_type,
      zone: form.zone || null,
      floor: form.floor || null,
      stream_url: form.stream_url || null,
      target_fps: form.target_fps ? Number(form.target_fps) : null,
      resolution_width: form.resolution_width ? Number(form.resolution_width) : null,
      resolution_height: form.resolution_height ? Number(form.resolution_height) : null,
      status: form.status,
      direction: form.direction,
      deployment_mode: form.deployment_mode,
    }

    if (editingId) {
      await updateCamera.mutateAsync({ id: editingId, payload })
    } else {
      await createCamera.mutateAsync(payload)
    }

    closePanel()
  }

  const captureFromStream = async (cameraId: number) => {
    setCapturing(cameraId)
    setCaptureResult(null)
    try {
      const data = await captureMutation.mutateAsync(cameraId)
      setCaptureResult(data)
    } finally {
      setCapturing(null)
    }
  }

  const removeCamera = async (c: Camera) => {
    const ok = await confirmDialog({
      title: 'Remove camera',
      message: `Remove camera "${c.name}"? Its stream and recognition events will stop.`,
      confirmLabel: 'Remove',
    })
    if (ok) deleteCamera.mutate(c.id)
  }

  return (
    <div>
      <PageHeader
        title="Camera Management"
        description="Configure cameras and monitor stream health: online status, FPS, latency, bandwidth, CPU/GPU, and recognition events."
        actions={
          <Button onClick={() => (showForm ? closePanel() : openCreate())} variant={showForm ? 'ghost' : 'primary'}>
            {showForm ? 'Cancel' : '+ Register camera'}
          </Button>
        }
      />

      <SidePanel
        open={showForm}
        title={editingId ? 'Edit camera' : 'Register camera'}
        description={
          editingId ? 'Update camera configuration' : 'Add a new camera and configure its stream'
        }
        onClose={closePanel}
        footer={
          <>
            <Button
              type="submit"
              form="camera-form"
              isLoading={createCamera.isPending || updateCamera.isPending}
            >
              {editingId ? 'Update camera' : 'Register camera'}
            </Button>
            <Button type="button" variant="ghost" onClick={closePanel}>
              Cancel
            </Button>
          </>
        }
      >
        <form id="camera-form" className="grid gap-4 sm:grid-cols-2" onSubmit={saveCamera}>
          <Label>
            Camera name *
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Main entrance"
              required
            />
          </Label>
          <Label>
            Camera type *
            <Combobox
              value={form.camera_type}
              onChange={(value) => setForm({ ...form, camera_type: value })}
            >
              {Object.entries(cameraTypes).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Location *
            <Combobox
              value={form.location_id}
              onChange={(value) => setForm({ ...form, location_id: value })}
              required
            >
              <option value="">Select location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Zone
            <Combobox
              value={form.zone}
              onChange={(value) => setForm({ ...form, zone: value })}
            >
              <option value="">—</option>
              {Object.entries(zones).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Floor
            <Input
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
              placeholder="Ground, L1, …"
            />
          </Label>
          <Label className="sm:col-span-2">
            RTSP URL
            <Input
              placeholder="rtsp://user:pass@192.168.1.100:554/stream"
              value={form.stream_url}
              onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
            />
          </Label>
          <Label>
            Target FPS
            <Input
              type="number"
              min={1}
              max={120}
              value={form.target_fps}
              onChange={(e) => setForm({ ...form, target_fps: e.target.value })}
            />
          </Label>
          <Label>
            Resolution width
            <Input
              type="number"
              value={form.resolution_width}
              onChange={(e) => setForm({ ...form, resolution_width: e.target.value })}
            />
          </Label>
          <Label>
            Resolution height
            <Input
              type="number"
              value={form.resolution_height}
              onChange={(e) => setForm({ ...form, resolution_height: e.target.value })}
            />
          </Label>
          <Label>
            Direction
            <Combobox
              value={form.direction}
              onChange={(value) => setForm({ ...form, direction: value })}
            >
              <option value="in">Entry (check-in)</option>
              <option value="out">Exit (check-out)</option>
              <option value="both">Both</option>
            </Combobox>
          </Label>
          <Label>
            Status *
            <Combobox
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value as Camera['status'] })}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="maintenance">Maintenance</option>
            </Combobox>
          </Label>
          <Label>
            Deployment
            <Combobox
              value={form.deployment_mode}
              onChange={(value) =>
                setForm({ ...form, deployment_mode: value as Camera['deployment_mode'] })
              }
            >
              <option value="cloud">Cloud (central AI)</option>
              <option value="edge">Edge (on-device AI)</option>
            </Combobox>
          </Label>
        </form>
      </SidePanel>

      {captureResult && (
        <Card className="mb-6 flex items-start justify-between gap-3 border-l-4 border-l-blue-500">
          <div className="text-sm text-slate-200">
            <p>
              <span className="font-medium">Stream test:</span> {captureResult.face_count} face(s) in{' '}
              {captureResult.detect_ms}ms
              {captureResult.health?.fps != null && ` · ${captureResult.health.fps} FPS`}
              {captureResult.latency_ms != null && ` · ${captureResult.latency_ms}ms latency`}
              {captureResult.bandwidth_kbps != null && ` · ${captureResult.bandwidth_kbps} kbps`}
            </p>
            {captureResult.identify && (
              <p className="mt-1 text-slate-400">
                {captureResult.identify.matched
                  ? `Matched: ${captureResult.identify.employee?.first_name} ${captureResult.identify.employee?.last_name}`
                  : `Not matched (${captureResult.identify.reason})`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCaptureResult(null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Dismiss
          </button>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        <StatCard label="Total cameras" value={cameras.length} />
        <StatCard label="Online" value={onlineCount} tone="ok" />
        <StatCard
          label="Offline"
          value={cameras.length - onlineCount}
          tone={cameras.length - onlineCount > 0 ? 'warn' : undefined}
        />
        <StatCard
          label="Recognitions today"
          value={cameras.reduce((n, c) => n + eventsToday(c), 0)}
        />
      </div>

      {/* Filter chips */}
      {!isPending && !isError && cameras.length > 0 && (
        <div className="mb-4 inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1">
          {FILTERS.map((f) => {
            const count = f.key === 'all' ? cameras.length : f.key === 'online' ? onlineCount : cameras.length - onlineCount
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  filter === f.key ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {f.label}
                <span className="ml-1.5 text-xs text-slate-500">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Content */}
      {isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} padding={false} className="overflow-hidden">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="grid grid-cols-3 gap-px bg-slate-800">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="px-3 py-2">
                    <Skeleton className="h-3 w-10" />
                    <Skeleton className="mt-1 h-4 w-8" />
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 px-3 py-2.5">
                <Skeleton className="h-4 w-24" />
              </div>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card className="py-10 text-center text-sm text-rose-400">Failed to load cameras</Card>
      ) : cameras.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-slate-500">
            {CameraGlyph}
          </span>
          <p className="text-sm font-medium text-slate-300">No cameras registered yet</p>
          <p className="text-xs text-slate-500">Register your first camera to start monitoring streams.</p>
          <Button className="mt-2" onClick={() => setShowForm(true)}>
            + Register camera
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-10 text-center text-sm text-slate-500">No {filter} cameras</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((c) => (
            <CameraTile
              key={c.id}
              camera={c}
              capturing={capturing === c.id}
              deleting={deleteCamera.isPending}
              onEdit={() => startEdit(c)}
              onTest={() => captureFromStream(c.id)}
              onDelete={() => removeCamera(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
