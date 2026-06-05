import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import type { Camera } from '@/shared/types'
import {
  useCameras,
  useCameraConfig,
  useCaptureFromStream,
  useCreateCamera,
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
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">
            {editingId ? 'Edit camera' : 'Register camera'}
          </h2>
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={saveCamera}>
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
              <Select
                value={form.camera_type}
                onChange={(e) => setForm({ ...form, camera_type: e.target.value })}
              >
                {Object.entries(cameraTypes).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Location *
              <Select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                required
              >
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Zone
              <Select
                value={form.zone}
                onChange={(e) => setForm({ ...form, zone: e.target.value })}
              >
                <option value="">—</option>
                {Object.entries(zones).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Floor
              <Input
                value={form.floor}
                onChange={(e) => setForm({ ...form, floor: e.target.value })}
                placeholder="Ground, L1, …"
              />
            </Label>
            <Label className="sm:col-span-2 lg:col-span-3">
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
              <Select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}
              >
                <option value="in">Entry (check-in)</option>
                <option value="out">Exit (check-out)</option>
                <option value="both">Both</option>
              </Select>
            </Label>
            <Label>
              Status *
              <Select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as Camera['status'] })
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="maintenance">Maintenance</option>
              </Select>
            </Label>
            <Label>
              Deployment
              <Select
                value={form.deployment_mode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    deployment_mode: e.target.value as Camera['deployment_mode'],
                  })
                }
              >
                <option value="cloud">Cloud (central AI)</option>
                <option value="edge">Edge (on-device AI)</option>
              </Select>
            </Label>
            <div className="flex items-end sm:col-span-2 lg:col-span-3">
              <Button type="submit">{editingId ? 'Update camera' : 'Register camera'}</Button>
            </div>
          </form>
        </Card>
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

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Location / Zone</Th>
          <Th>Resolution</Th>
          <Th>Status</Th>
          <Th>Online</Th>
          <Th>FPS</Th>
          <Th>Latency</Th>
          <Th>Bandwidth</Th>
          <Th>CPU</Th>
          <Th>GPU</Th>
          <Th>Dropped</Th>
          <Th>Events</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {isPending ? (
            <tr>
              <Td colSpan={14} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : isError ? (
            <tr>
              <Td colSpan={14} className="text-red-400">
                Failed to load cameras
              </Td>
            </tr>
          ) : cameras.length === 0 ? (
            <tr>
              <Td colSpan={14} className="text-slate-400">
                No cameras registered yet
              </Td>
            </tr>
          ) : (
            cameras.map((c) => {
              const h = c.health
              const online = h?.online ?? c.online

              return (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td className="uppercase text-xs">{c.camera_type ?? 'rtsp'}</Td>
                  <Td>
                    <div className="text-sm">{c.location?.name ?? '—'}</div>
                    {(c.zone || c.floor) && (
                      <div className="text-xs text-slate-400">
                        {[c.zone, c.floor].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </Td>
                  <Td>{c.resolution ?? (c.target_fps ? `${c.target_fps} fps target` : '—')}</Td>
                  <Td>
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
                  </Td>
                  <Td>
                    <Badge tone={online ? 'ok' : 'warn'}>{online ? 'Online' : 'Offline'}</Badge>
                  </Td>
                  <Td>{h?.fps != null ? h.fps.toFixed(1) : c.frame_rate_fps ?? '—'}</Td>
                  <Td>{h?.latency_ms != null ? `${h.latency_ms}ms` : '—'}</Td>
                  <Td>{h?.bandwidth_kbps != null ? `${h.bandwidth_kbps}` : '—'}</Td>
                  <Td>
                    {h?.cpu_usage_percent != null ? `${h.cpu_usage_percent}%` : '—'}
                  </Td>
                  <Td>
                    {h?.gpu_usage_percent != null ? `${h.gpu_usage_percent}%` : '—'}
                  </Td>
                  <Td>{h?.dropped_frames ?? 0}</Td>
                  <Td>{h?.recognition_events_today ?? c.recognition_count_today ?? 0}</Td>
                  <Td>
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
                    </div>
                  </Td>
                </tr>
              )
            })
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
