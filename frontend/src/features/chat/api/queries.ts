import { useCallback, useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type {
  ChatChannel,
  ChatContact,
  ChatConversation,
  ChatMessage,
  ChatMessagePage,
} from '@/features/chat/types'

export const chatKeys = {
  all: ['chat'] as const,
  conversations: ['chat', 'conversations'] as const,
  conversation: (id: number) => ['chat', 'conversation', id] as const,
  messages: (id: number) => ['chat', 'messages', id] as const,
  channels: ['chat', 'channels'] as const,
  contacts: (search: string) => ['chat', 'contacts', search] as const,
  presence: ['chat', 'presence'] as const,
  unread: ['chat', 'unread'] as const,
}

const MESSAGE_PAGE_SIZE = 30

// ── Reads ─────────────────────────────────────────────────────────────────────
export function useConversations() {
  return useApiQuery<ChatConversation[]>(chatKeys.conversations, '/chat/conversations')
}

export function useConversationDetail(id: number | null) {
  return useApiQuery<ChatConversation>(
    id ? chatKeys.conversation(id) : ['chat', 'conversation', 'none'],
    `/chat/conversations/${id}`,
    undefined,
    { enabled: !!id },
  )
}

export function useChannels(enabled = true) {
  return useApiQuery<ChatChannel[]>(chatKeys.channels, '/chat/channels', undefined, { enabled })
}

export function useContacts(search: string, enabled = true) {
  return useApiQuery<ChatContact[]>(
    chatKeys.contacts(search),
    '/chat/contacts',
    { search: search || undefined },
    { enabled, keepPreviousData: true },
  )
}

export function usePresence() {
  return useApiQuery<{ online: number[] }>(chatKeys.presence, '/chat/presence', undefined, {
    silent: true,
  })
}

export function useUnreadCount() {
  return useApiQuery<{ total: number }>(chatKeys.unread, '/chat/unread-count', undefined, {
    silent: true,
  })
}

export function useMessages(conversationId: number | null) {
  return useInfiniteQuery<ChatMessagePage>({
    queryKey: conversationId ? chatKeys.messages(conversationId) : ['chat', 'messages', 'none'],
    enabled: !!conversationId,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<ChatMessagePage>(
        `/chat/conversations/${conversationId}/messages`,
        { params: { before_id: pageParam ?? undefined, limit: MESSAGE_PAGE_SIZE } },
      )
      return data
    },
    initialPageParam: undefined as number | undefined,
    // "Next" loads OLDER history: before the oldest id currently loaded.
    getNextPageParam: (lastPage) =>
      lastPage.has_more && lastPage.data.length ? lastPage.data[0].id : undefined,
  })
}

/** Flatten the paginated message cache into one ascending (oldest→newest) list. */
export function flattenMessages(data?: InfiniteData<ChatMessagePage>): ChatMessage[] {
  if (!data) return []
  return [...data.pages].reverse().flatMap((p) => p.data)
}

// ── Message cache mutations (used by realtime + optimistic paths) ──────────────
type MsgData = InfiniteData<ChatMessagePage> | undefined

export function appendMessageToCache(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: number,
  msg: ChatMessage,
) {
  qc.setQueryData<MsgData>(chatKeys.messages(conversationId), (old) => {
    if (!old) return old
    if (old.pages.some((p) => p.data.some((m) => m.id === msg.id))) return old
    // Page 0 is the newest slice; append the new message there.
    const pages = old.pages.map((p, i) =>
      i === 0 ? { ...p, data: [...p.data, msg] } : p,
    )
    return { ...old, pages }
  })
}

export function updateMessageInCache(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: number,
  msg: ChatMessage,
) {
  qc.setQueryData<MsgData>(chatKeys.messages(conversationId), (old) => {
    if (!old) return old
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        data: p.data.map((m) => (m.id === msg.id ? msg : m)),
      })),
    }
  })
}

export function markMessageDeletedInCache(
  qc: ReturnType<typeof useQueryClient>,
  conversationId: number,
  messageId: number,
) {
  qc.setQueryData<MsgData>(chatKeys.messages(conversationId), (old) => {
    if (!old) return old
    const stamp = new Date().toISOString()
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        data: p.data.map((m) =>
          m.id === messageId
            ? { ...m, deleted_at: stamp, body: null, attachments: [], reactions: [] }
            : m,
        ),
      })),
    }
  })
}

// ── Writes ────────────────────────────────────────────────────────────────────
export function useSendMessage(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      body: string
      replyToId?: number | null
      mentionIds?: number[]
      files?: File[]
    }) => {
      const form = new FormData()
      form.append('body', input.body)
      if (input.replyToId) form.append('reply_to_id', String(input.replyToId))
      if (input.mentionIds?.length) form.append('mentions', input.mentionIds.join(','))
      for (const file of input.files ?? []) form.append('files', file)
      const { data } = await api.post<ChatMessage>(
        `/chat/conversations/${conversationId}/messages`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      return data
    },
    onSuccess: (msg) => {
      // Append immediately for the sender; the realtime echo dedupes by id.
      // If the thread cache isn't populated yet (still loading, or the first
      // fetch errored) the append is a no-op, so refetch to seed it instead of
      // silently losing the just-sent message.
      if (qc.getQueryData(chatKeys.messages(conversationId))) {
        appendMessageToCache(qc, conversationId, msg)
      } else {
        void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId) })
      }
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useCreateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      type: 'direct' | 'group' | 'channel'
      user_id?: number
      member_ids?: number[]
      name?: string
      topic?: string
    }) => {
      const { data } = await api.post<ChatConversation>('/chat/conversations', input)
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useEditMessage(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: string }) => {
      const { data } = await api.patch<ChatMessage>(`/chat/messages/${id}`, { body })
      return data
    },
    onSuccess: (msg) => updateMessageInCache(qc, conversationId, msg),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useDeleteMessage(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/chat/messages/${id}`),
    onSuccess: (_d, id) => markMessageDeletedInCache(qc, conversationId, id),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useToggleReaction(conversationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, emoji }: { id: number; emoji: string }) => {
      const { data } = await api.post<ChatMessage>(`/chat/messages/${id}/reactions`, { emoji })
      return data
    },
    onSuccess: (msg) => updateMessageInCache(qc, conversationId, msg),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, lastReadMessageId }: { conversationId: number; lastReadMessageId: number }) =>
      api.post(`/chat/conversations/${conversationId}/read`, {
        last_read_message_id: lastReadMessageId,
      }),
    onSuccess: (_d, { conversationId }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
      void qc.invalidateQueries({ queryKey: chatKeys.unread })
      // Keep members[].last_read_message_id authoritative for seen-counts even
      // when the realtime chat.read echo is unavailable.
      void qc.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
    },
    // Read receipts are best-effort; never toast a failure.
  })
}

export function usePinConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ conversationId, pinned }: { conversationId: number; pinned: boolean }) => {
      const { data } = await api.post<ChatConversation>(
        `/chat/conversations/${conversationId}/pin`,
        { pinned },
      )
      return data
    },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
      void qc.invalidateQueries({ queryKey: chatKeys.conversation(conv.id) })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useJoinChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (conversationId: number) => {
      const { data } = await api.post<ChatConversation>(`/chat/channels/${conversationId}/join`)
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
      void qc.invalidateQueries({ queryKey: chatKeys.channels })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useAddMembers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ conversationId, userIds }: { conversationId: number; userIds: number[] }) => {
      const { data } = await api.post<ChatConversation>(
        `/chat/conversations/${conversationId}/members`,
        { user_ids: userIds },
      )
      return data
    },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversation(conv.id) })
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useRemoveMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, userId }: { conversationId: number; userId: number }) =>
      api.delete(`/chat/conversations/${conversationId}/members/${userId}`),
    onSuccess: (_d, { conversationId }) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

export function useUpdateConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      conversationId,
      changes,
    }: {
      conversationId: number
      changes: { name?: string; topic?: string; is_archived?: boolean }
    }) => {
      const { data } = await api.patch<ChatConversation>(
        `/chat/conversations/${conversationId}`,
        changes,
      )
      return data
    },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: chatKeys.conversation(conv.id) })
      void qc.invalidateQueries({ queryKey: chatKeys.conversations })
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  })
}

/** Returns a throttled "is typing" pinger (one POST per ~2.5s of activity). */
export function useTypingPinger(conversationId: number | null) {
  const lastSent = useRef(0)
  return useCallback(() => {
    if (!conversationId) return
    const now = Date.now()
    if (now - lastSent.current < 2500) return
    lastSent.current = now
    void api.post(`/chat/conversations/${conversationId}/typing`).catch(() => {})
  }, [conversationId])
}
