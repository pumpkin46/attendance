// ── AI security monitoring (the Reports page) ────────────────────────────────

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'
export type AlertStatus = 'open' | 'acknowledged' | 'resolved'

export interface SecurityAlert {
  id: number
  organization_id?: number | null
  alert_type: string
  severity: AlertSeverity
  title: string
  description?: string | null
  camera_id?: number | null
  employee_id?: number | null
  recognition_event_id?: number | null
  camera?: { id: number; name: string } | null
  employee?: {
    id: number
    first_name: string
    last_name: string
    employee_code?: string | null
  } | null
  snapshot_path?: string | null
  metadata_json?: Record<string, unknown> | null
  status: AlertStatus
  acknowledged_at?: string | null
  acknowledged_by?: number | null
  resolved_at?: string | null
  resolved_by?: number | null
  occurred_at?: string | null
  created_at?: string | null
}

export interface AlertTrendPoint {
  day: string
  count: number
}

export interface SecurityDashboard {
  total_alerts: number
  open_alerts: number
  acknowledged_alerts: number
  resolved_alerts: number
  by_severity: Record<string, number>
  by_type: Record<string, number>
  trend: AlertTrendPoint[]
  recent_alerts: SecurityAlert[]
}

export interface SecurityMonitoringConfig {
  enabled: boolean
  after_hours_start: string
  after_hours_end: string
  tailgating_window: number
  alert_cooldown: number
}

export interface SecurityAlertFilters {
  status?: string
  severity?: string
  alert_type?: string
  q?: string
  date_from?: string
  date_to?: string
  page?: number
  per_page?: number
}

export type SecurityExportFormat = 'csv' | 'xlsx' | 'pdf'

/** Labels for the alert types the detection engine raises. */
export const ALERT_TYPE_LABELS: Record<string, string> = {
  unknown_person: 'Unknown person',
  spoof_attempt: 'Spoof attempt',
  after_hours_access: 'After-hours access',
  tailgating: 'Tailgating',
}

// ── Attendance export (the Attendance page's export buttons) ─────────────────

export type ExportFormat = 'csv' | 'xlsx' | 'pdf'
