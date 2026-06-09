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
  branches_count?: number
  departments_count?: number
  employees_count?: number
}

export interface Branch {
  id: number
  name: string
  code: string
  organization_id: number
}

export interface Department {
  id: number
  name: string
  code: string
  branch?: { name: string }
}

export interface CreateOrganizationPayload {
  name: string
  code: string
  timezone: string
}

// ── AI security monitoring ───────────────────────────────────────────────────

export interface SecurityAlert {
  id: number
  organization_id: number
  alert_type: string
  severity: string
  title: string
  description?: string | null
  camera_id?: number | null
  access_point_id?: number | null
  snapshot_path?: string | null
  metadata_json?: Record<string, unknown> | null
  status: string
  acknowledged_at?: string | null
  resolved_at?: string | null
  created_at?: string | null
}

export interface SecurityDashboard {
  total_alerts: number
  open_alerts: number
  acknowledged_alerts: number
  resolved_alerts: number
  by_severity: Record<string, number>
  by_type: Record<string, number>
  recent_alerts: SecurityAlert[]
}

export interface SecurityMonitoringConfig {
  enabled: boolean
  after_hours_start: string
  after_hours_end: string
  tailgating_window: number
  alert_cooldown: number
}

export const SECURITY_SEVERITY_TONE: Record<string, 'danger' | 'warn' | 'ok' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
}
