import { useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Skeleton } from '@/shared/ui/Skeleton'
import { relativeTime } from '@/shared/lib/format'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/api/queries'
import type { Notification } from '@/features/notifications/types'

type Filter = 'all' | 'unread'

const messageOf = (n: Notification) =>
  n.data?.message ?? n.data?.title ?? n.type.replace(/[._]/g, ' ')

function typeMeta(type: string): { tone: string; icon: React.ReactNode } {
  const t = type.toLowerCase()
  if (/(security|spoof|unknown|breach|alert|anomal)/.test(t))
    return { tone: 'bg-red-500/15 text-red-400', icon: <AlertIcon /> }
  if (/(attendance|late|absent|check)/.test(t))
    return { tone: 'bg-amber-500/15 text-amber-400', icon: <ClockIcon /> }
  if (/(visitor|approval|guest)/.test(t))
    return { tone: 'bg-blue-500/15 text-blue-400', icon: <UserIcon /> }
  if (/(system|config|engine|camera|device|rfid)/.test(t))
    return { tone: 'bg-slate-500/15 text-slate-300', icon: <GearIcon /> }
  return { tone: 'bg-blue-500/15 text-blue-400', icon: <BellIcon /> }
}

export default function NotificationsPage() {
  const { data, isPending } = useNotifications()
  const { data: unread } = useUnreadCount()
  const notifications = useMemo(() => data?.data ?? [], [data])

  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const [filter, setFilter] = useState<Filter>('all')

  const unreadCount = unread?.unread_count ?? notifications.filter((n) => !n.read_at).length
  const filtered =
    filter === 'unread' ? notifications.filter((n) => !n.read_at) : notifications

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="System alerts and events routed to your account."
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={unreadCount > 0 ? 'danger' : 'neutral'}>{unreadCount} unread</Badge>
            <Button
              variant="ghost"
              isLoading={markAll.isPending}
              disabled={unreadCount === 0}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      <div className="mb-4 inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
              filter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            {f === 'unread' ? `Unread (${unreadCount})` : 'All'}
          </button>
        ))}
      </div>

      {isPending ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-slate-500">
            <BellIcon />
          </span>
          <p className="text-sm font-medium text-slate-300">
            {filter === 'unread' ? "You're all caught up" : 'No notifications'}
          </p>
          <p className="text-xs text-slate-500">
            {filter === 'unread'
              ? 'No unread notifications right now.'
              : 'Alerts routed to your account will appear here.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((n) => {
            const meta = typeMeta(n.type)
            const unreadItem = !n.read_at
            return (
              <div
                key={n.id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border bg-slate-900 p-4 transition-colors',
                  unreadItem ? 'border-slate-700 bg-slate-800/40' : 'border-slate-800'
                )}
              >
                <span
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                    meta.tone
                  )}
                >
                  {meta.icon}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p
                      className={cn(
                        'text-sm',
                        unreadItem ? 'font-medium text-slate-100' : 'text-slate-300'
                      )}
                    >
                      {messageOf(n)}
                    </p>
                    {unreadItem && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className="uppercase tracking-wide">{n.type.replace(/[._]/g, ' ')}</span>
                    <span>·</span>
                    <span>{relativeTime(n.created_at)}</span>
                  </div>
                </div>

                {unreadItem && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(n.id)}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 3 5v6c0 5 3.8 8.5 9 11 5.2-2.5 9-6 9-11V5l-9-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="16.5" x2="12" y2="16.5" />
  </svg>
)

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
)

const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
)
