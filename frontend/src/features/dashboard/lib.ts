/** Feed/badge tone for a live event type. */
export function eventTone(type: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (type.includes('unknown')) return 'danger'
  if (type.includes('offline')) return 'warn'
  if (type.includes('check_in') || type.includes('granted') || type.includes('matched')) return 'ok'
  return 'neutral'
}
