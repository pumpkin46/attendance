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
