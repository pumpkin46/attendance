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
  nodes_count?: number
  employees_count?: number
}

/** A node in the self-referential organization tree (company → sub-units). */
export interface OrgNode {
  id: number
  name: string
  code: string
  node_type: string
  parent_id: number | null
  root_organization_id: number
  timezone: string
  depth: number
  path: string
  is_active: boolean
  created_at?: string | null
  updated_at?: string | null
  children?: OrgNode[] | null
}

export interface OrgNodeBreadcrumb {
  id: number
  name: string
  node_type: string
}

export interface OrgNodeDetail extends OrgNode {
  /** Ancestors root→parent, excludes self. */
  breadcrumb: OrgNodeBreadcrumb[]
}

export interface CreateOrgNodePayload {
  name: string
  code: string
  parent_id: number
  node_type?: string
  timezone?: string
}

export interface UpdateOrgNodePayload {
  name?: string
  code?: string
  node_type?: string
  timezone?: string
  is_active?: boolean
}

export interface MoveOrgNodePayload {
  new_parent_id: number
}

export interface Location {
  id: number
  name: string
  organization_id: number
  address?: string | null
  timezone: string
  is_active: boolean
  created_at?: string | null
  updated_at?: string | null
}

export interface CreateLocationPayload {
  name: string
  address?: string | null
  timezone: string
  org_node_id?: number | null
  /** Only honoured for super admins operating without a tenant header. */
  organization_id?: number
}

export interface UpdateLocationPayload {
  name?: string
  address?: string | null
  timezone?: string
  org_node_id?: number | null
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
