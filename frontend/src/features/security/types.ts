export interface SecurityConfig {
  authentication: {
    jwt: { enabled: boolean; token_type: string }
    oauth2: { enabled: boolean; providers: string[] }
    saml: { enabled: boolean }
    ldap: { enabled: boolean }
  }
  authorization: { model: string; roles: Record<string, string> }
  encryption: {
    in_transit: { protocol: string; force_https: boolean }
    at_rest: { cipher: string }
    secrets: { driver: string; vault_configured: boolean; kms_configured: boolean }
  }
  tenancy: {
    isolation_enabled: boolean
    supports: Record<string, boolean>
  }
}

export interface Organization {
  id: number
  name: string
  code: string
  timezone: string
  is_active: boolean
  created_at?: string | null
  branches_count?: number
  departments_count?: number
  employees_count?: number
}

export interface Branch {
  id: number
  name: string
  code: string
  organization_id: number
  address?: string | null
  timezone: string
  is_active: boolean
  created_at?: string | null
}

export interface Department {
  id: number
  name: string
  code: string
  organization_id: number
  branch_id?: number | null
  is_active: boolean
  created_at?: string | null
  branch?: { id: number; name: string } | null
}

export interface CreateOrganizationPayload {
  name: string
  code: string
  timezone: string
}

export interface UpdateOrganizationPayload {
  name?: string
  code?: string
  timezone?: string
  is_active?: boolean
}

export interface CreateBranchPayload {
  name: string
  code: string
  address?: string | null
  timezone: string
  /** Only honoured for super admins operating without a tenant header. */
  organization_id?: number
}

export interface UpdateBranchPayload {
  name?: string
  code?: string
  address?: string | null
  timezone?: string
  is_active?: boolean
}

export interface CreateDepartmentPayload {
  name: string
  code: string
  branch_id?: number | null
  /** Only honoured for super admins operating without a tenant header. */
  organization_id?: number
}

export interface UpdateDepartmentPayload {
  name?: string
  code?: string
  branch_id?: number | null
  is_active?: boolean
}

// ── AI security monitoring ───────────────────────────────────────────────────

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

export type SecurityExportFormat = 'csv' | 'xlsx'

/** Labels for the alert types the detection engine raises. */
export const ALERT_TYPE_LABELS: Record<string, string> = {
  unknown_person: 'Unknown person',
  spoof_attempt: 'Spoof attempt',
  after_hours_access: 'After-hours access',
  tailgating: 'Tailgating',
}
