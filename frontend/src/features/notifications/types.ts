export interface Notification {
  id: string
  type: string
  data?: { message?: string; title?: string } & Record<string, unknown>
  read_at: string | null
  created_at: string | null
}
