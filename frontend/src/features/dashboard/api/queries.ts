import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { useAuthedWebSocket } from '@/shared/hooks/useAuthedWebSocket'
import type { LiveEvent, MonitoringDashboard } from '@/features/dashboard/types'

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

/**
 * Live monitoring feed. Opens a WebSocket that pushes the dashboard + live feed
 * every ~3s and writes them into the query cache, so the counters tick smoothly
 * without per-event refetching. Auto-reconnects on drop.
 */
export function useMonitoringFeed() {
  const qc = useQueryClient()
  const onMessage = useCallback(
    (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return
      try {
        const msg = JSON.parse(ev.data) as {
          dashboard?: MonitoringDashboard
          live_feed?: { events: LiveEvent[] }
        }
        if (msg.dashboard) qc.setQueryData(monitoringKeys.dashboard, msg.dashboard)
        if (msg.live_feed) qc.setQueryData(monitoringKeys.liveFeed, msg.live_feed)
      } catch {
        /* ignore malformed frame */
      }
    },
    [qc]
  )
  useAuthedWebSocket({ path: '/monitoring/ws', onMessage })
}
