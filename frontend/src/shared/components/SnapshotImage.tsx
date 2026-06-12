import { AuthImage } from '@/shared/components/AuthImage'

/**
 * Thumbnail for a recognition event's stored snapshot. Thin wrapper over
 * {@link AuthImage} with viewport-lazy fetching and the shared blob cache —
 * gallery grids fetch only visible images and re-mounts reuse downloads.
 */
export function SnapshotImage({
  eventId,
  alt,
  className,
}: {
  eventId: number
  alt?: string
  className?: string
}) {
  return (
    <AuthImage
      src={`/recognition/events/${eventId}/snapshot`}
      alt={alt ?? 'Unknown face snapshot'}
      className={className}
      lazy
      cache
      fallback="No snapshot"
    />
  )
}
