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
  alert_type: string
  severity: string
  title: string
  message: string
  status: string
  occurred_at: string
  camera?: { name: string }
  employee?: { first_name: string; last_name: string }
}

export interface SecurityDashboard {
  open_total: number
  critical_open: number
  high_open: number
  today_total: number
  by_type: Record<string, number>
  recent: SecurityAlert[]
}

export const SECURITY_SEVERITY_TONE: Record<string, 'danger' | 'warn' | 'ok' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warn',
  low: 'neutral',
}
