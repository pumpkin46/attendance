import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/api/queries'
import type { Notification } from '@/features/notifications/types'

export default function NotificationsPage() {
  const { data, isPending } = useNotifications()
  const { data: unread } = useUnreadCount()
  const notifications = data?.data ?? []

  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const label = (n: Notification) =>
    n.data?.message ?? n.data?.title ?? n.type.replace(/[._]/g, ' ')

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="System alerts and events routed to your account."
        actions={
          <div className="flex items-center gap-3">
            {unread != null && (
              <Badge tone={unread.unread_count > 0 ? 'danger' : 'neutral'}>
                {unread.unread_count} unread
              </Badge>
            )}
            <Button
              variant="ghost"
              disabled={markAll.isPending || (unread?.unread_count ?? 0) === 0}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      <TableShell>
        <TableHead>
          <Th>Time</Th>
          <Th>Type</Th>
          <Th>Message</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {isPending ? (
            <tr>
              <Td colSpan={5} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : notifications.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-slate-400">
                No notifications
              </Td>
            </tr>
          ) : (
            notifications.map((n) => (
              <tr key={n.id} className={n.read_at ? '' : 'bg-slate-800/30'}>
                <Td className="text-xs">
                  {n.created_at ? new Date(n.created_at).toLocaleString() : '—'}
                </Td>
                <Td className="text-xs uppercase text-slate-400">{n.type.replace(/[._]/g, ' ')}</Td>
                <Td>{label(n)}</Td>
                <Td>
                  <Badge tone={n.read_at ? 'neutral' : 'warn'}>{n.read_at ? 'Read' : 'Unread'}</Badge>
                </Td>
                <Td>
                  {!n.read_at && (
                    <Button
                      variant="ghost"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(n.id)}
                    >
                      Mark read
                    </Button>
                  )}
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
