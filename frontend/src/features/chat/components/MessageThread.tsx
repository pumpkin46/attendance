import { useEffect, useLayoutEffect, useRef } from 'react'
import { Spinner } from '@/shared/ui/Loading'
import { MessageBubble } from '@/features/chat/components/MessageBubble'
import { TypingIndicator } from '@/features/chat/components/TypingIndicator'
import type { ChatMessage } from '@/features/chat/types'

const GROUP_GAP_MS = 5 * 60 * 1000

function dayLabel(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function startsNewGroup(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  if (!prev) return true
  if (prev.type === 'system' || cur.type === 'system') return true
  if (prev.sender?.id !== cur.sender?.id) return true
  const dt = new Date(cur.created_at ?? 0).getTime() - new Date(prev.created_at ?? 0).getTime()
  return dt > GROUP_GAP_MS
}

export function MessageThread({
  messages,
  meId,
  loading,
  canModerate,
  memberNames,
  typingNames,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onSeenLatest,
  seenCount,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: {
  messages: ChatMessage[]
  meId: number | null
  loading: boolean
  canModerate: boolean
  memberNames: string[]
  typingNames: string[]
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onSeenLatest: (messageId: number) => void
  seenCount?: (message: ChatMessage) => number | null
  onReact: (messageId: number, emoji: string) => void
  onReply: (message: ChatMessage) => void
  onEdit: (messageId: number, body: string) => void
  onDelete: (messageId: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const restoreRef = useRef<{ height: number; top: number } | null>(null)
  const lastSeenRef = useRef(0)
  const prevCountRef = useRef(0)

  const latestId = messages.length ? messages[messages.length - 1].id : 0

  const loadOlder = () => {
    const el = scrollRef.current
    if (el) restoreRef.current = { height: el.scrollHeight, top: el.scrollTop }
    onLoadOlder()
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottomRef.current && latestId && latestId !== lastSeenRef.current) {
      lastSeenRef.current = latestId
      onSeenLatest(latestId)
    }
    if (el.scrollTop < 80 && hasOlder && !loadingOlder) loadOlder()
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (restoreRef.current) {
      el.scrollTop = el.scrollHeight - restoreRef.current.height + restoreRef.current.top
      restoreRef.current = null
    } else if (nearBottomRef.current || prevCountRef.current === 0) {
      el.scrollTop = el.scrollHeight
    }
    prevCountRef.current = messages.length
  }, [messages])

  useEffect(() => {
    if (latestId && nearBottomRef.current && latestId !== lastSeenRef.current) {
      lastSeenRef.current = latestId
      onSeenLatest(latestId)
    }
  }, [latestId, onSeenLatest])

  if (loading) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="scrollbar-styled flex-1 overflow-y-auto py-2">
      {hasOlder && (
        <div className="flex justify-center py-2">
          {loadingOlder ? (
            <Spinner size="sm" />
          ) : (
            <button
              type="button"
              onClick={loadOlder}
              className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
            >
              Load earlier messages
            </button>
          )}
        </div>
      )}

      {messages.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-slate-500">No messages yet — say hello 👋</div>
      ) : (
        messages.map((m, i) => {
          const prev = messages[i - 1]
          const showDay =
            !prev ||
            new Date(m.created_at ?? 0).toDateString() !== new Date(prev.created_at ?? 0).toDateString()
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex items-center gap-3 px-4">
                  <span className="h-px flex-1 bg-slate-800" />
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    {dayLabel(m.created_at)}
                  </span>
                  <span className="h-px flex-1 bg-slate-800" />
                </div>
              )}
              <MessageBubble
                message={m}
                meId={meId}
                showHeader={startsNewGroup(showDay ? undefined : prev, m)}
                canModerate={canModerate}
                memberNames={memberNames}
                seenCount={seenCount?.(m) ?? null}
                onReact={onReact}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            </div>
          )
        })
      )}

      <TypingIndicator names={typingNames} />
    </div>
  )
}
