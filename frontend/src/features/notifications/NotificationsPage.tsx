import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { DataTable } from '@/shared/ui/DataTable'
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

      <DataTable
        data={notifications}
        rowKey={(n) => n.id}
        pageSize={10}
        loading={isPending}
        empty="No notifications"
        rowClassName={(n) => (n.read_at ? undefined : 'bg-slate-800/30')}
        columns={[
          {
            key: 'time',
            header: 'Time',
            className: 'text-xs',
            cell: (n) => (n.created_at ? new Date(n.created_at).toLocaleString() : '—'),
          },
          {
            key: 'type',
            header: 'Type',
            className: 'text-xs uppercase text-slate-400',
            cell: (n) => n.type.replace(/[._]/g, ' '),
          },
          { key: 'message', header: 'Message', cell: (n) => label(n) },
          {
            key: 'status',
            header: 'Status',
            cell: (n) => (
              <Badge tone={n.read_at ? 'neutral' : 'warn'}>{n.read_at ? 'Read' : 'Unread'}</Badge>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (n) =>
              !n.read_at && (
                <Button
                  variant="ghost"
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate(n.id)}
                >
                  Mark read
                </Button>
              ),
          },
        ]}
      />
    </div>
  )
}
