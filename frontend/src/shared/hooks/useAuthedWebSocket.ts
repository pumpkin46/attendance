import { useEffect, useRef } from 'react'
import { getToken } from '@/shared/lib/session'

/** Build a ws(s):// URL for an API-relative path, honoring VITE_API_URL. */
export function buildWsUrl(path: string): string {
  const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
  const httpBase = /^https?:\/\//.test(apiBase) ? apiBase : window.location.origin + apiBase
  return `${httpBase.replace(/^http/, 'ws')}${path}`
}

export type WebSocketStatus = 'connecting' | 'open' | 'closed'

export interface AuthedWebSocketOptions {
  /** API-relative path, e.g. `/monitoring/ws` or `/ws?org=3`. */
  path: string
  /** When false, the socket is not opened (e.g. no source selected / logged out). */
  enabled?: boolean
  binaryType?: BinaryType
  onMessage: (ev: MessageEvent) => void
  /** Called on open. `reconnected` is true when this open followed a drop. */
  onOpen?: (ws: WebSocket, info: { reconnected: boolean }) => void
  /** Called whenever the socket closes (before any reconnect is scheduled). */
  onClose?: () => void
  /** Called on every connecting/open/closed transition (e.g. to drive a status badge). */
  onStatusChange?: (status: WebSocketStatus) => void
  /** Run once on unmount (e.g. revoke a trailing object URL). */
  onTeardown?: () => void
  /** When > 0, send `heartbeatMessage` on this interval while the socket is OPEN. */
  heartbeatMs?: number
  /** Heartbeat payload (default `'ping'`). */
  heartbeatMessage?: string
  /** Extra values that, when changed, force a reconnect. */
  deps?: ReadonlyArray<unknown>
}

/**
 * Shared authenticated WebSocket with fresh-token-per-attempt auth and
 * exponential reconnect backoff. The single implementation behind the
 * dashboard / engine / webcam feeds AND the realtime bus, so reconnect/auth
 * fixes live in one place.
 *
 * The token is read at every connect (not captured in the effect closure), so
 * a token refresh or tenant switch is picked up on the next reconnect instead
 * of reusing a dead token forever.
 */
export function useAuthedWebSocket({
  path,
  enabled = true,
  binaryType,
  onMessage,
  onOpen,
  onClose,
  onStatusChange,
  onTeardown,
  heartbeatMs,
  heartbeatMessage = 'ping',
  deps = [],
}: AuthedWebSocketOptions): void {
  // Keep the latest callbacks in refs so changing them does not tear down and
  // reopen the socket on every render. Updated in an effect (not during render)
  // per the react-hooks rules.
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(onClose)
  const onStatusChangeRef = useRef(onStatusChange)
  const onTeardownRef = useRef(onTeardown)
  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
    onStatusChangeRef.current = onStatusChange
    onTeardownRef.current = onTeardown
  })

  useEffect(() => {
    if (!enabled) return

    const url = buildWsUrl(path)
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    let attempt = 0
    let noTokenAttempts = 0
    const MAX_NO_TOKEN_ATTEMPTS = 5

    const connect = () => {
      if (cancelled) return
      const token = getToken() // fresh per attempt
      if (!token) {
        // Briefly wait for auth on mount, but give up after a few tries so a
        // socket that outlives logout doesn't poll localStorage forever. The
        // effect re-runs (and retries) when `enabled`/deps change.
        if (noTokenAttempts >= MAX_NO_TOKEN_ATTEMPTS) return
        noTokenAttempts += 1
        reconnectTimer = setTimeout(connect, 1500)
        return
      }
      noTokenAttempts = 0
      onStatusChangeRef.current?.('connecting')
      ws = new WebSocket(url, ['bearer', token])
      if (binaryType) ws.binaryType = binaryType

      ws.onopen = () => {
        if (cancelled) return
        const reconnected = attempt > 0
        attempt = 0
        onStatusChangeRef.current?.('open')
        if (ws) onOpenRef.current?.(ws, { reconnected })
        if (heartbeatMs && heartbeatMs > 0) {
          heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(heartbeatMessage)
          }, heartbeatMs)
        }
      }
      ws.onmessage = (ev) => {
        if (!cancelled) onMessageRef.current(ev)
      }
      ws.onclose = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        onStatusChangeRef.current?.('closed')
        onCloseRef.current?.()
        if (cancelled) return
        attempt += 1
        const delay = Math.min(30_000, 1000 * 2 ** (attempt - 1))
        reconnectTimer = setTimeout(connect, delay)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      ws?.close()
      onTeardownRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, ...deps])
}
