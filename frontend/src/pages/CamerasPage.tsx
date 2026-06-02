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
  identify?: { matched: boolean; reason?: string; employee?: { first_name: string; last_name: string } }
}

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [showForm, setShowForm] = useState(false)
  const [capturing, setCapturing] = useState<number | null>(null)
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null)
  const [form, setForm] = useState({
    location_id: '',
    name: '',
    device_id: '',
    stream_url: '',
    direction: 'both',
  })

  const load = () => {
    api.get<Camera[]>('/cameras').then((r) => setCameras(r.data))
  }

  useEffect(() => {
    load()
    api.get<Location[]>('/locations').then((r) => setLocations(r.data))
  }, [])

  const isOnline = (c: Camera) => {
    if (!c.last_heartbeat_at) return false
    return Date.now() - new Date(c.last_heartbeat_at).getTime() < 120_000
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

  const createCamera = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.post('/cameras', form)
    setShowForm(false)
    setForm({ location_id: '', name: '', device_id: '', stream_url: '', direction: 'both' })
    load()
  }

  return (
    <div>
      <PageHeader
        title="Camera Management"
        description="FR-009: Webcam, IP camera, and RTSP stream face detection"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Add camera'}
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={createCamera}>
            <Label>
              Location
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
              Name
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Label>
            <Label>
              Device ID
              <Input
                value={form.device_id}
                onChange={(e) => setForm({ ...form, device_id: e.target.value })}
                required
              />
            </Label>
            <Label>
              Direction
              <Select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}
              >
                <option value="in">In</option>
                <option value="out">Out</option>
                <option value="both">Both</option>
              </Select>
            </Label>
            <Label className="sm:col-span-2">
              Stream URL (RTSP / HTTP)
              <Input
                placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                value={form.stream_url}
                onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
              />
            </Label>
            <div className="sm:col-span-2">
              <Button type="submit">Save camera</Button>
            </div>
          </form>
        </Card>
      )}

      {captureResult && (
        <Card className="mb-6">
          <p className="text-sm">
            Stream capture: {captureResult.face_count} face(s) detected in {captureResult.detect_ms}
            ms (capture {captureResult.capture_ms}ms)
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
        <StatCard label="Online" value={cameras.filter(isOnline).length} />
        <StatCard label="With RTSP" value={cameras.filter((c) => c.stream_url).length} />
      </div>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Device ID</Th>
          <Th>Stream URL</Th>
          <Th>Location</Th>
          <Th>Direction</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {cameras.map((c) => (
            <tr key={c.id}>
              <Td>{c.name}</Td>
              <Td>{c.device_id}</Td>
              <Td className="max-w-[200px] truncate text-xs">{c.stream_url ?? '—'}</Td>
              <Td>{c.location?.name ?? '—'}</Td>
              <Td>{c.direction}</Td>
              <Td>
                <Badge tone={isOnline(c) ? 'ok' : 'warn'}>
                  {isOnline(c) ? 'Online' : 'Offline'}
                </Badge>
              </Td>
              <Td>
                {c.stream_url && (
                  <Button
                    variant="ghost"
                    disabled={capturing === c.id}
                    onClick={() => captureFromStream(c.id)}
                  >
                    {capturing === c.id ? 'Capturing…' : 'Test stream'}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
