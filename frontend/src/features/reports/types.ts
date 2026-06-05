export interface DailyReport {
  date: string
  present: number
  absent: number
  late: number
  on_leave: number
  employees: Array<{
    employee_code: string
    employee_name: string
    status: string
    check_in_at?: string
    check_out_at?: string
    worked_minutes: number
    overtime_minutes: number
  }>
}

export interface MonthlyReport {
  year: number
  month: number
  total_working_days: number
  summary: {
    total_working_days: number
    attendance_percent: number
    overtime_minutes: number
    absence_count: number
  }
  employees: Array<{
    employee_code: string
    employee_name: string
    department?: string
    total_working_days: number
    attendance_percent: number
    overtime_hours: number
    absence_count: number
    late_count: number
    on_leave_count: number
  }>
}

export type ReportTab = 'daily' | 'monthly'
export type ExportFormat = 'csv' | 'xlsx' | 'pdf'
