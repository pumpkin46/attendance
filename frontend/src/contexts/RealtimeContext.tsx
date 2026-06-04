import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getOrgId, getToken } from '../lib/session'
import { useAuth } from './AuthContext'

export type RealtimeStatus = 'connecting' | 'open' | 'closed'

interface RealtimeMessage {
  type: string
  data?: Record<string, unknown>
  org_id?: number | null
  ts?: string
}

const RealtimeContext = createContext<{ status: RealtimeStatus }>({ status: 'closed' })

/**
 * Build the ws(s):// URL and the auth subprotocols for the realtime endpoint.
 * The JWT is sent via the Sec-WebSocket-Protocol header (`['bearer', token]`)
 * rather than the query string, so it never lands in URLs/access logs. The
 * non-sensitive tenant id stays in the query string.
 */
function buildWsTarget(): { url: string; protocols: string[] } | null {
  const token = getToken()
  if (!token) return null
  const org = getOrgId()
  const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
  const httpBase = /^https?:\/\//.test(apiBase) ? apiBase : window.location.origin + apiBase
  const wsBase = httpBase.replace(/^http/, 'ws')
  const query = org ? `?org=${encodeURIComponent(org)}` : ''
  return { url: `${wsBase}/ws${query}`, protocols: ['bearer', token] }
}

/** Translate a server event into TanStack Query cache updates (and user-facing toasts). */
function handleRealtimeEvent(queryClient: QueryClient, msg: RealtimeMessage) {
  const { type } = msg
  const invalidate = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key })

  if (type === 'connected') return

  // Recognition + access incidents feed notifications, the recognition views, the
  // live monitoring center, and the security-monitoring dashboard.
  if (type.startsWith('recognition.') || type === 'notification.created') {
    invalidate(['notifications'])
    invalidate(['recognition'])
    invalidate(['monitoring'])
    invalidate(['security-monitoring'])
    if (type === 'recognition.unknown') {
      const message = (msg.data?.message as string) ?? 'Unknown face detected'
      toast.warning(message)
    }
    return
  }

  if (type.startsWith('access.')) {
    invalidate(['notifications'])
    invalidate(['monitoring'])
    invalidate(['security-monitoring'])
    return
  }

  if (type === 'security.changed') {
    invalidate(['security-monitoring'])
    return
  }
  if (type === 'cameras.changed') {
    invalidate(['cameras'])
    invalidate(['monitoring'])
    return
  }
  if (type === 'engine.changed') {
    invalidate(['engine'])
    return
  }
  if (type === 'visitors.changed') {
    invalidate(['visitors'])
    invalidate(['monitoring'])
    return
  }
  if (type === 'anomalies.changed') {
    invalidate(['anomalies'])
    return
  }
  if (type === 'rfid.tap') {
    invalidate(['rfid'])
    return
  }
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [status, setStatus] = useState<RealtimeStatus>('closed')
  const attemptRef = useRef(0)

  useEffect(() => {
    // No user → stay disconnected. Status is 'closed' by default and any prior
    // socket's onclose will have reset it on logout.
    if (!userId) return

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined

    const connect = () => {
      if (cancelled) return
      const target = buildWsTarget()
      if (!target) return
      setStatus('connecting')
      ws = new WebSocket(target.url, target.protocols)

      ws.onopen = () => {
        if (cancelled) return
        attemptRef.current = 0
        setStatus('open')
        // Resync anything that changed while we were disconnected.
        queryClient.invalidateQueries()
        heartbeatTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 25_000)
      }

      ws.onmessage = (event) => {
        let msg: RealtimeMessage
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        handleRealtimeEvent(queryClient, msg)
      }

      ws.onclose = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        setStatus('closed')
        if (cancelled) return
        attemptRef.current += 1
        const delay = Math.min(30_000, 1000 * 2 ** (attemptRef.current - 1))
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
    }
  }, [userId, queryClient])

  return <RealtimeContext.Provider value={{ status }}>{children}</RealtimeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  return useContext(RealtimeContext)
}
