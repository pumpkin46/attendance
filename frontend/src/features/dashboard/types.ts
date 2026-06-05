export interface TodaySummary {
  date: string
  present: number
  absent: number
  late: number
  on_leave: number
}

export interface UnknownSummary {
  today: number
  unreviewed: number
}

export interface AppNotification {
  id: string
  data: {
    type: string
    message: string
    recognized_at: string
    camera_name?: string
  }
  read_at?: string
  created_at: string
}
