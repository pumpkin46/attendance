import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'

interface Notification {
  id: string
  type: string
  data?: { message?: string; title?: string } & Record<string, unknown>
  read_at: string | null
  created_at: string | null
}

export default function NotificationsPage() {
  const queryClient = useQueryClient()
  const { data, isPending } = useApiQuery<Paginated<Notification>>(
    ['notifications', 'list'],
    '/notifications',
    { per_page: 50 }
  )
  const { data: unread } = useApiQuery<{ unread_count: number }>(
    ['notifications', 'unread-count'],
    '/notifications/unread-count',
    undefined,
    { silent: true }
  )
  const notifications = data?.data ?? []
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  })
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: (res: { data: { marked_read: number } }) => {
      toast.success(`Marked ${res.data.marked_read} as read`)
      invalidate()
    },
  })

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
