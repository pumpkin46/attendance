import { useEffect, useState } from 'react'
import { api } from '@/shared/api/client'
import { useInViewport } from '@/shared/hooks/useInViewport'

/**
 * Snapshot blob URLs cached per event, so re-mounts (gallery/table view
 * toggles, pagination, the detail lightbox) reuse the downloaded image
 * instead of re-fetching it. Bounded LRU: hits refresh recency, so eviction
 * (which revokes the URL) targets entries no recent mount has touched. Should
 * an on-screen URL ever be revoked anyway, the <img> onError below clears the
 * cache entry and refetches once.
 */
const CACHE_MAX = 300
const snapshotCache = new Map<number, Promise<string>>()

function getSnapshotUrl(eventId: number): Promise<string> {
  const cached = snapshotCache.get(eventId)
  if (cached) {
    // LRU touch: re-insert so iteration order reflects recency.
    snapshotCache.delete(eventId)
    snapshotCache.set(eventId, cached)
    return cached
  }

  const promise = api
    .get(`/recognition/events/${eventId}/snapshot`, { responseType: 'blob' })
    .then((r) => URL.createObjectURL(r.data))
  // Drop failures from the cache so a later mount retries instead of
  // permanently showing the error state.
  promise.catch(() => snapshotCache.delete(eventId))
  snapshotCache.set(eventId, promise)

  if (snapshotCache.size > CACHE_MAX) {
    const [oldestId, oldest] = snapshotCache.entries().next().value!
    snapshotCache.delete(oldestId)
    oldest.then((url) => URL.revokeObjectURL(url)).catch(() => {})
  }
  return promise
}

export function SnapshotImage({
  eventId,
  alt,
  className,
}: {
  eventId: number
  alt?: string
  className?: string
}) {
  // Defer the fetch until the thumbnail is near the viewport — a 50-item
  // gallery would otherwise fire 50 authenticated requests on mount.
  const [ref, inView] = useInViewport<HTMLDivElement>()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumped when the <img> errors (e.g. its blob URL was evicted+revoked while
  // mounted) to refetch once; a second failure shows the error state.
  const [attempt, setAttempt] = useState(0)

  // Reset when the event changes (the lightbox navigates with prev/next)
  // — render-phase, not in an effect.
  const [trackedId, setTrackedId] = useState(eventId)
  if (eventId !== trackedId) {
    setTrackedId(eventId)
    setSrc(null)
    setFailed(false)
    setAttempt(0)
  }

  useEffect(() => {
    if (!inView) return
    let cancelled = false
    getSnapshotUrl(eventId).then(
      (url) => {
        if (!cancelled) setSrc(url)
      },
      () => {
        if (!cancelled) setFailed(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [eventId, inView, attempt])

  const onImgError = () => {
    snapshotCache.delete(eventId)
    setSrc(null)
    if (attempt < 1) setAttempt(attempt + 1)
    else setFailed(true)
  }

  if (failed) {
    return (
      <div
        className={`grid place-items-center bg-slate-800 text-xs text-slate-500 ${className ?? ''}`}
      >
        No snapshot
      </div>
    )
  }

  if (!src) {
    return <div ref={ref} className={`animate-pulse bg-slate-800 ${className ?? ''}`} />
  }

  return (
    <img
      src={src}
      alt={alt ?? 'Unknown face snapshot'}
      decoding="async"
      onError={onImgError}
      className={className}
    />
  )
}
