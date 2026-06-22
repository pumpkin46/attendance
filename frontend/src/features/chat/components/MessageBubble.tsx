import { useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatTime } from '@/shared/lib/format'
import { AuthImage } from '@/shared/components/AuthImage'
import { openAuthMedia } from '@/shared/lib/authMedia'
import { Textarea } from '@/shared/ui/Textarea'
import { Button } from '@/shared/ui/Button'
import { Avatar, nameColor } from '@/features/chat/components/Avatar'
import { AudioPlayer } from '@/features/chat/components/AudioPlayer'
import { EmojiPicker } from '@/features/chat/components/EmojiPicker'
import type { ChatAttachment, ChatMessage } from '@/features/chat/types'

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const URL_RE = /(https?:\/\/[^\s]+)/

type Segment = { type: 'text' | 'url' | 'mention'; value: string }

function tokenize(text: string, memberNames: string[]): Segment[] {
  const names = memberNames
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  const mention = names.length ? `@(?:${names.join('|')})` : null
  const re = new RegExp(`(${URL_RE.source}${mention ? '|' + mention : ''})`, 'g')
  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    const val = m[0]
    out.push({ type: val.startsWith('@') ? 'mention' : 'url', value: val })
    last = m.index + val.length
    if (m.index === re.lastIndex) re.lastIndex++
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}

function MessageBody({ text, memberNames, own }: { text: string; memberNames: string[]; own: boolean }) {
  const segments = useMemo(() => tokenize(text, memberNames), [text, memberNames])
  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((s, i) => {
        if (s.type === 'url') {
          return (
            <a
              key={i}
              href={s.value}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'break-all underline underline-offset-2',
                own ? 'text-blue-100 hover:text-white' : 'text-blue-400 hover:text-blue-300',
              )}
            >
              {s.value}
            </a>
          )
        }
        if (s.type === 'mention') {
          return (
            <span
              key={i}
              className={cn(
                'rounded px-1 font-medium',
                own ? 'bg-white/25 text-white' : 'bg-blue-500/15 text-blue-300',
              )}
            >
              {s.value}
            </span>
          )
        }
        return <span key={i}>{s.value}</span>
      })}
    </span>
  )
}

function AttachmentView({ a, own }: { a: ChatAttachment; own: boolean }) {
  if (a.kind === 'audio') {
    return <AudioPlayer src={a.url} own={own} />
  }
  if (a.kind === 'image') {
    return (
      <button
        type="button"
        onClick={() => void openAuthMedia(a.url)}
        className="block max-w-[260px] overflow-hidden rounded-2xl border border-slate-700/60 transition-opacity hover:opacity-90"
        title={a.filename}
      >
        <AuthImage src={a.url} alt={a.filename} cache lazy className="max-h-72 w-full object-cover" />
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => void openAuthMedia(a.url)}
      className={cn(
        'flex max-w-[260px] items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors',
        own ? 'bg-white/15 hover:bg-white/25' : 'border border-slate-700 bg-slate-800/60 hover:bg-slate-800',
      )}
    >
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
          own ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300',
        )}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 3v5h5" />
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate text-sm', own ? 'text-white' : 'text-slate-200')}>{a.filename}</span>
        <span className={cn('block text-xs', own ? 'text-blue-100' : 'text-slate-500')}>{bytes(a.size_bytes)}</span>
      </span>
    </button>
  )
}

function HoverAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100"
    >
      {children}
    </button>
  )
}

export function MessageBubble({
  message,
  meId,
  showHeader,
  canModerate,
  memberNames,
  seenCount,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: {
  message: ChatMessage
  meId: number | null
  showHeader: boolean
  canModerate: boolean
  memberNames: string[]
  /** Number of other members who've read this message (null = don't show). */
  seenCount?: number | null
  onReact: (messageId: number, emoji: string) => void
  onReply: (message: ChatMessage) => void
  onEdit: (messageId: number, body: string) => void
  onDelete: (messageId: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body ?? '')
  const emojiBtnRef = useRef<HTMLSpanElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (message.type === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-slate-800/70 px-3 py-1 text-xs text-slate-400">{message.body}</span>
      </div>
    )
  }

  const deleted = !!message.deleted_at
  const own = message.sender?.id === meId
  const mentionsMe = meId != null && message.mention_user_ids.includes(meId)
  const senderName = message.sender?.name ?? 'Unknown'
  const hasBody = !deleted && !!message.body
  const hasAttachments = !deleted && message.attachments.length > 0

  const startEdit = () => {
    setDraft(message.body ?? '')
    setEditing(true)
  }
  const saveEdit = () => {
    const next = draft.trim()
    if (next && next !== message.body) onEdit(message.id, next)
    setEditing(false)
  }

  const toolbar = !deleted && !editing && (
    <div
      className={cn(
        'absolute -top-3.5 z-10 items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-900 px-0.5 py-0.5 shadow-lg shadow-black/30',
        own ? 'left-2' : 'right-2',
        pickerOpen ? 'flex' : 'hidden group-hover:flex',
      )}
    >
      <HoverAction label="React" onClick={() => setPickerOpen(true)}>
        <span ref={emojiBtnRef} className="grid place-items-center">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" strokeLinecap="round" />
          </svg>
        </span>
      </HoverAction>
      <HoverAction label="Reply" onClick={() => onReply(message)}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 5 5v1" />
        </svg>
      </HoverAction>
      {own && (
        <HoverAction label="Edit" onClick={startEdit}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </HoverAction>
      )}
      {(own || canModerate) && (
        <HoverAction label="Delete" onClick={() => onDelete(message.id)}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
          </svg>
        </HoverAction>
      )}
    </div>
  )

  return (
    <div className={cn('group flex gap-2.5 px-4', showHeader ? 'mt-4' : 'mt-0.5', own && 'flex-row-reverse')}>
      <div className="w-9 shrink-0">
        {showHeader && <Avatar name={own ? 'You' : senderName} seed={message.sender?.id ?? senderName} size="sm" />}
      </div>

      <div className={cn('relative flex min-w-0 max-w-[78%] flex-col', own ? 'items-end' : 'items-start')}>
        {toolbar}

        {showHeader && !own && (
          <div className={cn('mb-0.5 px-1 text-xs font-semibold', nameColor(message.sender?.id ?? senderName))}>
            {senderName}
          </div>
        )}

        {message.reply_to && (
          <div className="mb-1 max-w-full rounded-lg border-l-2 border-blue-400/70 bg-slate-800/70 px-2 py-1 text-xs text-slate-400">
            <span className="font-medium text-slate-300">{message.reply_to.sender_name ?? 'Unknown'}</span>
            {message.reply_to.body ? <span className="ml-1 line-clamp-1">{message.reply_to.body}</span> : null}
          </div>
        )}

        {editing ? (
          <div className="w-[min(28rem,70vw)]">
            <Textarea
              value={draft}
              autoFocus
              maxRows={6}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  saveEdit()
                } else if (e.key === 'Escape') {
                  setEditing(false)
                }
              }}
            />
            <div className="mt-1 flex gap-2">
              <Button size="sm" onClick={saveEdit}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : deleted ? (
          <div className="rounded-2xl bg-slate-800/50 px-3.5 py-2 text-sm italic text-slate-500">This message was deleted</div>
        ) : (
          <div className={cn('flex flex-col gap-1.5', own ? 'items-end' : 'items-start')}>
            {(hasBody || hasAttachments) && (
              <div
                className={cn(
                  'w-fit max-w-full rounded-2xl px-3.5 py-2 text-sm',
                  own ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-100',
                  showHeader && (own ? 'rounded-tr-md' : 'rounded-tl-md'),
                  mentionsMe && !own && 'ring-1 ring-amber-400/40',
                )}
              >
                {hasBody && (
                  <MessageBody text={message.body ?? ''} memberNames={memberNames} own={own} />
                )}
                {hasAttachments && (
                  <div className={cn('flex flex-wrap gap-1.5', hasBody && 'mt-1.5')}>
                    {message.attachments.map((a) => (
                      <AttachmentView key={a.id} a={a} own={own} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Meta: views (seen count) + time + edited */}
            <div className={cn('flex items-center gap-1 px-1 text-[10px] text-slate-400', own && 'flex-row-reverse')}>
              <span>{formatTime(message.created_at)}</span>
              {seenCount != null && seenCount > 0 && (
                <span className="flex items-center gap-0.5">
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span className="tabular-nums">{seenCount}</span>
                </span>
              )}
              {message.edited_at && <span>· edited</span>}
            </div>
          </div>
        )}

        {!deleted && message.reactions.length > 0 && (
          <div className={cn('mt-1 flex flex-wrap gap-1', own && 'justify-end')}>
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(message.id, r.emoji)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                  r.me
                    ? 'border-blue-500/50 bg-blue-500/15 text-blue-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600',
                )}
              >
                <span>{r.emoji}</span>
                <span className="tabular-nums">{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <EmojiPicker
        anchorRef={emojiBtnRef}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(emoji) => onReact(message.id, emoji)}
      />
    </div>
  )
}
