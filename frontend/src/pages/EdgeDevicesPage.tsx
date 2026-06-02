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
import type { Camera, EdgeDevice } from '../types'

interface Location {
  id: number
  name: string
}

const emptyForm = {
  location_id: '',
  camera_id: '',
  name: '',
  stream_url: '',
  local_ai_url: 'http://127.0.0.1:8001',
  poll_interval_seconds: '5',
  require_liveness: false,
  recognition_threshold: '',
}

export default function EdgeDevicesPage() {
  const [devices, setDevices] = useState<EdgeDevice[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [newToken, setNewToken] = useState<string | null>(null)

  const load = () => api.get<EdgeDevice[]>('/edge-devices').then((r) => setDevices(r.data))

  useEffect(() => {
    load()
    api.get<Location[]>('/locations').then((r) => setLocations(r.data))
    api.get<Camera[]>('/cameras').then((r) => setCameras(r.data))
  }, [])

  const saveDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data } = await api.post<EdgeDevice & { api_token_plain?: string }>('/edge-devices', {
      location_id: Number(form.location_id),
      camera_id: form.camera_id ? Number(form.camera_id) : null,
      name: form.name,
      stream_url: form.stream_url || null,
      local_ai_url: form.local_ai_url,
      poll_interval_seconds: Number(form.poll_interval_seconds),
      require_liveness: form.require_liveness,
      recognition_threshold: form.recognition_threshold ? Number(form.recognition_threshold) : null,
    })
    if (data.api_token_plain) setNewToken(data.api_token_plain)
    setShowForm(false)
    setForm(emptyForm)
    load()
  }

  const regenerateToken = async (id: number) => {
    const { data } = await api.post<{ api_token_plain: string }>(
      `/edge-devices/${id}/regenerate-token`
    )
    setNewToken(data.api_token_plain)
  }

  const onlineCount = devices.filter((d) => d.online).length

  return (
    <div>
      <PageHeader
        title="Edge AI Deployment"
        description="Deploy on-site recognition at camera locations — inference runs locally, only match results sync to central"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'Deploy device'}
          </Button>
        }
      />

      {newToken && (
        <Card className="mb-6 border-amber-700/50 bg-amber-950/30">
          <p className="text-sm font-medium text-amber-200">Edge device API token (shown once)</p>
          <code className="mt-2 block break-all rounded bg-slate-950 px-3 py-2 text-xs">{newToken}</code>
          <p className="mt-2 text-xs text-slate-400">
            Set <code>EDGE_DEVICE_TOKEN</code> in edge-agent/.env on the device.
          </p>
          <Button variant="ghost" className="mt-3" onClick={() => setNewToken(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      {showForm && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">Deploy edge device</h2>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveDevice}>
            <Label>
              Name *
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Lobby Jetson"
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
            <Label>
              Link camera
              <Select
                value={form.camera_id}
                onChange={(e) => setForm({ ...form, camera_id: e.target.value })}
              >
                <option value="">Optional</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Local stream URL
              <Input
                value={form.stream_url}
                onChange={(e) => setForm({ ...form, stream_url: e.target.value })}
                placeholder="rtsp://192.168.1.100:554/stream"
              />
            </Label>
            <Label>
              Local AI URL
              <Input
                value={form.local_ai_url}
                onChange={(e) => setForm({ ...form, local_ai_url: e.target.value })}
              />
            </Label>
            <Label>
              Poll interval (s)
              <Input
                type="number"
                min={1}
                max={60}
                value={form.poll_interval_seconds}
                onChange={(e) => setForm({ ...form, poll_interval_seconds: e.target.value })}
              />
            </Label>
            <Label>
              Threshold override
              <Input
                type="number"
                step="0.01"
                min={0.5}
                max={1}
                value={form.recognition_threshold}
                onChange={(e) => setForm({ ...form, recognition_threshold: e.target.value })}
                placeholder="0.95 (default)"
              />
            </Label>
            <Label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.require_liveness}
                onChange={(e) => setForm({ ...form, require_liveness: e.target.checked })}
              />
              Require liveness on edge (slower)
            </Label>
            <div className="sm:col-span-2">
              <Button type="submit">Deploy device</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        <StatCard label="Edge devices" value={devices.length} />
        <StatCard label="Online" value={onlineCount} />
        <StatCard label="Offline" value={devices.length - onlineCount} tone="warn" />
      </div>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Location</Th>
          <Th>Camera</Th>
          <Th>Stream</Th>
          <Th>Status</Th>
          <Th>Sync</Th>
          <Th>FPS</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {devices.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-slate-400">
                No edge devices deployed yet
              </Td>
            </tr>
          ) : (
            devices.map((d) => (
              <tr key={d.id}>
                <Td>{d.name}</Td>
                <Td>{d.location?.name ?? '—'}</Td>
                <Td>{d.camera?.name ?? '—'}</Td>
                <Td className="max-w-[160px] truncate text-xs">{d.stream_url ?? '—'}</Td>
                <Td>
                  <Badge tone={d.online ? 'ok' : 'warn'}>{d.online ? 'Online' : 'Offline'}</Badge>
                </Td>
                <Td className="text-xs">
                  {d.sync_version ? (
                    <span title={d.last_sync_at}>{d.sync_version.slice(0, 8)}…</span>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>{d.frame_rate_fps != null ? `${d.frame_rate_fps}` : '—'}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => regenerateToken(d.id)}>
                    New token
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
