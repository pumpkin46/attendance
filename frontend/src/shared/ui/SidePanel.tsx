import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/lib/cn'

/** Must match the panel-out / backdrop-out animation durations in index.css. */
const EXIT_MS = 200

export function SidePanel({
  open = true,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: {
  /**
   * Render the panel unconditionally and toggle `open` so the exit animation
   * can play. Conditionally-mounted panels still animate in, but close instantly.
   * Initialize panel content state when opening, not in `onClose` — content
   * stays visible during the slide-out and a close-time reset would flash.
   */
  open?: boolean
  title: string
  description?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // Trails `open` so the panel stays mounted while the exit animation plays.
  const [present, setPresent] = useState(open)

  useEffect(() => {
    const timer = setTimeout(() => setPresent(open), open ? 0 : EXIT_MS)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Scroll-lock the page and move focus into the dialog while open.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      restoreFocusRef.current?.focus()
    }
  }, [open])

  if (!open && !present) return null
  const closing = !open

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px]',
        closing
          ? 'pointer-events-none animate-[backdrop-out_200ms_ease-in_both]'
          : 'animate-[backdrop-in_200ms_ease-out_both]'
      )}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl shadow-black/40 outline-none',
          closing
            ? 'animate-[panel-out_200ms_cubic-bezier(0.32,0.72,0,1)_both]'
            : 'animate-[panel-in_280ms_cubic-bezier(0.32,0.72,0,1)_both]',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-100">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="scrollbar-styled flex-1 overflow-y-auto p-6">{children}</div>

        {footer && (
          <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/95 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
