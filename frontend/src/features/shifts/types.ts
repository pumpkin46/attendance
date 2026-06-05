export interface AttendanceConfig {
  shift_types?: Record<
    string,
    { label: string; example?: string; description?: string; slots?: string[] }
  >
}

export const SHIFT_TYPE_FALLBACK: NonNullable<AttendanceConfig['shift_types']> = {
  fixed: { label: 'Fixed Shift', example: '09:00–18:00' },
  rotational: { label: 'Rotational Shift', slots: ['morning', 'evening', 'night'] },
  flexible: { label: 'Flexible Shift', description: 'Employee defines start time' },
  split: { label: 'Split Shift', example: '08:00–12:00, 14:00–18:00' },
}

export interface AttendancePolicy {
  id: number
  name: string
  grace_minutes: number
  min_work_minutes: number
  max_work_minutes: number
  break_minutes: number
  overtime_after_minutes: number
  half_day_minutes: number
  is_default: boolean
  is_active: boolean
}

export interface Holiday {
  id: number
  name: string
  date: string
  is_recurring: boolean
  location_id?: number | null
}

export interface LeaveRequest {
  id: number
  employee_id: number
  type: string
  start_date: string
  end_date: string
  reason?: string | null
  status: 'pending' | 'approved' | 'rejected'
  approved_at?: string | null
}
