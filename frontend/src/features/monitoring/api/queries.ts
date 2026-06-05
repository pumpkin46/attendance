import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { LiveEvent, MonitoringDashboard } from '@/features/monitoring/types'

export const monitoringKeys = {
  dashboard: ['monitoring', 'dashboard'] as const,
  liveFeed: ['monitoring', 'live-feed'] as const,
}

/** `poll` comes from `useFallbackPoll` — undefined while the socket is healthy. */
export function useMonitoringDashboard(poll: number | undefined) {
  return useApiQuery<MonitoringDashboard>(
    monitoringKeys.dashboard,
    '/monitoring/dashboard',
    undefined,
    { silent: true, refetchInterval: poll }
  )
}

export function useMonitoringLiveFeed(poll: number | undefined) {
  return useApiQuery<{ events: LiveEvent[] }>(
    monitoringKeys.liveFeed,
    '/monitoring/live-feed',
    { limit: 40 },
    { silent: true, refetchInterval: poll }
  )
}
