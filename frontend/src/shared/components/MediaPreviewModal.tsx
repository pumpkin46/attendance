import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '@/shared/api/client'
import { toApiPath } from '@/shared/lib/authMedia'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

export interface MediaPreviewItem {
  url: string
  /** Header label; also used as the suggested download filename. */
  title?: string
}

const DownloadIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
)
const ChevronLeftIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
)
const ChevronRightIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
)

function NavButton({
  dir,
  disabled,
  onClick,
}: {
  dir: 'prev' | 'next'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={dir === 'prev' ? 'Previous item' : 'Next item'}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full',
        'border border-slate-700 bg-slate-900/80 text-slate-200 shadow-lg shadow-black/40 backdrop-blur transition-all',
        'hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        'disabled:pointer-events-none disabled:opacity-30',
        dir === 'prev' ? 'left-3' : 'right-3'
      )}
    >
      {dir === 'prev' ? ChevronLeftIcon : ChevronRightIcon}
    </button>
  )
}

/**
 * Lightbox for authenticated media: fetches each URL through the API client
 * (bearer token attached) and previews it inline — images directly, PDFs via
 * the browser's embedded viewer. With more than one item it becomes a gallery
 * with prev/next controls and arrow-key navigation.
 */
export function MediaPreviewModal({
  items,
  initialIndex = 0,
  onClose,
}: {
  items: MediaPreviewItem[]
  initialIndex?: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), items.length - 1))
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [kind, setKind] = useState<'image' | 'pdf' | 'other'>('other')
  const [failed, setFailed] = useState(false)

  const current = items[index]
  const hasPrev = index > 0
  const hasNext = index < items.length - 1

  // Reset per-item state when navigating (render-phase, not in an effect).
  const [trackedUrl, setTrackedUrl] = useState(current?.url)
  if (current && current.url !== trackedUrl) {
    setTrackedUrl(current.url)
    setBlobUrl(null)
    setFailed(false)
  }

  useEffect(() => {
    if (!current) return
    let cancelled = false
    let objectUrl: string | null = null
    api
      .get(toApiPath(current.url), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        const blob: Blob = res.data
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
        setKind(blob.type === 'application/pdf' ? 'pdf' : blob.type.startsWith('image/') ? 'image' : 'other')
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [current])

  // Capture phase so Escape closes only this modal, not an underlying
  // SidePanel listening for the same key on the window bubble phase.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        setIndex((i) => Math.max(0, i - 1))
      } else if (e.key === 'ArrowRight') {
        setIndex((i) => Math.min(items.length - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, items.length])

  const download = () => {
    if (!blobUrl) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = current?.title || 'download'
    a.click()
  }

  if (!current) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={current.title ?? 'Media preview'}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="min-w-0 truncate text-sm font-semibold text-slate-100">
              {current.title ?? 'Preview'}
            </h2>
            {items.length > 1 && (
              <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                {index + 1} / {items.length}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" leftIcon={DownloadIcon} disabled={!blobUrl} onClick={download}>
              Download
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="relative grid min-h-[16rem] flex-1 place-items-center overflow-auto bg-slate-950">
          {items.length > 1 && (
            <>
              <NavButton dir="prev" disabled={!hasPrev} onClick={() => setIndex(index - 1)} />
              <NavButton dir="next" disabled={!hasNext} onClick={() => setIndex(index + 1)} />
            </>
          )}
          {failed ? (
            <p className="p-10 text-sm text-red-400">Failed to load this file.</p>
          ) : !blobUrl ? (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-blue-400" />
          ) : kind === 'image' ? (
            <img src={blobUrl} alt={current.title ?? ''} className="max-h-[75vh] w-auto object-contain" />
          ) : kind === 'pdf' ? (
            <iframe title={current.title ?? 'Document'} src={blobUrl} className="h-[75vh] w-full border-0" />
          ) : (
            <div className="p-10 text-center">
              <p className="text-sm text-slate-400">No inline preview available for this file type.</p>
              <Button size="sm" variant="ghost" className="mt-3" onClick={download}>
                Download file
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
