import { useEffect, useState } from 'react'
import { api } from '../api/client'
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
      <h1>Camera Management</h1>
      <p className="muted">Multi-camera deployment and health monitoring</p>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Total cameras</span>
          <span className="stat-value">{cameras.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Online</span>
          <span className="stat-value">{cameras.filter(isOnline).length}</span>
        </div>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Device ID</th>
              <th>Location</th>
              <th>Direction</th>
              <th>Status</th>
              <th>Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.device_id}</td>
                <td>{c.location?.name ?? '—'}</td>
                <td>{c.direction}</td>
                <td>
                  <span className={isOnline(c) ? 'badge badge-ok' : 'badge badge-warn'}>
                    {isOnline(c) ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td>{c.last_heartbeat_at ? new Date(c.last_heartbeat_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
