import { useRealtime } from '../contexts/RealtimeContext'
import { cn } from '../lib/cn'

const LABEL = {
  open: 'Live',
  connecting: 'Connecting…',
  closed: 'Offline',
} as const

const DOT = {
  open: 'bg-emerald-400',
  connecting: 'bg-amber-400 animate-pulse',
  closed: 'bg-slate-500',
} as const

/** Shows the realtime WebSocket connection state in the app header. */
export function RealtimeIndicator() {
  const { status } = useRealtime()
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-slate-400"
      title={`Realtime: ${LABEL[status]}`}
    >
      <span className={cn('inline-block h-2 w-2 rounded-full', DOT[status])} aria-hidden />
      {LABEL[status]}
    </span>
  )
}
