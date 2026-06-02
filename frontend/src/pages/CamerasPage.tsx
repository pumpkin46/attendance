import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Camera } from '../types'

interface Location {
  id: number
  name: string
}

interface CaptureResult {
  face_count: number
  detect_ms: number
  capture_ms: number
  frame_rate_fps?: number
  identify?: { matched: boolean; reason?: string; employee?: { first_name: string; last_name: string } }
}

const STATUS_LABELS: Record<Camera['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  maintenance: 'Maintenance',
}

const emptyForm = {
  location_id: '',
  name: '',
  stream_url: '',
  status: 'active' as Camera['status'],
}

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [capturing, setCapturing] = useState<number | null>(null)
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null)
  const [form, setForm] = useState(emptyForm)

  const load = () => {
    api.get<Camera[]>('/cameras').then((r) => setCameras(r.data))
  }

  useEffect(() => {
    load()
    api.get<Location[]>('/locations').then((r) => setLocations(r.data))
  }, [])

  const startEdit = (camera: Camera) => {
    setEditingId(camera.id)
    setShowForm(true)
    setForm({
      location_id: String(camera.location?.id ?? ''),
      name: camera.name,
      stream_url: camera.stream_url ?? '',
      status: camera.status,
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
      stream_url: form.stream_url || null,
      status: form.status,
    }

    if (editingId) {
      await api.patch(`/cameras/${editingId}`, payload)
    } else {
      await api.post('/cameras', payload)
    }

    resetForm()
    load()
  }

  const captureFromStream = async (cameraId: number) => {
    setCapturing(cameraId)
    setCaptureResult(null)
    try {
      const { data } = await api.post<CaptureResult>(`/cameras/${cameraId}/capture`, {
        identify: true,
        require_liveness: false,
      })
      setCaptureResult(data)
      load()
    } finally {
      setCapturing(null)
    }
  }

  const onlineCount = cameras.filter((c) => c.online).length

  return (
    <div>
      <PageHeader
        title="Camera Management"
        description="FR-019: Register cameras with name, location, RTSP URL, and status"
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
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveCamera}>
            <Label>
              Name *
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Main entrance"
                required
              />
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
            <Label className="sm:col-span-2">
              RTSP URL
              <Input
                placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                value={form.stream_url}
                onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
              />
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
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">{editingId ? 'Update camera' : 'Register camera'}</Button>
            </div>
          </form>
        </Card>
      )}

      {captureResult && (
        <Card className="mb-6">
          <p className="text-sm">
            Stream test: {captureResult.face_count} face(s) in {captureResult.detect_ms}ms
            {captureResult.frame_rate_fps != null && ` · ${captureResult.frame_rate_fps} FPS`}
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

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        <StatCard label="Total cameras" value={cameras.length} />
        <StatCard label="Online" value={onlineCount} />
        <StatCard label="Offline" value={cameras.length - onlineCount} tone="warn" />
        <StatCard
          label="Recognitions today"
          value={cameras.reduce((n, c) => n + (c.recognition_count_today ?? 0), 0)}
        />
      </div>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Location</Th>
          <Th>RTSP URL</Th>
          <Th>Status</Th>
          <Th>Online</Th>
          <Th>Frame rate</Th>
          <Th>Recognitions</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {cameras.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-slate-400">
                No cameras registered yet
              </Td>
            </tr>
          ) : (
            cameras.map((c) => (
              <tr key={c.id}>
                <Td>{c.name}</Td>
                <Td>{c.location?.name ?? '—'}</Td>
                <Td className="max-w-[180px] truncate text-xs">{c.stream_url ?? '—'}</Td>
                <Td>
                  <Badge
                    tone={
                      c.status === 'active' ? 'ok' : c.status === 'maintenance' ? 'warn' : 'neutral'
                    }
                  >
                    {STATUS_LABELS[c.status]}
                  </Badge>
                </Td>
                <Td>
                  <Badge tone={c.online ? 'ok' : 'warn'}>{c.online ? 'Online' : 'Offline'}</Badge>
                </Td>
                <Td>{c.frame_rate_fps != null ? `${c.frame_rate_fps} fps` : '—'}</Td>
                <Td>{c.recognition_count_today ?? 0}</Td>
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
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
