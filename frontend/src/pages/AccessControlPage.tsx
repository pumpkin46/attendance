import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Paginated } from '../types'

interface AccessPoint {
  id: number
  name: string
  device_type: string
  default_action: string
  controller_url?: string
  is_active: boolean
  camera?: { id: number; name: string }
}

interface AccessConfig {
  actions: Record<string, string>
  device_types: Record<string, string>
  grant_conditions: Record<string, boolean>
}

export default function AccessControlPage() {
  const [points, setPoints] = useState<AccessPoint[]>([])
  const [config, setConfig] = useState<AccessConfig | null>(null)
  const [form, setForm] = useState({
    organization_id: '1',
    name: '',
    device_type: 'door',
    default_action: 'unlock_door',
    controller_url: '',
    camera_id: '',
  })

  const load = () =>
    api
      .get<AccessPoint[] | Paginated<AccessPoint>>('/access-points')
      .then((r) => {
        const payload = r.data
        setPoints(Array.isArray(payload) ? payload : (payload.data ?? []))
      })
      .catch(() => setPoints([]))

  useEffect(() => {
    load()
    api.get<AccessConfig>('/access-points/config').then((r) => setConfig(r.data))
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    await api.post('/access-points', {
      ...form,
      organization_id: Number(form.organization_id),
      camera_id: form.camera_id ? Number(form.camera_id) : null,
      controller_url: form.controller_url || null,
    })
    load()
  }

  const execute = async (id: number, action: string) => {
    await api.post(`/access-points/${id}/execute`, { action })
  }

  return (
    <div>
      <PageHeader
        title="Access Control"
        description="Door, turnstile, and gate control when face is recognized, liveness passes, and access is authorized."
      />

      {config && (
        <Card className="mb-6">
          <h2 className="mb-2 text-lg font-medium">Grant conditions</h2>
          <ul className="list-inside list-disc text-sm text-slate-300">
            {Object.entries(config.grant_conditions).map(([k, v]) => (
              <li key={k}>
                {k.replace(/_/g, ' ')}: {v ? 'required' : 'optional'}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-medium">Add access point</h2>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={create}>
          <Label>
            Name
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            Device type
            <Select
              value={form.device_type}
              onChange={(e) => setForm({ ...form, device_type: e.target.value })}
            >
              {config &&
                Object.entries(config.device_types).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </Select>
          </Label>
          <Label>
            Default action
            <Select
              value={form.default_action}
              onChange={(e) => setForm({ ...form, default_action: e.target.value })}
            >
              {config &&
                Object.entries(config.actions).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
            </Select>
          </Label>
          <Label>
            Controller URL (optional)
            <Input
              placeholder="http://controller/unlock"
              value={form.controller_url}
              onChange={(e) => setForm({ ...form, controller_url: e.target.value })}
            />
          </Label>
          <div className="sm:col-span-2">
            <Button type="submit">Create access point</Button>
          </div>
        </form>
      </Card>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Action</Th>
          <Th>Camera</Th>
          <Th>Manual control</Th>
        </TableHead>
        <TableBody>
          {points.map((p) => (
            <tr key={p.id}>
              <Td>{p.name}</Td>
              <Td>{p.device_type}</Td>
              <Td>{config?.actions[p.default_action] ?? p.default_action}</Td>
              <Td>{p.camera?.name ?? '—'}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {config &&
                    Object.keys(config.actions).map((action) => (
                      <Button key={action} variant="ghost" onClick={() => execute(p.id, action)}>
                        {config.actions[action]}
                      </Button>
                    ))}
                </div>
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
