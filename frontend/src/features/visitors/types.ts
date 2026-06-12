export interface Host {
  id: number
  first_name: string
  last_name: string
  employee_code?: string
  department?: string
}

export interface Visitor {
  id: number
  visitor_code?: string
  name: string
  first_name?: string
  last_name?: string
  company?: string
  phone?: string
  email?: string
  purpose?: string
  visit_start_at: string
  visit_end_at: string
  status: string
  approval_status?: string
  visitor_category?: string
  visit_type?: string
  visit_description?: string
  face_registered: boolean
  check_in_code?: string
  badge_number?: string
  pin_code?: string
  face_expires_at?: string
  checked_in_at?: string
  checked_out_at?: string
  current_zone?: string
  photo_url?: string
  nationality?: string
  id_number?: string
  vehicle_number?: string
  parking_zone?: string
  created_at?: string
  host?: Host
}

export interface VisitorPhoto {
  id: number
  visitor_id: number
  url: string
  is_primary: boolean
  caption?: string
  created_at?: string
}

export interface VisitorDocument {
  id: number
  visitor_id: number
  document_type: string
  url: string
  filename?: string
  notes?: string
  created_at?: string
}

export interface VisitorAccessPermission {
  id: number
  visitor_id: number
  zone_name: string
  granted: boolean
  expires_at?: string
}

export interface VisitorLogEntry {
  id: number
  visitor_id: number
  event_type: string
  description?: string
  user_id?: number
  created_at?: string
}

export interface DashboardStats {
  on_site: number
  expected: number
  checked_in_today: number
  checked_out_today: number
  overdue: number
  pending_approval: number
}

export interface BlacklistEntry {
  id: number
  name: string
  id_number?: string
  reason: string
  notes?: string
  is_active: boolean
}

export type VisitorTab =
  | 'dashboard'
  | 'visitors'
  | 'active'
  | 'approvals'
  | 'blacklist'

export const VISITOR_CATEGORIES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'pre_registered', label: 'Pre-registered' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'interview_candidate', label: 'Interview candidate' },
  { value: 'temporary_staff', label: 'Temporary staff' },
  { value: 'government_official', label: 'Government official' },
  { value: 'delivery', label: 'Delivery' },
]

export const VISIT_TYPES = [
  { value: 'business_meeting', label: 'Business meeting' },
  { value: 'interview', label: 'Interview' },
  { value: 'vendor_visit', label: 'Vendor visit' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'training', label: 'Training' },
  { value: 'contractor_work', label: 'Contractor work' },
  { value: 'government_visit', label: 'Government visit' },
  { value: 'audit', label: 'Audit' },
  { value: 'guest_visit', label: 'Guest visit' },
]

export const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  checked_in: 'ok',
  scheduled: 'neutral',
  pending_approval: 'warn',
  checked_out: 'neutral',
  expired: 'danger',
  cancelled: 'danger',
}

export function formatDuration(start: string) {
  const ms = Date.now() - new Date(start).getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
