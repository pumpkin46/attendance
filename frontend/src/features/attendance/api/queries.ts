import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { AttendanceRecord, Paginated } from '@/shared/types'

export interface ManualAttendanceForm {
  employee_id: string
  work_date: string
  check_in_at: string
  check_out_at: string
  notes: string
}

export const attendanceKeys = {
  all: ['attendance'] as const,
  list: (from: string, to: string) => ['attendance', 'list', { from, to }] as const,
}

export function useAttendanceRecords(dateFrom: string, dateTo: string) {
  return useApiQuery<Paginated<AttendanceRecord>>(
    attendanceKeys.list(dateFrom, dateTo),
    '/attendance',
    // Empty bounds (open-ended range) are omitted — the API expects a date or no param.
    { date_from: dateFrom || undefined, date_to: dateTo || undefined, per_page: 100 }
  )
}

export function useRecordManualAttendance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (form: ManualAttendanceForm) =>
      api.post('/attendance/manual', {
        employee_id: Number(form.employee_id),
        work_date: form.work_date,
        check_in_at: form.check_in_at || null,
        check_out_at: form.check_out_at || null,
        notes: form.notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Attendance recorded')
      void qc.invalidateQueries({ queryKey: attendanceKeys.all })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}
