export interface AccessPoint {
  id: number
  name: string
  device_type: string
  default_action: string
  controller_url?: string
  is_active: boolean
  camera?: { id: number; name: string }
}

export interface AccessConfig {
  actions: Record<string, string>
  device_types: Record<string, string>
  grant_conditions: Record<string, boolean>
}

export interface FaceGrantResult {
  granted: boolean
  identity_type?: string
  visitor_id?: number
  employee_id?: number
  confidence: number
  deny_reason?: string
  action?: string
}

export interface CreateAccessPointPayload {
  organization_id: number
  name: string
  device_type: string
  default_action: string
  controller_url: string | null
  camera_id: number | null
}
