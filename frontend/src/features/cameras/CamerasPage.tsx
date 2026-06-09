import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SidePanel } from '@/shared/ui/SidePanel'
import { StatCard } from '@/shared/ui/StatCard'
import { DataTable } from '@/shared/ui/DataTable'
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

  const cameras = camerasData?.data ?? []
  const locations = locationsData ?? []

  const cameraTypes = config?.camera_types ?? CAMERA_TYPE_FALLBACK
  const zones = config?.zones ?? ZONE_FALLBACK

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

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
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

    resetForm()
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

  const onlineCount = cameras.filter((c) => c.health?.online ?? c.online).length

  return (
    <div>
      <PageHeader
        title="Camera Management"
        description="Configure cameras and monitor stream health: online status, FPS, latency, bandwidth, CPU/GPU, and recognition events."
        actions={
          <Button
            onClick={() => {
              if (showForm) resetForm()
              else setShowForm(true)
            }}
          >
            {showForm ? 'Cancel' : 'Register camera'}
          </Button>
        }
      />

      {showForm && (
        <SidePanel
          title={editingId ? 'Edit camera' : 'Register camera'}
          description={
            editingId ? 'Update camera configuration' : 'Add a new camera and configure its stream'
          }
          onClose={resetForm}
          footer={
            <>
              <Button
                type="submit"
                form="camera-form"
                isLoading={createCamera.isPending || updateCamera.isPending}
              >
                {editingId ? 'Update camera' : 'Register camera'}
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>
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
                onChange={(value) =>
                  setForm({ ...form, status: value as Camera['status'] })
                }
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
                  setForm({
                    ...form,
                    deployment_mode: value as Camera['deployment_mode'],
                  })
                }
              >
                <option value="cloud">Cloud (central AI)</option>
                <option value="edge">Edge (on-device AI)</option>
              </Combobox>
            </Label>
          </form>
        </SidePanel>
      )}

      {captureResult && (
        <Card className="mb-6">
          <p className="text-sm">
            Stream test: {captureResult.face_count} face(s) in {captureResult.detect_ms}ms
            {captureResult.health?.fps != null && ` · ${captureResult.health.fps} FPS`}
            {captureResult.latency_ms != null && ` · ${captureResult.latency_ms}ms latency`}
            {captureResult.bandwidth_kbps != null &&
              ` · ${captureResult.bandwidth_kbps} kbps`}
          </p>
          {captureResult.identify && (
            <p className="mt-2 text-sm">
              {captureResult.identify.matched
                ? `Matched: ${captureResult.identify.employee?.first_name} ${captureResult.identify.employee?.last_name}`
                : `Not matched (${captureResult.identify.reason})`}
            </p>
          )}
        </Card>
      )}

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        <StatCard label="Total cameras" value={cameras.length} />
        <StatCard label="Online" value={onlineCount} />
        <StatCard label="Offline" value={cameras.length - onlineCount} tone="warn" />
        <StatCard
          label="Recognitions today"
          value={cameras.reduce((n, c) => n + (c.health?.recognition_events_today ?? c.recognition_count_today ?? 0), 0)}
        />
      </div>

      <DataTable
        data={cameras}
        rowKey={(c) => c.id}
        pageSize={10}
        loading={isPending}
        error={isError ? 'Failed to load cameras' : undefined}
        empty="No cameras registered yet"
        columns={[
          { key: 'name', header: 'Name', cell: (c) => c.name },
          { key: 'type', header: 'Type', className: 'uppercase text-xs', cell: (c) => c.camera_type ?? 'rtsp' },
          {
            key: 'location',
            header: 'Location / Zone',
            cell: (c) => (
              <>
                <div className="text-sm">{c.location?.name ?? '—'}</div>
                {(c.zone || c.floor) && (
                  <div className="text-xs text-slate-400">
                    {[c.zone, c.floor].filter(Boolean).join(' · ')}
                  </div>
                )}
              </>
            ),
          },
          {
            key: 'resolution',
            header: 'Resolution',
            cell: (c) => c.resolution ?? (c.target_fps ? `${c.target_fps} fps target` : '—'),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (c) => (
              <Badge
                tone={
                  c.status === 'active'
                    ? 'ok'
                    : c.status === 'maintenance'
                      ? 'warn'
                      : 'neutral'
                }
              >
                {STATUS_LABELS[c.status]}
              </Badge>
            ),
          },
          {
            key: 'online',
            header: 'Online',
            cell: (c) => {
              const online = c.health?.online ?? c.online
              return <Badge tone={online ? 'ok' : 'warn'}>{online ? 'Online' : 'Offline'}</Badge>
            },
          },
          { key: 'fps', header: 'FPS', cell: (c) => (c.health?.fps != null ? c.health.fps.toFixed(1) : c.frame_rate_fps ?? '—') },
          { key: 'latency', header: 'Latency', cell: (c) => (c.health?.latency_ms != null ? `${c.health.latency_ms}ms` : '—') },
          { key: 'bandwidth', header: 'Bandwidth', cell: (c) => (c.health?.bandwidth_kbps != null ? `${c.health.bandwidth_kbps}` : '—') },
          { key: 'cpu', header: 'CPU', cell: (c) => (c.health?.cpu_usage_percent != null ? `${c.health.cpu_usage_percent}%` : '—') },
          { key: 'gpu', header: 'GPU', cell: (c) => (c.health?.gpu_usage_percent != null ? `${c.health.gpu_usage_percent}%` : '—') },
          { key: 'dropped', header: 'Dropped', cell: (c) => c.health?.dropped_frames ?? 0 },
          { key: 'events', header: 'Events', cell: (c) => c.health?.recognition_events_today ?? c.recognition_count_today ?? 0 },
          {
            key: 'actions',
            header: 'Actions',
            cell: (c) => (
              <div className="flex gap-1">
                <Button variant="ghost" onClick={() => startEdit(c)}>
                  Edit
                </Button>
                {c.stream_url && (
                  <Button
                    variant="ghost"
                    disabled={capturing === c.id}
                    onClick={() => captureFromStream(c.id)}
                  >
                    {capturing === c.id ? '…' : 'Test'}
                  </Button>
                )}
                <Button
                  variant="danger"
                  disabled={deleteCamera.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove camera "${c.name}"?`)) deleteCamera.mutate(c.id)
                  }}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
