import type { Camera } from '@/shared/types'

export interface MonitoringDashboard {
  active_cameras: number
  total_cameras: number
  employees_present: number
  employees_absent: number
  employees_late: number
  unknown_persons_today: number
  active_visitors: number
  camera_health: {
    online: number
    offline: number
    avg_fps: number | null
    avg_latency_ms: number | null
    total_dropped_frames: number
  }
  cameras: Camera[]
}

export interface LiveEvent {
  id: string | number
  event_type: string
  message: string
  occurred_at: string
}
