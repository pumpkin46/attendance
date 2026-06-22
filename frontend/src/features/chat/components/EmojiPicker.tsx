import { useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Popover } from '@/shared/ui/Popover'
import { EMOJI_CATEGORIES } from '@/features/chat/components/emojiData'

const RECENTS_KEY = 'chat-emoji-recents'
const MAX_RECENTS = 24

function loadRecents(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENTS)
      : []
  } catch {
    return []
  }
}

function pushRecent(emoji: string): string[] {
  const next = [emoji, ...loadRecents().filter((x) => x !== emoji)].slice(0, MAX_RECENTS)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota — recents are best-effort */
  }
  return next
}

/**
 * A professional, dependency-free emoji picker: search, category tabs with
 * scroll-spy, a recently-used row, and a portal-anchored popover. Used for both
 * message reactions and composer insertion.
 */
export function EmojiPicker({
  anchorRef,
  open,
  onClose,
  onPick,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  onPick: (emoji: string) => void
}) {
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(() => loadRecents())
  const [activeCat, setActiveCat] = useState(EMOJI_CATEGORIES[0].id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Reset search + active tab + refresh recents when the picker opens (render-phase,
  // no effect). The body remounts at the top, so the first category is active.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setRecents(loadRecents())
      setActiveCat(EMOJI_CATEGORIES[0].id)
    }
  }

  const pick = (emoji: string) => {
    setRecents(pushRecent(emoji))
    onPick(emoji)
    onClose()
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const seen = new Set<string>()
    const out: string[] = []
    for (const cat of EMOJI_CATEGORIES) {
      for (const em of cat.emojis) {
        if ((em.k.includes(q) || em.e === query.trim()) && !seen.has(em.e)) {
          seen.add(em.e)
          out.push(em.e)
        }
      }
    }
    return out
  }, [query])

  const scrollToCategory = (id: string) => {
    setActiveCat(id)
    sectionRefs.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // Scroll-spy: highlight the category whose section header is at the top.
  const onScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    let current = EMOJI_CATEGORIES[0].id
    for (const cat of EMOJI_CATEGORIES) {
      const el = sectionRefs.current[cat.id]
      if (el && el.offsetTop - container.offsetTop <= top + 8) current = cat.id
    }
    // Scrolled to the bottom: force the last category active even when its
    // section is shorter than the viewport (can't reach the top threshold).
    if (top + container.clientHeight >= container.scrollHeight - 4) {
      current = EMOJI_CATEGORIES[EMOJI_CATEGORIES.length - 1].id
    }
    setActiveCat(current)
  }

  const EmojiButton = ({ emoji }: { emoji: string }) => (
    <button
      type="button"
      onClick={() => pick(emoji)}
      className="grid h-8 w-8 place-items-center rounded-md text-xl leading-none transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {emoji}
    </button>
  )

  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      matchWidth={false}
      align="end"
      className="w-[336px] p-0"
    >
      <div className="flex flex-col">
        {/* Search */}
        <div className="border-b border-slate-800 p-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-2.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji"
              className="w-full bg-transparent py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Category tabs (hidden while searching) */}
        {!results && (
          <div className="flex items-center gap-0.5 border-b border-slate-800 px-1.5 py-1">
            {EMOJI_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                aria-label={cat.label}
                title={cat.label}
                onClick={() => scrollToCategory(cat.id)}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-md text-lg transition-colors',
                  activeCat === cat.id ? 'bg-slate-800 ring-1 ring-blue-500/40' : 'hover:bg-slate-800/60 grayscale',
                )}
              >
                {cat.icon}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div ref={scrollRef} onScroll={onScroll} className="scrollbar-styled h-64 overflow-y-auto px-2 py-1.5">
          {results ? (
            results.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No emoji found</p>
            ) : (
              <div className="grid grid-cols-8 gap-0.5">
                {results.map((e) => (
                  <EmojiButton key={e} emoji={e} />
                ))}
              </div>
            )
          ) : (
            <>
              {recents.length > 0 && (
                <div className="mb-1">
                  <div className="sticky top-0 z-10 bg-slate-900 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Recently used
                  </div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {recents.map((e) => (
                      <EmojiButton key={`r-${e}`} emoji={e} />
                    ))}
                  </div>
                </div>
              )}
              {EMOJI_CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  ref={(el) => {
                    sectionRefs.current[cat.id] = el
                  }}
                  className="mb-1"
                >
                  <div className="sticky top-0 z-10 bg-slate-900 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {cat.label}
                  </div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {cat.emojis.map((em) => (
                      <EmojiButton key={em.e} emoji={em.e} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </Popover>
  )
}
