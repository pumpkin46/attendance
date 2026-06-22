import { cn } from '@/shared/lib/cn'
import { ConversationAvatar } from '@/features/chat/components/Avatar'
import type { ChatConversation } from '@/features/chat/types'

export function ConversationHeader({
  conversation,
  presence,
  onlineCount,
  callable,
  onStartCall,
  onOpenInfo,
  onTogglePin,
}: {
  conversation: ChatConversation
  presence: Set<number>
  onlineCount: number
  callable: boolean
  onStartCall: (video: boolean) => void
  onOpenInfo: () => void
  onTogglePin: () => void
}) {
  const c = conversation
  const online = c.type === 'direct' && c.counterpart ? presence.has(c.counterpart.id) : undefined

  let subtitle: string
  if (c.type === 'direct') {
    subtitle = online ? 'Online' : 'Offline'
  } else {
    const members = `${c.member_count} member${c.member_count === 1 ? '' : 's'}`
    subtitle = onlineCount > 0 ? `${members}, ${onlineCount} online` : members
  }

  const iconBtn =
    'grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200'

  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4">
      <button
        type="button"
        onClick={onOpenInfo}
        className="flex min-w-0 items-center gap-3 rounded-lg py-1 pr-2 text-left transition-colors hover:bg-slate-800/50"
      >
        <ConversationAvatar conv={c} size="sm" online={online} />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-slate-100">
            {c.type === 'channel' && <span className="text-slate-500">#</span>}
            {c.name ?? 'Conversation'}
          </div>
          <div className="truncate text-xs text-slate-400">{subtitle}</div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={c.is_pinned ? 'Unpin conversation' : 'Pin conversation'}
          title={c.is_pinned ? 'Unpin' : 'Pin'}
          className={cn(iconBtn, c.is_pinned && 'text-blue-400 hover:text-blue-300')}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill={c.is_pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2.5 21.5 9.5M9 8.5 4.7 9.9a1 1 0 0 0-.4 1.6l8.2 8.2a1 1 0 0 0 1.6-.4L15.5 15M9 8.5 15.5 15M9 8.5 13.5 4M15.5 15 20 10.5M3 21l4.5-4.5" />
          </svg>
        </button>
        {callable && (
          <>
            <button type="button" onClick={() => onStartCall(false)} aria-label="Voice call" title="Voice call" className={cn(iconBtn, 'hover:text-emerald-500')}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button type="button" onClick={() => onStartCall(true)} aria-label="Video call" title="Video call" className={cn(iconBtn, 'hover:text-indigo-500')}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="6" width="13" height="12" rx="2" />
                <path d="m16 9.5 5-3v11l-5-3z" />
              </svg>
            </button>
          </>
        )}
        <button type="button" onClick={onOpenInfo} aria-label="Conversation info" title="Conversation info" className={iconBtn}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
    </div>
  )
}
