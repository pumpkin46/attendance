import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { DailyReport, MonthlyReport } from '@/features/reports/types'

export const reportKeys = {
  daily: (date: string) => ['reports', 'daily', date] as const,
  monthly: (year: string, month: string) => ['reports', 'monthly', year, month] as const,
}

export function useDailyReport(date: string, enabled: boolean) {
  return useApiQuery<DailyReport>(reportKeys.daily(date), '/reports/daily', { date }, { enabled })
}

export function useMonthlyReport(year: string, month: string, enabled: boolean) {
  return useApiQuery<MonthlyReport>(
    reportKeys.monthly(year, month),
    '/reports/monthly',
    { year, month },
    { enabled }
  )
}

/**
 * Fetch an export file (csv/xlsx/pdf) for client-side download. The filename
 * comes from the response's Content-Disposition — the backend is the single
 * source of truth for naming.
 */
export async function fetchReportExport(
  params: Record<string, string | undefined>
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await api.get<Blob>('/reports/export', { params, responseType: 'blob' })
  const disposition = res.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return { blob: res.data, filename: match?.[1] ?? null }
}
