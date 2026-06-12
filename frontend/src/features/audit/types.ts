export interface AuditActor {
  id: number
  name: string
  email: string
}

export interface AuditLog {
  id: number
  user_id?: number | null
  user?: AuditActor | null
  action: string
  entity_type?: string | null
  entity_id?: number | null
  ip_address?: string | null
  user_agent?: string | null
  old_values?: Record<string, unknown> | null
  new_values?: Record<string, unknown> | null
  created_at: string
}

export interface AuditStats {
  total: number
  today: number
  actors: number
  action_types: number
}

export interface AuditFacets {
  actions: string[]
  entity_types: string[]
  actors: AuditActor[]
}

/** Server-side list filters; empty strings are normalised out before the request. */
export interface AuditLogFilters {
  q?: string
  action?: string
  entity_type?: string
  user_id?: number
  date_from?: string
  date_to?: string
  page: number
  per_page: number
}

export type AuditExportFormat = 'csv' | 'xlsx'
