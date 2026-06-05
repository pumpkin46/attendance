import { useEffect, useState } from 'react'
import { api } from '@/shared/api/client'
import { toApiPath } from '@/shared/lib/authMedia'

export function AuthImage({
  src,
  alt = '',
  className,
}: {
  src: string
  alt?: string
  className?: string
}) {
  const direct = src && src.startsWith('data:') ? src : null
  const needsFetch = Boolean(src) && !direct
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  // Reset cached blob/error state when the source changes (render-phase, not in an effect).
  const [trackedSrc, setTrackedSrc] = useState(src)
  if (src !== trackedSrc) {
    setTrackedSrc(src)
    setBlobUrl(null)
    setFailed(false)
  }

  useEffect(() => {
    if (!needsFetch) return

    let objectUrl: string | null = null
    let cancelled = false

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
  }, [src, needsFetch])

  if (direct) {
    return <img src={direct} alt={alt} className={className} />
  }

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-800 text-xs text-slate-500 ${className ?? ''}`}
      >
        Failed to load
      </div>
    )
  }

  if (!blobUrl) {
    return <div className={`animate-pulse bg-slate-800 ${className ?? ''}`} />
  }

  return <img src={blobUrl} alt={alt} className={className} />
}
