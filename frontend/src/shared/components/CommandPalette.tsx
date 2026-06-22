import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ALL_NAV_ITEMS, type FlatNavItem } from '@/app/navigation'
import { ROUTE_PERMISSIONS } from '@/app/access'
import { useAuth } from '@/features/auth/AuthProvider'
import { prefetchRoute } from '@/app/routes'
import { EmptyState } from '@/shared/ui/EmptyState'
import { cn } from '@/shared/lib/cn'

const OPEN_EVENT = 'command-palette:open'

/** Open the command palette from anywhere (e.g. the header search button). */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

const SearchIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

/**
 * ⌘/Ctrl-K command palette: fuzzy-search and jump to any page the current user
 * can access. Mount once inside the authenticated shell.
 */
export function CommandPalette() {
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Only pages the user may reach (mirrors the route guards + sidebar).
  const items = useMemo(
    () =>
      ALL_NAV_ITEMS.filter((i) => {
        const perm = ROUTE_PERMISSIONS[i.to]
        return !perm || hasPermission(perm)
      }),
    [hasPermission]
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => `${i.label} ${i.group} ${i.keywords ?? ''}`.toLowerCase().includes(q))
  }, [items, query])

  // Toggle on Ctrl/Cmd+K; also openable via the custom event.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => setActive(0), [query])

  // Keep the highlighted row in view as the selection moves.
  useEffect(() => {
    ;(listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const close = () => setOpen(false)
  const choose = (item?: FlatNavItem) => {
    if (!item) return
    close()
    navigate(item.to)
  }

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active])
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-[2px] animate-[backdrop-in_150ms_ease-out_both]"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/50 animate-[dialog-in_200ms_cubic-bezier(0.32,0.72,0,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4">
          {SearchIcon}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="w-full bg-transparent py-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="hidden rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:block">
            Esc
          </kbd>
        </div>

        {results.length === 0 ? (
          <EmptyState title="No matches" description={`Nothing matches “${query}”.`} className="py-10" />
        ) : (
          <ul ref={listRef} className="scrollbar-styled max-h-[50vh] overflow-y-auto p-1.5">
            {results.map((item, i) => (
              <li key={item.to}>
                <button
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onMouseEnter={() => prefetchRoute(item.to)}
                  onClick={() => choose(item)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    i === active ? 'bg-blue-500/15 text-blue-200' : 'text-slate-300 hover:bg-slate-800'
                  )}
                >
                  <span className="shrink-0 text-slate-500">{item.group}</span>
                  <span className="shrink-0 text-slate-600">/</span>
                  <span className="truncate font-medium">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body
  )
}
