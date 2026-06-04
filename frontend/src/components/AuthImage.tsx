import { useEffect, useState } from 'react'
import { api } from '../api/client'

/** Strip /api/v1 prefix so axios baseURL resolves correctly. */
export function toApiPath(url: string): string {
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  const prefix = '/api/v1'
  if (url.startsWith(prefix)) {
    return url.slice(prefix.length)
  }
  return url.startsWith('/') ? url : `/${url}`
}

export function AuthImage({
  src,
  alt = '',
  className,
}: {
  src: string
  alt?: string
  className?: string
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!src) {
      setBlobUrl(null)
      setFailed(false)
      return
    }

    if (src.startsWith('data:')) {
      setBlobUrl(src)
      setFailed(false)
      return
    }

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
  }, [src])

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

export async function openAuthMedia(url: string) {
  if (url.startsWith('data:')) {
    window.open(url, '_blank')
    return
  }
  const res = await api.get(toApiPath(url), { responseType: 'blob' })
  const objectUrl = URL.createObjectURL(res.data)
  window.open(objectUrl, '_blank')
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}
