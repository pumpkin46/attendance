import { useEffect, useState } from 'react'
import { api } from '../api/client'

export function SnapshotImage({
  eventId,
  alt,
  className,
}: {
  eventId: number
  alt?: string
  className?: string
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null

    api
      .get(`/recognition/events/${eventId}/snapshot`, { responseType: 'blob' })
      .then((r) => {
        objectUrl = URL.createObjectURL(r.data)
        setSrc(objectUrl)
      })
      .catch(() => setSrc(null))

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [eventId])

  if (!src) {
    return (
      <div
        className={`grid place-items-center bg-slate-800 text-xs text-slate-500 ${className ?? ''}`}
      >
        No snapshot
      </div>
    )
  }

  return <img src={src} alt={alt ?? 'Unknown face snapshot'} className={className} />
}
