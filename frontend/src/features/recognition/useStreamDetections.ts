import { useCallback, useState } from 'react'
import { useAuthedWebSocket } from '@/shared/hooks/useAuthedWebSocket'
import type { LiveDetectionFrame } from '@/features/recognition/types'

/**
 * Live per-face detection metadata for a registered server stream. Opens the
 * engine's detections WebSocket (`/engine/streams/{id}/detections/ws`) — the
 * companion channel to the raw-JPEG preview — and returns the latest snapshot
 * of boxes + tenant-gated identities for drawing an overlay.
 *
 * Pass `null` when no server stream is selected (e.g. local-webcam mode) to keep
 * the socket closed. Auth + reconnect are handled by `useAuthedWebSocket`.
 */
export function useStreamDetections(cameraId: number | null): LiveDetectionFrame | null {
  const [frame, setFrame] = useState<LiveDetectionFrame | null>(null)

  const onMessage = useCallback((ev: MessageEvent) => {
    if (typeof ev.data !== 'string') return
    try {
      const msg = JSON.parse(ev.data) as LiveDetectionFrame
      if (msg?.type === 'detections') setFrame(msg)
    } catch {
      /* ignore malformed frame */
    }
  }, [])

  useAuthedWebSocket({
    path: cameraId != null ? `/engine/streams/${cameraId}/detections/ws` : '',
    enabled: cameraId != null,
    onMessage,
    // Clear stale boxes when the camera changes or the panel unmounts.
    onTeardown: () => setFrame(null),
    deps: [cameraId],
  })

  return frame
}
