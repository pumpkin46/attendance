import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { confirmDialog } from '@/shared/ui/dialogs'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Pagination } from '@/shared/ui/Pagination'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
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
  DEFAULT_STREAM_FIELD,
  DIRECTION_LABELS,
  STATUS_LABELS,
  STREAM_FIELD_BY_TYPE,
  ZONE_FALLBACK,
  streamUrlProblem,
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
}

const CameraGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </svg>
)

const isOnline = (c: Camera) => c.health?.online ?? c.online ?? false
const eventsToday = (c: Camera) => c.health?.recognition_events_today ?? c.recognition_count_today ?? 0

function timeAgo(iso?: string | null): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function MetricCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-slate-900 px-3 py-2">
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
  const lastSeen = timeAgo(camera.health?.updated_at ?? camera.last_heartbeat_at)
  const footerMeta = [
    resolution,
    DIRECTION_LABELS[camera.direction] ?? null,
    lastSeen && `Seen ${lastSeen}`,
  ].filter(Boolean)

  return (
    <Card
      padding={false}
      className="group flex flex-col overflow-hidden transition-colors hover:border-slate-600"
    >
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
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              online ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'
            )}
          />
          {online ? 'Live' : 'Offline'}
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
      <div className="grid grid-cols-3 gap-px border-t border-slate-800 bg-slate-800">
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
          {footerMeta.length > 0
            ? footerMeta.join(' · ')
            : camera.target_fps
              ? `${camera.target_fps} fps target`
              : '—'}
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

/** Clickable fleet summary tile, mirrors the anomalies page severity tiles. */
function FleetTile({
  label,
  value,
  dot,
  accent,
  active,
  onClick,
}: {
  label: string
  value: number
  dot: string
  accent: string
  active?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        {label}
      </span>
      <span className="mt-2 block text-3xl font-semibold text-slate-100">{value}</span>
    </>
  )
  const base = cn('rounded-xl border border-slate-700 border-l-4 bg-slate-900 p-4 text-left', accent)
  if (!onClick) return <div className={base}>{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        base,
        'transition-colors hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        active && 'bg-slate-800 ring-1 ring-blue-500/70'
      )}
    >
      {body}
    </button>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="mb-2">
      <legend className="mb-3 flex w-full items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
        <span className="h-px flex-1 bg-slate-800" />
      </legend>
      <div className="grid gap-x-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

type FilterKey = 'all' | 'online' | 'offline'

// The camera list is small and capped server-side (max_cameras), so the full
// set is always loaded in one request; the grid paginates client-side to keep
// the fleet tiles counting the whole fleet.
const CAMERAS_PER_PAGE = 12

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
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // The online/offline filter lives in the URL so the dashboard can deep-link
  // to it (e.g. /cameras?filter=online) and views stay shareable.
  const [searchParams, setSearchParams] = useSearchParams()
  const rawFilter = searchParams.get('filter')
  const filter: FilterKey = rawFilter === 'online' || rawFilter === 'offline' ? rawFilter : 'all'

  const cameras = useMemo(() => camerasData?.data ?? [], [camerasData])
  const locations = locationsData ?? []

  const cameraTypes = config?.camera_types ?? CAMERA_TYPE_FALLBACK
  const zones = config?.zones ?? ZONE_FALLBACK

  // The stream source field adapts to the selected camera type: RTSP cameras
  // take an rtsp:// URL, IP/mobile cameras an http(s) endpoint, USB cameras a
  // bare device index, NVR/CCTV a channel URL.
  const streamSpec = STREAM_FIELD_BY_TYPE[form.camera_type] ?? DEFAULT_STREAM_FIELD
  const streamUrlError = streamUrlProblem(form.camera_type, form.stream_url)

  const onlineCount = cameras.filter(isOnline).length
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cameras.filter((c) => {
      if (filter === 'online' && !isOnline(c)) return false
      if (filter === 'offline' && isOnline(c)) return false
      if (typeFilter && (c.camera_type ?? 'rtsp') !== typeFilter) return false
      if (!q) return true
      const typeKey = c.camera_type ?? 'rtsp'
      return [c.name, c.location?.name, c.zone, c.floor, typeKey, cameraTypes[typeKey]].some(
        (field) => field?.toLowerCase().includes(q)
      )
    })
  }, [cameras, filter, typeFilter, search, cameraTypes])

  // Clamp so deletes or filter changes never strand the view on an empty page.
  // Render-phase sync (not an effect): persist the clamped value, otherwise a
  // stale higher `page` silently jumps the grid forward again the moment
  // pageCount grows back.
  const pageCount = Math.max(1, Math.ceil(filtered.length / CAMERAS_PER_PAGE))
  if (page > pageCount) setPage(pageCount)
  const safePage = Math.min(page, pageCount)
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * CAMERAS_PER_PAGE, safePage * CAMERAS_PER_PAGE),
    [filtered, safePage]
  )

  const changeFilter = (key: FilterKey) => {
    setSearchParams(key === 'all' ? {} : { filter: key }, { replace: true })
    setPage(1)
  }

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
    if (streamUrlError) {
      toast.error(`Invalid ${streamSpec.label.toLowerCase()}: ${streamUrlError}`)
      return
    }
    const payload = {
      location_id: Number(form.location_id),
      name: form.name,
      camera_type: form.camera_type,
      zone: form.zone || null,
      floor: form.floor || null,
      stream_url: form.stream_url.trim() || null,
      target_fps: form.target_fps ? Number(form.target_fps) : null,
      resolution_width: form.resolution_width ? Number(form.resolution_width) : null,
      resolution_height: form.resolution_height ? Number(form.resolution_height) : null,
      status: form.status,
      direction: form.direction,
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
        description="Configure cameras and monitor stream health and recognition activity."
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
        <form id="camera-form" onSubmit={saveCamera}>
          <FormSection title="Identity">
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
          </FormSection>

          <FormSection title="Placement">
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
          </FormSection>

          <FormSection title="Video stream">
            <Label className="sm:col-span-2">
              {streamSpec.label}
              <Input
                placeholder={streamSpec.placeholder}
                value={form.stream_url}
                inputMode={streamSpec.numeric ? 'numeric' : 'url'}
                onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
                className={cn(
                  streamUrlError &&
                    'border-red-500/70 focus:border-red-500 focus:ring-red-500'
                )}
              />
              <span className={cn('text-xs', streamUrlError ? 'text-red-400' : 'text-slate-500')}>
                {streamUrlError ?? streamSpec.hint}
              </span>
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
          </FormSection>
        </form>
      </SidePanel>

      {captureResult && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-slate-200">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <div className="flex-1">
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
            aria-label="Dismiss"
            className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Fleet summary — Total/Online/Offline double as the status filter. */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <FleetTile
          label="Total cameras"
          value={cameras.length}
          dot="bg-blue-400"
          accent="border-l-blue-500"
          active={filter === 'all'}
          onClick={() => changeFilter('all')}
        />
        <FleetTile
          label="Online"
          value={onlineCount}
          dot="bg-emerald-400"
          accent="border-l-emerald-500"
          active={filter === 'online'}
          onClick={() => changeFilter('online')}
        />
        <FleetTile
          label="Offline"
          value={cameras.length - onlineCount}
          dot={cameras.length - onlineCount > 0 ? 'bg-amber-400' : 'bg-slate-500'}
          accent={cameras.length - onlineCount > 0 ? 'border-l-amber-500' : 'border-l-slate-600'}
          active={filter === 'offline'}
          onClick={() => changeFilter('offline')}
        />
        <FleetTile
          label="Recognitions today"
          value={cameras.reduce((n, c) => n + eventsToday(c), 0)}
          dot="bg-violet-400"
          accent="border-l-violet-500"
        />
      </div>

      {/* Toolbar: search + type filter */}
      {!isPending && !isError && cameras.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchBox
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder="Search name, location, zone…"
            className="w-full sm:max-w-xs"
          />
          <div className="flex items-center gap-3">
            <Combobox
              value={typeFilter}
              onChange={(v) => {
                setTypeFilter(v)
                setPage(1)
              }}
              className="w-48"
              aria-label="Filter by camera type"
            >
              <option value="">All types</option>
              {Object.entries(cameraTypes).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Combobox>
            <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:block">
              {filtered.length} of {cameras.length} cameras
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      {isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} padding={false} className="overflow-hidden">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="grid grid-cols-3 gap-px bg-slate-800">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="bg-slate-900 px-3 py-2">
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
          <Button className="mt-2" onClick={openCreate}>
            + Register camera
          </Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="py-10 text-center text-sm text-slate-500">
          No cameras match the current filters
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {paged.map((c) => (
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
          {pageCount > 1 && (
            <Pagination
              className="mt-4"
              page={safePage}
              pageCount={pageCount}
              onPageChange={setPage}
              totalItems={filtered.length}
              pageSize={CAMERAS_PER_PAGE}
            />
          )}
        </>
      )}
    </div>
  )
}
