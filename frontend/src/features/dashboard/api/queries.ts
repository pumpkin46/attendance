import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { CameraMonitoringSummary, PlatformHealth } from '@/shared/types'
import type { AppNotification, TodaySummary, UnknownSummary } from '@/features/dashboard/types'

export { useAnomalySummary } from '@/features/anomalies/api/queries'

export function useTodaySummary() {
  return useApiQuery<TodaySummary>(['attendance', 'today'], '/attendance/today', undefined, {
    silent: true,
  })
}

export function useUnknownSummary() {
  return useApiQuery<UnknownSummary>(
    ['recognition', 'unknown-summary'],
    '/recognition/unknown-summary',
    undefined,
    { silent: true }
  )
}

export function useCameraMonitoring() {
  // Live via WebSocket 'cameras.changed'; resynced on reconnect.
  return useApiQuery<CameraMonitoringSummary>(
    ['cameras', 'monitoring'],
    '/cameras/monitoring',
    undefined,
    { silent: true }
  )
}

export function usePlatformHealth() {
  return useApiQuery<PlatformHealth>(['health'], '/health', undefined, { silent: true })
}

export function useUnreadAlerts() {
  return useApiQuery<{ data: AppNotification[] }>(
    ['notifications', 'unread'],
    '/notifications',
    { unread_only: true, per_page: 5 },
    { silent: true }
  )
}
