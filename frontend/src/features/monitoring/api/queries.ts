import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { getToken } from '@/shared/lib/session'
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

/**
 * Live monitoring feed. Opens a WebSocket that pushes the dashboard + live feed
 * every ~3s and writes them into the query cache, so the counters tick smoothly
 * without per-event refetching. Auto-reconnects on drop.
 */
export function useMonitoringFeed() {
  const qc = useQueryClient()
  useEffect(() => {
    const token = getToken()
    if (!token) return

    const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
    const httpBase = /^https?:\/\//.test(apiBase) ? apiBase : window.location.origin + apiBase
    const wsUrl = `${httpBase.replace(/^http/, 'ws')}/monitoring/ws`

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (cancelled) return
      ws = new WebSocket(wsUrl, ['bearer', token])
      ws.onmessage = (ev) => {
        if (cancelled || typeof ev.data !== 'string') return
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
      }
      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 1500)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [qc])
}
