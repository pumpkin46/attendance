import { useEffect, useRef } from 'react'
import { getToken } from '@/shared/lib/session'

/** Build a ws(s):// URL for an API-relative path, honoring VITE_API_URL. */
export function buildWsUrl(path: string): string {
  const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
  const httpBase = /^https?:\/\//.test(apiBase) ? apiBase : window.location.origin + apiBase
  return `${httpBase.replace(/^http/, 'ws')}${path}`
}

export interface AuthedWebSocketOptions {
  /** API-relative path, e.g. `/monitoring/ws` or `/engine/streams/3/ws`. */
  path: string
  /** When false, the socket is not opened (e.g. no source selected). */
  enabled?: boolean
  binaryType?: BinaryType
  onMessage: (ev: MessageEvent) => void
  onOpen?: (ws: WebSocket) => void
  /** Run once on unmount (e.g. revoke a trailing object URL). */
  onTeardown?: () => void
  /** Extra values that, when changed, force a reconnect. */
  deps?: ReadonlyArray<unknown>
}

/**
 * Shared authenticated WebSocket with fresh-token-per-attempt auth and
 * exponential reconnect backoff — the pattern from RealtimeContext, extracted
 * so the dashboard / engine / webcam feeds stop each hand-rolling connect logic
 * that captured a stale token once and reconnected on a fixed 1.5s timer.
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
  onTeardown,
  deps = [],
}: AuthedWebSocketOptions): void {
  // Keep the latest callbacks in refs so changing them does not tear down and
  // reopen the socket on every render. Updated in an effect (not during render)
  // per the react-hooks rules.
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const onTeardownRef = useRef(onTeardown)
  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onTeardownRef.current = onTeardown
  })

  useEffect(() => {
    if (!enabled) return

    const url = buildWsUrl(path)
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const connect = () => {
      if (cancelled) return
      const token = getToken() // fresh per attempt
      if (!token) {
        // Not authenticated yet — retry shortly rather than giving up forever.
        reconnectTimer = setTimeout(connect, 1500)
        return
      }
      ws = new WebSocket(url, ['bearer', token])
      if (binaryType) ws.binaryType = binaryType

      ws.onopen = () => {
        if (cancelled) return
        attempt = 0
        if (ws) onOpenRef.current?.(ws)
      }
      ws.onmessage = (ev) => {
        if (!cancelled) onMessageRef.current(ev)
      }
      ws.onclose = () => {
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
      ws?.close()
      onTeardownRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled, ...deps])
}
