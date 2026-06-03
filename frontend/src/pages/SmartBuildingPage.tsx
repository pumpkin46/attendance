import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Paginated } from '../types'

const DRIVER_FALLBACK: Record<string, string> = {
  webhook: 'Webhook',
  mqtt: 'MQTT',
  bacnet_gateway: 'BACnet Gateway',
}

interface BuildingConfig {
  enabled: boolean
  webhook_timeout: number
  business_hours_start: string
  business_hours_end: string
  business_timezone: string
  drivers?: Record<string, string>
  event_types?: Record<string, string>
  default_subscribed_events?: string[]
}

interface Connector {
  id: number
  name: string
  driver: string
  endpoint_url?: string
  subscribed_events?: string[]
  is_active: boolean
  last_sync_at?: string
  events_today: number
}

interface BuildingEvent {
  id: number
  event_type: string
  status: string
  error_message?: string
  created_at: string
  connector?: { id: number; name: string }
}

export default function SmartBuildingPage() {
  const [config, setConfig] = useState<BuildingConfig | null>(null)
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [events, setEvents] = useState<BuildingEvent[]>([])
  const [form, setForm] = useState({
    name: '',
    driver: 'webhook',
    endpoint_url: '',
  })

  const drivers = config?.drivers ?? DRIVER_FALLBACK
  const eventTypes = config?.event_types ?? {}

  const load = () => {
    api
      .get<Paginated<Connector>>('/building/connectors', { params: { per_page: 50 } })
      .then((r) => setConnectors(r.data.data))
    api
      .get<Paginated<BuildingEvent>>('/building/events', { params: { per_page: 30 } })
      .then((r) => setEvents(r.data.data))
  }

  useEffect(() => {
    api.get<BuildingConfig>('/building/config').then((r) => setConfig(r.data))
    load()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await api.post('/building/connectors', {
      name: form.name,
      driver: form.driver,
      endpoint_url: form.endpoint_url || null,
      subscribed_events: config?.default_subscribed_events,
    })
    setForm({ name: '', driver: 'webhook', endpoint_url: '' })
    load()
  }

  const testConnector = async (id: number) => {
    await api.post(`/building/connectors/${id}/test`)
    load()
  }

  const publishOccupancy = async () => {
    const locationId = window.prompt('Location ID for occupancy update:', '1')
    if (!locationId) return
    const count = window.prompt('Occupant count:', '0')
    if (count === null) return
    await api.post('/building/occupancy/publish', {
      location_id: Number(locationId),
      count: Number(count),
    })
    load()
  }

  return (
    <div>
      <PageHeader
        title="Smart Building Integration"
        description="Connect BMS, HVAC, and IoT platforms via webhooks when access, occupancy, or visitor events occur."
        actions={
          <Button variant="ghost" onClick={publishOccupancy}>
            Publish occupancy
          </Button>
        }
      />

      {config && (
        <Card className="mb-6">
          <p className="text-sm text-slate-300">
            Integration {config.enabled ? 'enabled' : 'disabled'} · Drivers:{' '}
            {Object.keys(drivers).join(', ')} · Business hours {config.business_hours_start}–
            {config.business_hours_end} ({config.business_timezone})
          </p>
          {Object.keys(eventTypes).length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm text-slate-400">
              {Object.entries(eventTypes).map(([k, v]) => (
                <li key={k}>
                  {k}: {v}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="mb-6">
        <h2 className="mb-4 text-lg font-medium">Add connector</h2>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Label>
            Name
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Label>
          <Label>
            Driver
            <Select value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })}>
              {Object.entries(drivers).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Label>
          <Label className="sm:col-span-2">
            Webhook URL
            <Input
              value={form.endpoint_url}
              onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
              placeholder="https://bms.example.com/hooks/attendance"
            />
          </Label>
          <div className="sm:col-span-2">
            <Button type="submit">Create connector</Button>
          </div>
        </form>
      </Card>

      <div className="mb-6">
        <TableShell>
          <TableHead>
            <Th>Name</Th>
            <Th>Driver</Th>
            <Th>Events today</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {connectors.map((c) => (
              <tr key={c.id}>
                <Td>{c.name}</Td>
                <Td>{c.driver}</Td>
                <Td>{c.events_today}</Td>
                <Td>
                  <Badge tone={c.is_active ? 'ok' : 'neutral'}>{c.is_active ? 'Active' : 'Off'}</Badge>
                </Td>
                <Td>
                  <Button variant="ghost" onClick={() => testConnector(c.id)}>
                    Test
                  </Button>
                </Td>
              </tr>
            ))}
          </TableBody>
        </TableShell>
      </div>

      <h2 className="mb-3 text-lg font-medium">Recent building events</h2>
      <TableShell>
        <TableHead>
          <Th>Time</Th>
          <Th>Connector</Th>
          <Th>Event</Th>
          <Th>Status</Th>
        </TableHead>
        <TableBody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <Td className="text-xs">
                {ev.created_at ? new Date(ev.created_at).toLocaleString() : '—'}
              </Td>
              <Td>{ev.connector?.name ?? '—'}</Td>
              <Td>{ev.event_type}</Td>
              <Td>
                <Badge tone={ev.status === 'sent' ? 'ok' : ev.status === 'failed' ? 'danger' : 'neutral'}>
                  {ev.status}
                </Badge>
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
