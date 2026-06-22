import type { Camera } from '@/shared/types'

export interface MonitoringDashboard {
  active_cameras: number
  total_cameras: number
  employees_present: number
  employees_absent: number
  employees_late: number
  employees_on_leave: number
  total_employees: number
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

export interface AttendanceTrendDay {
  /** ISO calendar date (YYYY-MM-DD), local to the organization. */
  date: string
  on_time: number
  late: number
  total: number
}

export interface AttendanceTrend {
  days: AttendanceTrendDay[]
}

export interface LiveEvent {
  id: string | number
  event_type: string
  message: string
  occurred_at: string
  /** Event-specific details, e.g. recognition_event_id / confidence / liveness_passed / reason. */
  payload?: Record<string, unknown> | null
  camera_id?: number | null
  employee_id?: number | null
  visitor_id?: number | null
}
