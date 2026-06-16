import type { LiveDetectionFace } from '@/features/recognition/types'

/** Short human label for a live detection box / list row. */
export function faceLabel(f: LiveDetectionFace): string {
  switch (f.status) {
    case 'recognized': {
      const conf = f.confidence != null ? ` · ${(f.confidence * 100).toFixed(0)}%` : ''
      return `${f.name ?? 'Recognized'}${conf}`
    }
    case 'spoof':
      return 'Spoof / liveness'
    case 'unknown':
      return 'Unknown'
    default:
      return 'Detecting…'
  }
}
