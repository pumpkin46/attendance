import { cn } from '@/shared/lib/cn'
import { initials } from '@/shared/lib/format'
import type { ChatConversation } from '@/features/chat/types'

const COLORS = [
  'bg-blue-600',
  'bg-emerald-600',
  'bg-violet-600',
  'bg-rose-600',
  'bg-amber-600',
  'bg-cyan-600',
  'bg-indigo-600',
  'bg-pink-600',
  'bg-teal-600',
]

// eslint-disable-next-line react-refresh/only-export-components
export function avatarColor(seed: number | string): string {
  const n = typeof seed === 'number' ? seed : seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return COLORS[Math.abs(n) % COLORS.length]
}

const NAME_COLORS = [
  'text-indigo-400',
  'text-emerald-400',
  'text-violet-400',
  'text-rose-400',
  'text-amber-400',
  'text-cyan-400',
  'text-pink-400',
  'text-teal-400',
]

/** Stable per-user text colour for sender names (Slack/Telegram style). */
// eslint-disable-next-line react-refresh/only-export-components
export function nameColor(seed: number | string): string {
  const n = typeof seed === 'number' ? seed : seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return NAME_COLORS[Math.abs(n) % NAME_COLORS.length]
}

const sizes = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
} as const

const dotSize = { sm: 'h-2.5 w-2.5', md: 'h-3 w-3', lg: 'h-3.5 w-3.5' } as const

export function Avatar({
  name,
  seed,
  size = 'md',
  online,
}: {
  name?: string | null
  seed: number | string
  size?: keyof typeof sizes
  /** Render a presence dot: true=online, false=offline, undefined=no dot. */
  online?: boolean
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={cn(
          'grid place-items-center rounded-full font-semibold text-white',
          sizes[size],
          avatarColor(seed),
        )}
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span
          aria-label={online ? 'Online' : 'Offline'}
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-slate-900',
            dotSize[size],
            online ? 'bg-emerald-500' : 'bg-slate-500',
          )}
        />
      )}
    </span>
  )
}

const groupSizes = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
} as const

function HashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 3 8 21M16 3l-2 18M4 8h16M3 16h16" />
    </svg>
  )
}

function GroupIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8M17 19c0-2-.7-3.6-1.8-4.6" />
    </svg>
  )
}

/** Picks the right avatar for a conversation: counterpart for DMs, icon tiles for group/channel. */
export function ConversationAvatar({
  conv,
  size = 'md',
  online,
}: {
  conv: Pick<ChatConversation, 'id' | 'type' | 'name' | 'counterpart'>
  size?: keyof typeof sizes
  online?: boolean
}) {
  if (conv.type === 'direct') {
    return (
      <Avatar name={conv.counterpart?.name ?? conv.name} seed={conv.counterpart?.id ?? conv.id} size={size} online={online} />
    )
  }
  const isChannel = conv.type === 'channel'
  return (
    <span
      className={cn(
        'grid place-items-center rounded-full',
        groupSizes[size],
        isChannel ? 'bg-slate-700 text-slate-300' : cn(avatarColor(conv.id), 'text-white'),
      )}
    >
      {isChannel ? <HashIcon className="h-5 w-5" /> : <GroupIcon className="h-5 w-5" />}
    </span>
  )
}
