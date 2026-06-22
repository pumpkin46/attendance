import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  flattenMessages,
  useConversationDetail,
  useConversations,
  useDeleteMessage,
  useEditMessage,
  useMarkRead,
  useMessages,
  usePinConversation,
  useSendMessage,
  useToggleReaction,
  useTypingPinger,
} from '@/features/chat/api/queries'
import { useChatLiveState } from '@/features/chat/hooks/useChatLiveState'
import { useCall } from '@/features/chat/hooks/useCall'
import { CallOverlay } from '@/features/chat/components/CallOverlay'
import { ConversationList } from '@/features/chat/components/ConversationList'
import { ConversationHeader } from '@/features/chat/components/ConversationHeader'
import { MessageThread } from '@/features/chat/components/MessageThread'
import { MessageComposer } from '@/features/chat/components/MessageComposer'
import { NewConversationDialog } from '@/features/chat/components/NewConversationDialog'
import { ChannelsBrowser } from '@/features/chat/components/ChannelsBrowser'
import { ConversationInfoPanel } from '@/features/chat/components/ConversationInfoPanel'
import type { ChatConversation, ChatMessage } from '@/features/chat/types'

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-slate-800 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V6a3 3 0 0 1 3-3h8a8 8 0 0 1 7 8z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-slate-200">Your messages</h3>
        <p className="mt-1 text-sm text-slate-500">
          Select a conversation, or start a new direct message, group, or channel.
        </p>
        <button
          type="button"
          onClick={onNew}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          New conversation
        </button>
      </div>
    </div>
  )
}

export default function ChatPage() {
  const { user, isSuperAdmin } = useAuth()
  const meId = user?.id ?? null

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [channelsOpen, setChannelsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  const { data: conversations, isLoading: convLoading } = useConversations()
  // Fall back to the most recent conversation until the user picks one — derived
  // (no auto-select effect, so no cascading render).
  const activeId = selectedId ?? conversations?.[0]?.id ?? null

  const { presence, typing, reads } = useChatLiveState(meId, activeId)
  const callCtl = useCall()
  const detail = useConversationDetail(activeId)
  const activeConv = detail.data ?? null

  const messagesQuery = useMessages(activeId)
  const messages = useMemo(() => flattenMessages(messagesQuery.data), [messagesQuery.data])

  const send = useSendMessage(activeId ?? 0)
  const edit = useEditMessage(activeId ?? 0)
  const del = useDeleteMessage(activeId ?? 0)
  const react = useToggleReaction(activeId ?? 0)
  const { mutate: markReadMutate } = useMarkRead()
  const { mutate: pinMutate } = usePinConversation()
  const pingTyping = useTypingPinger(activeId)

  const onSeenLatest = useCallback(
    (id: number) => {
      if (activeId) markReadMutate({ conversationId: activeId, lastReadMessageId: id })
    },
    [activeId, markReadMutate],
  )

  const togglePin = useCallback(
    (conv: ChatConversation) => pinMutate({ conversationId: conv.id, pinned: !conv.is_pinned }),
    [pinMutate],
  )

  const select = (id: number) => {
    setSelectedId(id)
    setReplyTo(null)
    setInfoOpen(false)
  }

  const canModerate =
    isSuperAdmin() || activeConv?.my_role === 'owner' || activeConv?.my_role === 'admin'

  const mentionCandidates = useMemo(
    () => (activeConv?.members ?? []).filter((m) => m.user_id !== meId).map((m) => ({ id: m.user_id, name: m.name })),
    [activeConv?.members, meId],
  )

  const typingNames = useMemo(
    () => (activeId ? Object.values(typing[activeId] ?? {}).map((t) => t.name) : []),
    [typing, activeId],
  )

  // Conversation ids with someone currently typing — drives the list indicator.
  const typingConvIds = useMemo(
    () =>
      new Set(
        Object.entries(typing)
          .filter(([, byUser]) => Object.keys(byUser).length > 0)
          .map(([cid]) => Number(cid)),
      ),
    [typing],
  )

  const memberNames = useMemo(
    () => (activeConv?.members ?? []).map((m) => m.name),
    [activeConv?.members],
  )

  const onlineCount = useMemo(
    () => (activeConv?.members ?? []).filter((m) => presence.has(m.user_id)).length,
    [activeConv?.members, presence],
  )

  // Per-user highest-read message id: the members' stored last_read merged with
  // live read receipts for the active conversation. Drives per-message "seen".
  const seenReads = useMemo(() => {
    const map = new Map<number, number>()
    for (const m of activeConv?.members ?? []) map.set(m.user_id, m.last_read_message_id || 0)
    const live = activeId ? reads[activeId] : undefined
    if (live) {
      for (const [uid, last] of Object.entries(live)) {
        const id = Number(uid)
        map.set(id, Math.max(map.get(id) ?? 0, last))
      }
    }
    return map
  }, [activeConv?.members, reads, activeId])

  const seenCount = useCallback(
    (m: ChatMessage): number | null => {
      if (m.type === 'system') return null
      let count = 0
      for (const [uid, last] of seenReads) {
        if (uid !== m.sender?.id && last >= m.id) count++
      }
      return count
    },
    [seenReads],
  )

  return (
    <div className="flex h-full min-h-0 gap-4">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <ConversationList
          conversations={conversations ?? []}
          loading={convLoading}
          selectedId={activeId}
          onSelect={select}
          presence={presence}
          typingConvIds={typingConvIds}
          meId={meId}
          search={search}
          onSearch={setSearch}
          onNew={() => setNewOpen(true)}
          onBrowseChannels={() => setChannelsOpen(true)}
          onTogglePin={togglePin}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        {activeId && activeConv ? (
          <>
            <ConversationHeader
              conversation={activeConv}
              presence={presence}
              onlineCount={onlineCount}
              callable={activeConv.type === 'direct' && !!activeConv.counterpart}
              onStartCall={(video) => {
                if (activeConv.counterpart) {
                  void callCtl.startCall({
                    conversationId: activeConv.id,
                    peer: activeConv.counterpart,
                    video,
                  })
                }
              }}
              onOpenInfo={() => setInfoOpen(true)}
              onTogglePin={() => togglePin(activeConv)}
            />
            <MessageThread
              messages={messages}
              meId={meId}
              loading={messagesQuery.isLoading}
              canModerate={!!canModerate}
              memberNames={memberNames}
              typingNames={typingNames}
              hasOlder={!!messagesQuery.hasNextPage}
              loadingOlder={messagesQuery.isFetchingNextPage}
              onLoadOlder={() => void messagesQuery.fetchNextPage()}
              onSeenLatest={onSeenLatest}
              seenCount={seenCount}
              onReact={(id, emoji) => react.mutate({ id, emoji })}
              onReply={setReplyTo}
              onEdit={(id, body) => edit.mutate({ id, body })}
              onDelete={(id) => del.mutate(id)}
            />
            <MessageComposer
              key={activeId}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              mentionCandidates={mentionCandidates}
              onTyping={pingTyping}
              onSend={({ body, files, mentionIds }) => {
                send.mutate({ body, files, mentionIds, replyToId: replyTo?.id ?? null })
                setReplyTo(null)
              }}
            />
          </>
        ) : activeId && detail.isLoading ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading…</div>
        ) : (
          <EmptyState onNew={() => setNewOpen(true)} />
        )}
      </section>

      <NewConversationDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        presence={presence}
        onCreated={(id) => {
          setNewOpen(false)
          select(id)
        }}
      />
      <ChannelsBrowser
        open={channelsOpen}
        onClose={() => setChannelsOpen(false)}
        onOpenChannel={(id) => {
          setChannelsOpen(false)
          select(id)
        }}
      />
      {activeConv && (
        <ConversationInfoPanel
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          conversation={activeConv}
          meId={meId}
          presence={presence}
          onLeft={() => {
            setInfoOpen(false)
            setSelectedId(null)
          }}
        />
      )}

      <CallOverlay
        call={callCtl.call}
        localStream={callCtl.localStream}
        remoteStream={callCtl.remoteStream}
        onAccept={callCtl.acceptCall}
        onReject={callCtl.rejectCall}
        onHangUp={callCtl.hangUp}
        onToggleMute={callCtl.toggleMute}
        onToggleCamera={callCtl.toggleCamera}
      />
    </div>
  )
}
