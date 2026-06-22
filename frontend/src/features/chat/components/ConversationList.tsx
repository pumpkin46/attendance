import { useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { relativeTime } from '@/shared/lib/format'
import { Spinner } from '@/shared/ui/Loading'
import { ConversationAvatar } from '@/features/chat/components/Avatar'
import type { ChatConversation } from '@/features/chat/types'

type Filter = 'all' | 'direct' | 'group' | 'channel'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'direct', label: 'Direct' },
  { id: 'group', label: 'Groups' },
  { id: 'channel', label: 'Channels' },
]

function preview(conv: ChatConversation): string {
  const m = conv.last_message
  if (!m) return 'No messages yet'
  if (m.deleted_at) return 'Message deleted'
  if (m.type === 'system') return m.body ?? ''
  let text = m.body || ''
  if (!text && m.attachments.length) {
    const a = m.attachments[0]
    text = a.kind === 'audio' ? 'Voice message' : a.kind === 'image' ? 'Photo' : 'Attachment'
  }
  if (conv.type === 'direct') return text
  const who = m.sender?.name?.split(' ')[0] ?? 'Someone'
  return `${who}: ${text}`
}

function DoubleCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1.5 12.5 6 17l1.2-1.2M11 7l-6.8 8" />
      <path d="m12.5 12.5 4.5 4.5L23 8" />
    </svg>
  )
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M14.5 2.5a1 1 0 0 0-1.7.7v.4L8.6 8.3l-3.3 1.1a1 1 0 0 0-.4 1.6l3 3-4 4a1 1 0 1 0 1.4 1.4l4-4 3 3a1 1 0 0 0 1.6-.4l1.1-3.3 4.7-4.2h.4a1 1 0 0 0 .7-1.7l-5.5-5.6z" />
    </svg>
  )
}

export function ConversationList({
  conversations,
  loading,
  selectedId,
  onSelect,
  presence,
  typingConvIds,
  meId,
  search,
  onSearch,
  onNew,
  onBrowseChannels,
  onTogglePin,
}: {
  conversations: ChatConversation[]
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  presence: Set<number>
  typingConvIds: Set<number>
  meId: number | null
  search: string
  onSearch: (v: string) => void
  onNew: () => void
  onBrowseChannels: () => void
  onTogglePin: (conv: ChatConversation) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return conversations.filter((c) => {
      if (filter !== 'all' && c.type !== filter) return false
      if (!term) return true
      return (c.name ?? '').toLowerCase().includes(term)
    })
  }, [conversations, filter, search])

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-lg font-semibold text-slate-100">Messages</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBrowseChannels}
            aria-label="Browse channels"
            title="Browse channels"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 3 8 21M16 3l-2 18M4 8h16M3 16h16" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNew}
            aria-label="New conversation"
            title="New conversation"
            className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-500"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex gap-1 px-3 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              filter === f.id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="scrollbar-styled min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="grid h-32 place-items-center">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate-500">No conversations</p>
        ) : (
          filtered.map((c) => {
            const online = c.type === 'direct' && c.counterpart ? presence.has(c.counterpart.id) : undefined
            const selected = c.id === selectedId
            const typer = typingConvIds.has(c.id)
            const lastMine =
              !!c.last_message &&
              c.last_message.type !== 'system' &&
              !c.last_message.deleted_at &&
              c.last_message.sender?.id === meId
            return (
              <div
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors',
                  selected ? 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/20' : 'hover:bg-slate-800/60',
                )}
              >
                <ConversationAvatar conv={c} online={online} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm',
                        c.unread_count > 0 ? 'font-semibold text-slate-100' : 'font-medium text-slate-200',
                      )}
                    >
                      {c.name ?? 'Conversation'}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {c.is_pinned && <PinIcon className="h-3 w-3 text-blue-400" />}
                      <span
                        className={cn(
                          'text-[10px]',
                          c.unread_count > 0 ? 'font-semibold text-blue-400' : 'text-slate-500',
                        )}
                      >
                        {relativeTime(c.last_message_at)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1">
                      {lastMine && !typer && <DoubleCheck className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                      <span
                        className={cn(
                          'truncate text-xs',
                          typer ? 'font-medium text-emerald-400' : c.unread_count > 0 ? 'text-slate-300' : 'text-slate-500',
                        )}
                      >
                        {typer ? 'Typing…' : preview(c)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={c.is_pinned ? 'Unpin' : 'Pin'}
                        title={c.is_pinned ? 'Unpin' : 'Pin'}
                        onClick={(e) => {
                          e.stopPropagation()
                          onTogglePin(c)
                        }}
                        className={cn(
                          'hidden h-5 w-5 place-items-center rounded text-slate-500 hover:text-blue-400 group-hover:grid',
                          c.is_pinned && 'text-blue-400',
                        )}
                      >
                        <PinIcon className="h-3.5 w-3.5" />
                      </button>
                      {c.unread_count > 0 && (
                        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[11px] font-semibold tabular-nums text-white">
                          {c.unread_count > 99 ? '99+' : c.unread_count}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
