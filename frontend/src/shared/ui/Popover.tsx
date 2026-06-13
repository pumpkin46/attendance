import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/lib/cn'

interface PopoverProps {
  /** Element the popover is positioned against. */
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** Match the popover width to the anchor (default true). */
  matchWidth?: boolean
  /** Horizontal alignment against the anchor: 'start' = left edges, 'end' = right edges (default 'start'). */
  align?: 'start' | 'end'
  className?: string
}

/**
 * Portal-based popover anchored beneath a trigger element. Renders into
 * document.body so it is never clipped by overflow containers, repositions on
 * scroll/resize, and closes on outside click or Escape. Flips above the anchor
 * when there isn't room below.
 */
export function Popover({ anchorRef, open, onClose, children, matchWidth = true, align = 'start', className }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' })

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      const panel = panelRef.current
      const panelH = panel?.offsetHeight ?? 0
      const panelW = matchWidth ? r.width : panel?.offsetWidth ?? 0
      const gap = 6
      const margin = 8
      const below = window.innerHeight - r.bottom
      const flipUp = panelH > 0 && below < panelH + gap && r.top > below
      // Panels wider than their anchor (e.g. the user menu at the far right of
      // the header) would otherwise run off screen; clamp to the viewport.
      let left = align === 'end' ? r.right - panelW : r.left
      if (panelW > 0) {
        left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin))
      }
      const next: React.CSSProperties = {
        position: 'fixed',
        left,
        top: flipUp ? Math.max(8, r.top - panelH - gap) : r.bottom + gap,
        visibility: 'visible',
        zIndex: 70,
      }
      if (matchWidth) next.width = r.width
      setStyle(next)
    }
    update()
    // Re-measure after first paint so flip logic sees the real panel height.
    const raf = requestAnimationFrame(update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchorRef, matchWidth, align])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={cn(
        'rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/40',
        'animate-[popover-in_120ms_ease-out]',
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
