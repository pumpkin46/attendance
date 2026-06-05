export interface AuditLog {
  id: number
  action: string
  entity_type?: string
  entity_id?: number
  ip_address?: string
  created_at: string
  user?: { name: string; email: string }
}
