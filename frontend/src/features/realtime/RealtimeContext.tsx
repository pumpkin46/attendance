import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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

export type NotificationKind = 'info' | 'warning' | 'alert'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body?: string
  /** ISO timestamp of the event. */
  ts: string
  /** Optional route to open when the notification is clicked. */
  to?: string
  read: boolean
}

/** A raw server event delivered to a live subscriber (see `useRealtimeEvent`). */
export type RealtimeEvent = RealtimeMessage

interface RealtimeValue {
  status: RealtimeStatus
  /** Recent live notifications, newest first. In-memory for the session. */
  notifications: AppNotification[]
  unreadCount: number
  markAllRead: () => void
  clearAll: () => void
  /** Subscribe to every realtime event (returns an unsubscribe fn). */
  subscribe: (listener: (msg: RealtimeEvent) => void) => () => void
}

const RealtimeContext = createContext<RealtimeValue>({
  status: 'closed',
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  clearAll: () => {},
  subscribe: () => () => {},
})

// A running kiosk can emit "unknown face" events many times a second, which would
// otherwise bury the user in duplicate toasts over a long session. Throttle the
// toast (cache invalidation below still runs for every event).
let lastUnknownToastAt = 0
const UNKNOWN_TOAST_THROTTLE_MS = 15_000

// Keep the bell from flooding on burst-prone events: at most one notification per
// event type per window. The list is also capped so it never grows unbounded.
const NOTIF_THROTTLE_MS = 30_000
const MAX_NOTIFICATIONS = 40

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

  // Chat: typing/presence and WebRTC call signaling are ephemeral and handled
  // only by live subscribers (the open chat page); every other chat event
  // refreshes the conversation list + nav unread badge so they stay current.
  if (type === 'chat.typing' || type === 'chat.presence' || type.startsWith('chat.call.')) return
  if (type.startsWith('chat.')) {
    void invalidate(['chat', 'conversations'])
    void invalidate(['chat', 'unread'])
    return
  }
}

/**
 * Map a server event to a header notification, or null to ignore it. Only
 * genuinely notable, unambiguous incidents are surfaced — generic ".changed"
 * cache-invalidation events are deliberately skipped so the bell never shows
 * misleading "alerts" for routine edits. Extend this switch to surface more.
 */
function notificationFromEvent(msg: RealtimeMessage): Omit<AppNotification, 'id' | 'read'> | null {
  const ts = msg.ts ?? new Date().toISOString()
  const body = typeof msg.data?.message === 'string' ? msg.data.message : undefined
  switch (msg.type) {
    case 'recognition.unknown':
      return { kind: 'warning', title: 'Unknown face detected', body, ts, to: '/unknown-faces' }
    default:
      return null
  }
}

/**
 * Surface an incoming chat message to the header bell — but never the user's own
 * messages, and never system events. Throttled (per event type) by the caller.
 */
function chatNotification(
  msg: RealtimeMessage,
  myUserId: number | null,
): Omit<AppNotification, 'id' | 'read'> | null {
  if (msg.type !== 'chat.message') return null
  const m = msg.data?.message as
    | { type?: string; body?: string | null; sender?: { id?: number; name?: string }; attachments?: unknown[] }
    | undefined
  if (!m || m.type === 'system') return null
  const senderId = m.sender?.id
  if (!senderId || senderId === myUserId) return null
  const ts = msg.ts ?? new Date().toISOString()
  const body =
    typeof m.body === 'string' && m.body
      ? m.body
      : m.attachments?.length
        ? 'Sent an attachment'
        : undefined
  return { kind: 'info', title: `New message from ${m.sender?.name ?? 'Someone'}`, body, ts, to: '/chat' }
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
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const notifIdRef = useRef(0)
  const lastNotifAtByType = useRef<Record<string, number>>({})
  // Live event subscribers (the open chat page taps this for message/typing/
  // presence pushes that should update the UI without a refetch).
  const listenersRef = useRef(new Set<(msg: RealtimeMessage) => void>())
  const subscribe = useCallback((listener: (msg: RealtimeMessage) => void) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  // tenantOrgId is the redux mirror of the session org id; it drives the
  // recompute (and reconnect) on a tenant switch.
  const path = useMemo(
    () => (tenantOrgId ? `/ws?org=${encodeURIComponent(tenantOrgId)}` : '/ws'),
    [tenantOrgId],
  )

  const markAllRead = useCallback(
    () => setNotifications((prev) => (prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev)),
    [],
  )
  const clearAll = useCallback(() => setNotifications([]), [])

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

      // Fan the raw event out to live subscribers (the chat thread).
      listenersRef.current.forEach((listener) => {
        try {
          listener(msg)
        } catch {
          /* a misbehaving subscriber must not break the bus */
        }
      })

      const draft = chatNotification(msg, userId) ?? notificationFromEvent(msg)
      if (!draft) return
      const now = Date.now()
      if (now - (lastNotifAtByType.current[msg.type] ?? 0) < NOTIF_THROTTLE_MS) return
      lastNotifAtByType.current[msg.type] = now
      notifIdRef.current += 1
      const id = `${now}-${notifIdRef.current}`
      setNotifications((prev) => [{ ...draft, id, read: false }, ...prev].slice(0, MAX_NOTIFICATIONS))
    },
  })

  const value = useMemo<RealtimeValue>(
    () => ({
      status,
      notifications,
      unreadCount: notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0),
      markAllRead,
      clearAll,
      subscribe,
    }),
    [status, notifications, markAllRead, clearAll, subscribe],
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  return useContext(RealtimeContext)
}

/**
 * Subscribe to live realtime events for the lifetime of a component. The handler
 * is kept in a ref so re-renders don't churn the subscription.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRealtimeEvent(handler: (msg: RealtimeEvent) => void) {
  const { subscribe } = useContext(RealtimeContext)
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => subscribe((msg) => ref.current(msg)), [subscribe])
}
