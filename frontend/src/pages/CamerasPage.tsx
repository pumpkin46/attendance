import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Camera } from '../types'

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([])

  useEffect(() => {
    api.get<Camera[]>('/cameras').then((r) => setCameras(r.data))
  }, [])

  const isOnline = (c: Camera) => {
    if (!c.last_heartbeat_at) return false
    return Date.now() - new Date(c.last_heartbeat_at).getTime() < 120_000
  }

  return (
    <div>
      <PageHeader title="Camera Management" description="Multi-camera deployment and health monitoring" />

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        <StatCard label="Total cameras" value={cameras.length} />
        <StatCard label="Online" value={cameras.filter(isOnline).length} />
      </div>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Device ID</Th>
          <Th>Location</Th>
          <Th>Direction</Th>
          <Th>Status</Th>
          <Th>Last heartbeat</Th>
        </TableHead>
        <TableBody>
          {cameras.map((c) => (
            <tr key={c.id}>
              <Td>{c.name}</Td>
              <Td>{c.device_id}</Td>
              <Td>{c.location?.name ?? '—'}</Td>
              <Td>{c.direction}</Td>
              <Td>
                <Badge tone={isOnline(c) ? 'ok' : 'warn'}>
                  {isOnline(c) ? 'Online' : 'Offline'}
                </Badge>
              </Td>
              <Td>{c.last_heartbeat_at ? new Date(c.last_heartbeat_at).toLocaleString() : '—'}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
