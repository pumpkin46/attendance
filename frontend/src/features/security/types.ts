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

export interface Location {
  id: number
  name: string
  organization_id: number
  branch_id?: number | null
  address?: string | null
  timezone: string
  is_active: boolean
  created_at?: string | null
  branch?: { id: number; name: string } | null
}

export interface CreateLocationPayload {
  name: string
  address?: string | null
  timezone: string
  branch_id?: number | null
  /** Only honoured for super admins operating without a tenant header. */
  organization_id?: number
}

export interface UpdateLocationPayload {
  name?: string
  address?: string | null
  timezone?: string
  branch_id?: number | null
  is_active?: boolean
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
