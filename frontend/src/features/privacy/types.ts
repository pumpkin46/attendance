export interface PrivacyPolicy {
  gdpr_enabled: boolean
  retention_audit_logs_days: number
  retention_recognition_events_days: number
  privacy_contact_email: string | null
  data_collected: string[]
  data_purposes: string[]
}

export interface MyData {
  user: { id: number; name: string | null; email: string | null }
  attendance_records: unknown[]
  audit_logs_count: number
}
