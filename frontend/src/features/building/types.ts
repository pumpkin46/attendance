export interface BuildingConfig {
  enabled: boolean
  webhook_timeout: number
  business_hours_start: string
  business_hours_end: string
  business_timezone: string
  drivers?: Record<string, string>
  event_types?: Record<string, string>
  default_subscribed_events?: string[]
}

export interface Connector {
  id: number
  name: string
  driver: string
  endpoint_url?: string
  subscribed_events?: string[]
  is_active: boolean
  last_sync_at?: string
  events_today: number
}

export interface BuildingEvent {
  id: number
  event_type: string
  status: string
  error_message?: string
  created_at: string
  connector?: { id: number; name: string }
}

export interface CreateConnectorPayload {
  name: string
  driver: string
  endpoint_url?: string | null
  subscribed_events?: string[]
}

export interface PublishOccupancyPayload {
  location_id: number
  count: number
}
