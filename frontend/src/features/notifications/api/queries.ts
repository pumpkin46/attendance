import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'
import type { Notification } from '@/features/notifications/types'

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread-count'] as const,
}

export function useNotifications() {
  return useApiQuery<Paginated<Notification>>(notificationKeys.list, '/notifications', {
    per_page: 50,
  })
}

export function useUnreadCount() {
  return useApiQuery<{ unread_count: number }>(
    notificationKeys.unread,
    '/notifications/unread-count',
    undefined,
    { silent: true }
  )
}

export function useInvalidateNotifications() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: notificationKeys.all })
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  })
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ marked_read: number }>('/notifications/read-all')
      return data
    },
    onSuccess: (data) => {
      toast.success(`Marked ${data.marked_read} as read`)
      invalidate()
    },
  })
}
