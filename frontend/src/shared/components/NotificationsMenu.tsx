import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRealtime, type AppNotification, type NotificationKind } from '@/features/realtime/RealtimeContext'
import { Popover } from '@/shared/ui/Popover'
import { cn } from '@/shared/lib/cn'
import { relativeTime } from '@/shared/lib/format'

const BellIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
)

const InfoGlyph = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
)
const WarningGlyph = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
)
const AlertGlyph = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
)

const KIND_META: Record<NotificationKind, { icon: ReactNode; tint: string }> = {
  info: { icon: InfoGlyph, tint: 'bg-blue-500/15 text-blue-400' },
  warning: { icon: WarningGlyph, tint: 'bg-amber-500/15 text-amber-400' },
  alert: { icon: AlertGlyph, tint: 'bg-rose-500/15 text-rose-400' },
}

function NotificationRow({
  notification,
  onSelect,
}: {
  notification: AppNotification
  onSelect: (n: AppNotification) => void
}) {
  const meta = KIND_META[notification.kind]
  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-slate-800',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        !notification.read && 'bg-slate-800/40'
      )}
    >
      <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', meta.tint)}>
        {meta.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
            {notification.title}
          </span>
          {!notification.read && (
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-blue-400" />
          )}
        </span>
        {notification.body && (
          <span className="mt-0.5 block line-clamp-2 text-xs text-slate-400">{notification.body}</span>
        )}
        <span className="mt-0.5 block text-[11px] text-slate-500">{relativeTime(notification.ts)}</span>
      </span>
    </button>
  )
}

export function NotificationsMenu() {
  const { notifications, unreadCount, markAllRead, clearAll } = useRealtime()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  const close = () => setOpen(false)
  const onSelect = (n: AppNotification) => {
    markAllRead()
    close()
    if (n.to) void navigate(n.to)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        title="Notifications"
        className={cn(
          'relative grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors',
          'hover:bg-slate-800 hover:text-slate-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          open && 'bg-slate-800 text-slate-200'
        )}
      >
        {BellIcon}
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-slate-900"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={close}
        matchWidth={false}
        align="end"
        className="w-[22rem] p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3.5 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-100">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-xs text-slate-500">{unreadCount} new</span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-md px-1.5 py-0.5 text-xs font-medium text-blue-400 transition-colors hover:bg-slate-800 hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Mark all read
            </button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-slate-800 text-slate-500">
              {BellIcon}
            </span>
            <p className="text-sm font-medium text-slate-300">You&rsquo;re all caught up</p>
            <p className="max-w-[16rem] text-xs text-slate-500">
              Live alerts such as unknown-face detections will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="scrollbar-styled max-h-[22rem] overflow-y-auto p-1.5">
              {notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} onSelect={onSelect} />
              ))}
            </div>
            <div className="border-t border-slate-800 px-1.5 py-1.5">
              <button
                type="button"
                onClick={clearAll}
                className="w-full rounded-lg px-2.5 py-1.5 text-center text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Clear all
              </button>
            </div>
          </>
        )}
      </Popover>
    </>
  )
}
