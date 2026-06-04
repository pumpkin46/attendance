import { useState, type FormEvent } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import {
  useBuildingConfig,
  useBuildingEvents,
  useConnectors,
  useCreateConnector,
  usePublishOccupancy,
  useTestConnector,
} from './building/queries'

const DRIVER_FALLBACK: Record<string, string> = {
  webhook: 'Webhook',
  mqtt: 'MQTT',
  bacnet_gateway: 'BACnet Gateway',
}

export default function SmartBuildingPage() {
  const { data: config } = useBuildingConfig()
  const { data: connectorsData, isPending: connectorsLoading } = useConnectors()
  const { data: eventsData, isPending: eventsLoading } = useBuildingEvents()
  const createConnector = useCreateConnector()
  const testConnector = useTestConnector()
  const publishOccupancyMutation = usePublishOccupancy()

  const [form, setForm] = useState({
    name: '',
    driver: 'webhook',
    endpoint_url: '',
  })

  const connectors = connectorsData?.data ?? []
  const events = eventsData?.data ?? []
  const drivers = config?.drivers ?? DRIVER_FALLBACK
  const eventTypes = config?.event_types ?? {}

  const submit = (e: FormEvent) => {
    e.preventDefault()
    createConnector.mutate(
      {
        name: form.name,
        driver: form.driver,
        endpoint_url: form.endpoint_url || null,
        subscribed_events: config?.default_subscribed_events,
      },
      {
        onSuccess: () => setForm({ name: '', driver: 'webhook', endpoint_url: '' }),
      }
    )
  }

  const publishOccupancy = () => {
    const locationId = window.prompt('Location ID for occupancy update:', '1')
    if (!locationId) return
    const count = window.prompt('Occupant count:', '0')
    if (count === null) return
    publishOccupancyMutation.mutate({
      location_id: Number(locationId),
      count: Number(count),
    })
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
            <Button type="submit" disabled={createConnector.isPending}>
              Create connector
            </Button>
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
            {connectorsLoading ? (
              <tr>
                <Td colSpan={5} className="text-slate-400">
                  Loading…
                </Td>
              </tr>
            ) : (
              connectors.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td>{c.driver}</Td>
                  <Td>{c.events_today}</Td>
                  <Td>
                    <Badge tone={c.is_active ? 'ok' : 'neutral'}>{c.is_active ? 'Active' : 'Off'}</Badge>
                  </Td>
                  <Td>
                    <Button
                      variant="ghost"
                      onClick={() => testConnector.mutate(c.id)}
                      disabled={testConnector.isPending}
                    >
                      Test
                    </Button>
                  </Td>
                </tr>
              ))
            )}
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
          {eventsLoading ? (
            <tr>
              <Td colSpan={4} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : (
            events.map((ev) => (
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
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
