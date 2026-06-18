import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/features/auth/AuthProvider'
import { selectOrgId } from '@/features/tenant/tenantSlice'
import { useAppSelector } from '@/store/hooks'
import { useAuthedWebSocket, type WebSocketStatus } from '@/shared/hooks/useAuthedWebSocket'

export type RealtimeStatus = WebSocketStatus

interface RealtimeMessage {
  type: string
  data?: Record<string, unknown>
  org_id?: number | null
  ts?: string
}

const RealtimeContext = createContext<{ status: RealtimeStatus }>({ status: 'closed' })

// A running kiosk can emit "unknown face" events many times a second, which would
// otherwise bury the user in duplicate toasts over a long session. Throttle the
// toast (cache invalidation below still runs for every event).
let lastUnknownToastAt = 0
const UNKNOWN_TOAST_THROTTLE_MS = 15_000

/** Translate a server event into TanStack Query cache updates (and user-facing toasts). */
function handleRealtimeEvent(queryClient: QueryClient, msg: RealtimeMessage) {
  const { type } = msg
  const invalidate = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key })

  if (type === 'connected') return

  // Recognition incidents feed the recognition views and the
  // security-monitoring dashboard. The monitoring page is intentionally NOT
  // invalidated here — it streams live via its own WebSocket (useMonitoringFeed),
  // so event-driven refetching would just duplicate that push.
  if (type.startsWith('recognition.')) {
    void invalidate(['recognition'])
    void invalidate(['security-monitoring'])
    if (type === 'recognition.unknown') {
      const now = Date.now()
      if (now - lastUnknownToastAt >= UNKNOWN_TOAST_THROTTLE_MS) {
        lastUnknownToastAt = now
        const message = (msg.data?.message as string) ?? 'Unknown face detected'
        toast.warning(message)
      }
    }
    return
  }

  if (type === 'security.changed') {
    void invalidate(['security-monitoring'])
    return
  }
  if (type === 'cameras.changed') {
    void invalidate(['cameras'])
    return
  }
  if (type === 'engine.changed') {
    void invalidate(['engine'])
    return
  }
  if (type === 'visitors.changed') {
    void invalidate(['visitors'])
    return
  }
  if (type === 'anomalies.changed') {
    void invalidate(['anomalies'])
    return
  }
  if (type === 'rfid.tap') {
    void invalidate(['rfid'])
    return
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? null
  // Super-admin tenant switches change the ws query string, so the socket must
  // reconnect to receive the new org's events. The non-sensitive tenant id goes
  // in the query string; the JWT is sent via the subprotocol by the shared hook.
  const tenantOrgId = useAppSelector(selectOrgId)
  const [status, setStatus] = useState<RealtimeStatus>('closed')

  // tenantOrgId is the redux mirror of the session org id; it drives the
  // recompute (and reconnect) on a tenant switch.
  const path = useMemo(
    () => (tenantOrgId ? `/ws?org=${encodeURIComponent(tenantOrgId)}` : '/ws'),
    [tenantOrgId],
  )

  useAuthedWebSocket({
    path,
    enabled: !!userId,
    heartbeatMs: 25_000,
    onStatusChange: setStatus,
    onOpen: (_ws, { reconnected }) => {
      // On a reconnect we may have missed events while down, so resync. On the
      // first connect the mounted pages have just fetched on mount, so skip the
      // redundant invalidate-everything (avoids a duplicate fetch storm).
      if (reconnected) void queryClient.invalidateQueries()
    },
    onMessage: (event) => {
      let msg: RealtimeMessage
      try {
        msg = JSON.parse(String(event.data)) as RealtimeMessage
      } catch {
        return
      }
      handleRealtimeEvent(queryClient, msg)
    },
  })

  return <RealtimeContext.Provider value={{ status }}>{children}</RealtimeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  return useContext(RealtimeContext)
}
