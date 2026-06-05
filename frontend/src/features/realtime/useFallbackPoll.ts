import { useRealtime } from './RealtimeContext'

/**
 * Returns `intervalMs` only while the realtime socket is NOT open, so a screen
 * can poll as a fallback when realtime is down but stay event-driven (zero
 * background polling) while the socket is healthy.
 *
 *   const poll = useFallbackPoll(60_000)
 *   useApiQuery(key, url, params, { refetchInterval: poll })
 */
export function useFallbackPoll(intervalMs: number): number | undefined {
  const { status } = useRealtime()
  return status === 'open' ? undefined : intervalMs
}
