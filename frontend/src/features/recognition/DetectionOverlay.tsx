import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { faceLabel } from '@/features/recognition/detectionLabels'
import type { DetectionStatus, LiveDetectionFace } from '@/features/recognition/types'

/* Box border + label colours per detection status. */
const STATUS_BOX: Record<DetectionStatus, string> = {
  recognized: 'border-emerald-400',
  unknown: 'border-amber-400',
  spoof: 'border-red-500',
  detecting: 'border-sky-400',
}
const STATUS_CHIP: Record<DetectionStatus, string> = {
  recognized: 'bg-emerald-500 text-white',
  unknown: 'bg-amber-500 text-slate-950',
  spoof: 'bg-red-500 text-white',
  detecting: 'bg-sky-500 text-white',
}

/**
 * Draws live face bounding boxes + identity labels over a stream preview. The
 * boxes come in normalized [0,1] frame coordinates; this maps them onto the
 * letterbox rect of an `object-contain` image, so it aligns whether the panel
 * is inline or fullscreen. Mount it as a sibling of the `<img>` inside a
 * `relative` box that exactly covers the image's container.
 */
export function DetectionOverlay({
  faces,
  frameWidth,
  frameHeight,
}: {
  faces: LiveDetectionFace[]
  frameWidth: number
  frameHeight: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Content rect of an object-contain image of (frameWidth x frameHeight) inside
  // this box — the same letterbox the browser computes for the <img>.
  const rect = (() => {
    const { w: cw, h: ch } = size
    if (!cw || !ch || !frameWidth || !frameHeight) return null
    const frameRatio = frameWidth / frameHeight
    if (frameRatio > cw / ch) {
      const h = cw / frameRatio
      return { left: 0, top: (ch - h) / 2, w: cw, h }
    }
    const w = ch * frameRatio
    return { left: (cw - w) / 2, top: 0, w, h: ch }
  })()

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {rect &&
        faces.map((f) => {
          const [x1, y1, x2, y2] = f.bbox
          const bw = (x2 - x1) * rect.w
          const bh = (y2 - y1) * rect.h
          if (bw <= 1 || bh <= 1) return null
          const left = rect.left + x1 * rect.w
          const top = rect.top + y1 * rect.h
          // Keep the label on-screen: below the box when it's near the top edge.
          const labelBelow = top < 22
          return (
            <div
              key={f.track_id}
              className={cn('absolute rounded-md border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]', STATUS_BOX[f.status])}
              style={{ left, top, width: bw, height: bh }}
            >
              <span
                className={cn(
                  'absolute left-0 max-w-[180px] truncate rounded px-1.5 py-0.5 text-[11px] font-semibold leading-tight',
                  STATUS_CHIP[f.status],
                  labelBelow ? 'top-full mt-0.5' : 'bottom-full mb-0.5'
                )}
              >
                {f.status === 'recognized' && f.liveness_passed ? '✓ ' : ''}
                {faceLabel(f)}
              </span>
            </div>
          )
        })}
    </div>
  )
}
