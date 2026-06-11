import { useEffect, useState } from 'react'
import { validatePoseImage } from '@/features/enrollment/api/queries'
import { liveGuidance, type LiveGuidance } from '@/features/enrollment/types'

const POLL_INTERVAL_MS = 900
const FIRST_POLL_DELAY_MS = 400

/**
 * While the camera is live, periodically validates a preview frame against the
 * current pose slot and turns the result into coaching text ("Raise your chin
 * a little", "Pose looks good — capture now") so users self-correct before
 * pressing capture. Polls one request at a time and pauses on hidden tabs.
 */
export function useLivePoseGuide({
  enabled,
  poseType,
  captureFrame,
}: {
  enabled: boolean
  poseType?: string
  captureFrame: (maxWidth?: number, quality?: number) => string | null
}): LiveGuidance | null {
  const [guide, setGuide] = useState<LiveGuidance | null>(null)

  useEffect(() => {
    // No reset needed when disabled: the previous run's cleanup already nulled
    // the guide before this effect re-ran.
    if (!enabled || !poseType) return
    let cancelled = false
    let timer: number

    const tick = async () => {
      if (cancelled) return
      if (!document.hidden) {
        // Same fidelity rationale as the real capture: small or heavily
        // compressed frames trip the resolution/blur gates and would coach
        // the user toward problems they don't have.
        const frame = captureFrame(1280, 0.85)
        if (frame) {
          try {
            const data = await validatePoseImage({ image: frame, expected_pose: poseType })
            if (!cancelled) setGuide(liveGuidance(data.accepted, data.reason))
          } catch {
            // Transient network/server hiccup — keep showing the last hint.
          }
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(tick, FIRST_POLL_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      setGuide(null)
    }
  }, [enabled, poseType, captureFrame])

  return guide
}
