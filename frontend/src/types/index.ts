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
  location?: { id: number; name: string }
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
  direction: string
  is_active: boolean
  last_heartbeat_at?: string
  location?: { id: number; name: string }
}

export interface Paginated<T> {
  data: T[]
  current_page: number
  last_page: number
  total: number
}
