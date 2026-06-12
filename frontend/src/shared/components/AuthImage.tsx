import { useEffect, useState, type ReactNode } from 'react'
import { api } from '@/shared/api/client'
import { toApiPath } from '@/shared/lib/authMedia'
import { useInViewport } from '@/shared/hooks/useInViewport'

/**
 * Shared blob-URL cache for `cache`-mode images, so re-mounts (view toggles,
 * pagination, lightboxes) reuse the downloaded image instead of re-fetching.
 * Bounded LRU: hits refresh recency, so eviction (which revokes the URL)
 * targets entries no recent mount has touched. Should an on-screen URL ever
 * be revoked anyway, the <img> onError clears the entry and refetches once.
 */
const CACHE_MAX = 300
const blobCache = new Map<string, Promise<string>>()

function getCachedUrl(src: string): Promise<string> {
  const cached = blobCache.get(src)
  if (cached) {
    // LRU touch: re-insert so iteration order reflects recency.
    blobCache.delete(src)
    blobCache.set(src, cached)
    return cached
  }

  const promise = api
    .get(toApiPath(src), { responseType: 'blob' })
    .then((r) => URL.createObjectURL(r.data))
  // Drop failures from the cache so a later mount retries instead of
  // permanently showing the error state.
  promise.catch(() => blobCache.delete(src))
  blobCache.set(src, promise)

  if (blobCache.size > CACHE_MAX) {
    const [oldestKey, oldest] = blobCache.entries().next().value!
    blobCache.delete(oldestKey)
    oldest.then((url) => URL.revokeObjectURL(url)).catch(() => {})
  }
  return promise
}

/**
 * Authenticated image: fetches the source through the API client (bearer
 * token attached) and renders it from a blob URL. `data:` URLs render
 * directly.
 *
 * - `lazy` defers the fetch until the element nears the viewport — a gallery
 *   of 50 thumbnails fetches only the visible dozen.
 * - `cache` keeps the blob in a shared LRU across mounts (the cache owns the
 *   URL lifecycle); without it the URL is revoked on unmount.
 */
export function AuthImage({
  src,
  alt = '',
  className,
  lazy = false,
  cache = false,
  fallback = 'Failed to load',
}: {
  src: string
  alt?: string
  className?: string
  lazy?: boolean
  cache?: boolean
  /** Content shown when the image can't be loaded. */
  fallback?: ReactNode
}) {
  const direct = src && src.startsWith('data:') ? src : null
  const needsFetch = Boolean(src) && !direct

  const [ref, inView] = useInViewport<HTMLDivElement>()
  const visible = !lazy || inView
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Bumped when the <img> errors (e.g. its cached blob URL was evicted and
  // revoked while mounted) to refetch once; a second failure shows `fallback`.
  const [attempt, setAttempt] = useState(0)

  // Reset cached blob/error state when the source changes (render-phase, not in an effect).
  const [trackedSrc, setTrackedSrc] = useState(src)
  if (src !== trackedSrc) {
    setTrackedSrc(src)
    setBlobUrl(null)
    setFailed(false)
    setAttempt(0)
  }

  useEffect(() => {
    if (!needsFetch || !visible) return
    let cancelled = false

    if (cache) {
      getCachedUrl(src).then(
        (url) => {
          if (!cancelled) setBlobUrl(url)
        },
        () => {
          if (!cancelled) setFailed(true)
        }
      )
      return () => {
        cancelled = true
      }
    }

    // Uncached: this mount owns the object URL and revokes it on unmount.
    let objectUrl: string | null = null
    api
      .get(toApiPath(src), { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data)
        setBlobUrl(objectUrl)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) {
          setBlobUrl(null)
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, needsFetch, visible, cache, attempt])

  const onImgError = cache
    ? () => {
        blobCache.delete(src)
        setBlobUrl(null)
        if (attempt < 1) setAttempt(attempt + 1)
        else setFailed(true)
      }
    : undefined

  if (direct) {
    return <img src={direct} alt={alt} className={className} />
  }

  if (failed) {
    return (
      <div
        className={`grid place-items-center bg-slate-800 text-xs text-slate-500 ${className ?? ''}`}
      >
        {fallback}
      </div>
    )
  }

  if (!blobUrl) {
    return <div ref={ref} className={`animate-pulse bg-slate-800 ${className ?? ''}`} />
  }

  return (
    <img src={blobUrl} alt={alt} decoding="async" onError={onImgError} className={className} />
  )
}
