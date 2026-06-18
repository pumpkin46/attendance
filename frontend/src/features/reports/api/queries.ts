import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'
import type {
  SecurityAlert,
  SecurityAlertFilters,
  SecurityDashboard,
  SecurityMonitoringConfig,
} from '@/features/reports/types'

export const securityMonitoringKeys = {
  all: ['security-monitoring'] as const,
  config: ['security-monitoring', 'config'] as const,
  dashboard: ['security-monitoring', 'dashboard'] as const,
  alerts: ['security-monitoring', 'alerts'] as const,
  alertList: (filters: SecurityAlertFilters) =>
    ['security-monitoring', 'alerts', filters] as const,
}

/** All times the API filters/aggregates on are shifted to the viewer's day. */
const tzOffset = () => new Date().getTimezoneOffset()

export function useSecurityMonitoringConfig() {
  return useApiQuery<SecurityMonitoringConfig>(
    securityMonitoringKeys.config,
    '/security-monitoring/config',
    undefined,
    { silent: true, staleTime: STATIC_STALE_MS }
  )
}

/** `poll` comes from `useFallbackPoll` — undefined while the socket is healthy. */
export function useSecurityDashboard(poll: number | undefined) {
  return useApiQuery<SecurityDashboard>(
    securityMonitoringKeys.dashboard,
    '/security-monitoring/dashboard',
    { tz_offset: tzOffset() },
    { silent: true, refetchInterval: poll }
  )
}

export function useSecurityAlerts(filters: SecurityAlertFilters, poll: number | undefined) {
  return useApiQuery<Paginated<SecurityAlert>>(
    securityMonitoringKeys.alertList(filters),
    '/security-monitoring/alerts',
    { ...filters, tz_offset: tzOffset() },
    { silent: true, refetchInterval: poll, keepPreviousData: true }
  )
}

/**
 * Fetch a security-alert export (csv/xlsx/pdf) for client-side download. The
 * filename comes from the response's Content-Disposition — the backend is the
 * single source of truth for naming.
 */
export async function fetchSecurityAlertExport(
  params: Record<string, string | number | undefined>
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await api.get<Blob>('/security-monitoring/alerts/export', {
    params: { ...params, tz_offset: tzOffset() },
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return { blob: res.data, filename: match?.[1] ?? null }
}

/** Alert mutations change the alert list and the dashboard counters — config is static and never refetched here. */
function useInvalidateAlerts() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: securityMonitoringKeys.alerts })
    void qc.invalidateQueries({ queryKey: securityMonitoringKeys.dashboard })
  }
}

export function useAcknowledgeAlert() {
  const invalidate = useInvalidateAlerts()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<SecurityAlert>(
        `/security-monitoring/alerts/${id}/acknowledge`
      )
      return data
    },
    onSuccess: invalidate,
  })
}

export function useResolveAlert() {
  const invalidate = useInvalidateAlerts()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<SecurityAlert>(
        `/security-monitoring/alerts/${id}/resolve`
      )
      return data
    },
    onSuccess: invalidate,
  })
}

/**
 * Fetch an attendance export file (csv/xlsx/pdf) for client-side download
 * (the Attendance page's export buttons).
 */
export async function fetchReportExport(
  params: Record<string, string | undefined>
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await api.get<Blob>('/reports/export', { params, responseType: 'blob' })
  const disposition = res.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return { blob: res.data, filename: match?.[1] ?? null }
}
