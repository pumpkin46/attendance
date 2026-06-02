export interface User {
  id: number
  name: string
  email: string
  roles?: Role[]
  organization?: { id: number; name: string }
}

export interface Role {
  id: number
  name: string
  label: string
  permissions?: Permission[]
}

export interface Permission {
  id: number
  name: string
  label: string
}

export interface Employee {
  id: number
  employee_code: string
  first_name: string
  last_name: string
  email?: string
  department?: string
  job_title?: string
  is_active: boolean
  face_enrolled: boolean
  face_enrolled_at?: string
  active_rfid_cards_count?: number
  location?: { id: number; name: string }
}

export interface RfidReader {
  id: number
  name: string
  device_id: string
  direction: 'in' | 'out' | 'both'
  is_active: boolean
  online?: boolean
  last_heartbeat_at?: string
  taps_today?: number
  location?: { id: number; name: string }
}

export interface RfidEvent {
  id: number
  uid: string
  result: string
  tapped_at: string
  metadata?: { attendance_action?: string }
  employee?: { id: number; first_name: string; last_name: string }
  reader?: { id: number; name: string }
}

export interface AttendanceRecord {
  id: number
  work_date: string
  check_in_at?: string
  check_out_at?: string
  status: string
  worked_minutes: number
  overtime_minutes: number
  employee?: Employee
}

export interface Camera {
  id: number
  name: string
  device_id: string
  stream_url?: string
  direction: string
  status: 'active' | 'inactive' | 'maintenance'
  is_active: boolean
  online?: boolean
  frame_rate_fps?: number | null
  last_heartbeat_at?: string
  last_frame_at?: string
  recognition_count_today?: number
  location?: { id: number; name: string }
}

export interface CameraMonitoringSummary {
  online: number
  offline: number
  total: number
  recognition_count_today: number
  cameras: Camera[]
}

export interface RecognitionEvent {
  id: number
  camera_id?: number
  result: string
  confidence?: number
  snapshot_path?: string
  snapshot_url?: string
  notified_at?: string
  recognized_at: string
  metadata?: { source?: string; alert_sent?: boolean }
  camera?: { id: number; name: string }
}

export interface Paginated<T> {
  data: T[]
  current_page: number
  last_page: number
  total: number
}
