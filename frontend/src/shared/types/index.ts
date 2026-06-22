export interface User {
  id: number
  name: string
  email: string
  roles?: Role[]
  /** Org-tree nodes this user is granted (a company or any sub-unit); drives their read scope. */
  organizations?: { id: number; name: string }[]
  auth_provider?: string
  email_verified_at?: string | null
  is_active?: boolean
  created_at?: string | null
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
  /** Free-text department label. */
  department?: string
  job_title?: string
  hire_date?: string
  is_active: boolean
  face_enrolled: boolean
  face_enrolled_at?: string
  active_rfid_cards_count?: number
  location_id?: number | null
  /** The org-tree node the employee belongs to (company root or any sub-unit). */
  organization_id?: number | null
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
  attendance_type?: string
  worked_minutes: number
  overtime_minutes: number
  employee?: Employee
}

export interface Shift {
  id: number
  name: string
  type: 'fixed' | 'rotational' | 'flexible' | 'split'
  rotation_slot?: string
  start_time: string
  end_time: string
  segments?: { start: string; end: string }[]
  grace_minutes: number
  is_active: boolean
}

export interface CameraHealth {
  online: boolean
  fps: number | null
  latency_ms: number | null
  bandwidth_kbps: number | null
  cpu_usage_percent: number | null
  gpu_usage_percent: number | null
  dropped_frames: number
  recognition_events_today: number
  updated_at?: string
}

export interface Camera {
  id: number
  name: string
  camera_type?: string
  zone?: string
  floor?: string
  device_id: string
  stream_url?: string
  target_fps?: number
  resolution?: string
  resolution_width?: number
  resolution_height?: number
  direction: string
  deployment_mode?: 'cloud' | 'edge'
  status: 'active' | 'inactive' | 'maintenance'
  is_active: boolean
  online?: boolean
  health?: CameraHealth
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
  liveness_passed?: boolean | null
  processing_ms?: number | null
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

export interface AttendanceAnomaly {
  id: number
  employee_id: number
  attendance_record_id?: number
  anomaly_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  score: number
  title: string
  description: string
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive'
  detected_at: string
  acknowledged_at?: string | null
  acknowledged_by?: number | null
  resolved_at?: string | null
  detection_run_id?: string | null
  evidence?: Record<string, unknown>
  employee?: { id: number; first_name: string; last_name: string; employee_code: string }
}

export interface AnomalySummary {
  open_total: number
  critical: number
  high: number
  medium: number
  low: number
  by_type: Record<string, number>
}

export interface NfrCompliance {
  nfr?: {
    'NFR-007'?: { argon2_compliant?: boolean; hasher?: string }
    'NFR-008'?: { enabled?: boolean }
  }
}

export interface PlatformHealth {
  status?: string
  antispoof_model_loaded?: boolean
  nfr_compliance?: NfrCompliance
}
