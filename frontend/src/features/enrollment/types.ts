export interface EnrollmentConfig {
  mode: string
  required_poses: string[]
  pose_labels?: Record<string, string>
  min_images: number
  max_images: number
  retain_raw_images: boolean
  quality_thresholds?: Record<string, number>
}

export interface PoseCapture {
  pose_type: string
  dataUrl: string
  accepted: boolean
  reason?: string
  quality_score?: number
  face_metadata?: Record<string, unknown>
}

export interface ValidateImageResult {
  accepted: boolean
  reason?: string
  quality_score?: number
  face_metadata?: Record<string, unknown>
}

export interface EnrollFaceResult {
  success: boolean
  embeddings_stored: number
  enrollment_score?: number
  average_quality_score?: number
}

export interface SimpleEnrollResult {
  success: boolean
  employee_id?: string | number
  error?: string
  embeddings_stored?: number
  average_quality_score?: number
  accepted_count?: number
  rejected_count?: number
  rejected?: { index: number; reason: string }[]
}

export interface LivenessResult {
  passed: boolean
  score: number
  blink_detected: boolean
  head_movement_detected: boolean
  frame_count: number
  reason?: string
  checks?: Record<string, unknown>
  processing_ms?: number
}

export interface HealthInfo {
  liveness_enabled?: boolean
  active_liveness_enabled?: boolean
  antispoof_model_loaded?: boolean
  liveness_methods?: {
    ai_model?: string
    blink_detection?: boolean
    head_movement?: boolean
    spoof_types?: string[]
  }
}

export const REASON_LABELS: Record<string, string> = {
  blurry: 'Too blurry',
  too_dark: 'Image too dark',
  low_resolution: 'Face too small / low resolution',
  multiple_faces: 'Multiple faces detected',
  no_face: 'No face detected',
  occluded_face: 'Face occluded or partial',
  covered_face: 'Face covered or partial',
  low_detection_score: 'Face not clear enough',
  low_quality: 'Overall quality too low',
  invalid_image: 'Invalid image',
  not_smiling: 'Please smile',
  not_neutral: 'Please use a neutral expression',
  glasses_not_detected: 'Glasses not visible',
  glasses_detected: 'Remove glasses for this step',
  wrong_pose: 'Pose does not match instruction',
  validation_error: 'Validation failed',
}

const POSE_HINTS: Record<string, string> = {
  front: 'face the camera straight on',
  left: 'turn your head left',
  right: 'turn your head right',
  up: 'tilt your head up slightly',
  down: 'tilt your head down slightly',
  smiling: 'smile',
  neutral: 'keep a neutral expression',
}

/**
 * Resolves a backend rejection reason to a friendly message. Handles the
 * dynamic `wrong_pose_expected_<pose>_got_<pose>` strings that have no fixed
 * label by turning them into an actionable hint.
 */
export function reasonLabel(reason?: string): string {
  if (!reason) return 'Image rejected'
  if (REASON_LABELS[reason]) return REASON_LABELS[reason]
  const m = /^wrong_pose_expected_([a-z_]+?)_got_/.exec(reason)
  if (m) {
    const hint = POSE_HINTS[m[1]]
    return hint ? `Pose doesn't match — please ${hint}` : 'Pose does not match instruction'
  }
  return reason.replace(/_/g, ' ')
}

export interface LiveGuidance {
  ok: boolean
  text: string
}

/** Corrective moves for the "front" slot, keyed by the pose the backend
 * actually detected (`wrong_pose_expected_front_got_<detected>`). */
const FRONT_CORRECTIONS: Record<string, string> = {
  left: 'Turn your head back to the right a little',
  right: 'Turn your head back to the left a little',
  up: 'Lower your chin a little',
  down: 'Raise your chin a little',
}

const LIVE_CORRECTIONS: Record<string, string> = {
  not_smiling: 'Give a bigger smile',
  not_neutral: 'Relax your expression',
  glasses_not_detected: 'Put your glasses on',
  glasses_detected: 'Take your glasses off',
  no_face: 'Center your face inside the guide',
  multiple_faces: 'Make sure only your face is in frame',
  blurry: 'Hold still — the image is blurry',
  too_dark: 'Add more light on your face',
  occluded_face: 'Uncover your face fully',
}

/**
 * Turns a live preview validation result into real-time coaching text so the
 * user can self-correct before pressing capture.
 */
export function liveGuidance(accepted: boolean, reason?: string): LiveGuidance {
  if (accepted) return { ok: true, text: 'Pose looks good — capture now' }
  if (reason && LIVE_CORRECTIONS[reason]) return { ok: false, text: LIVE_CORRECTIONS[reason] }
  const m = /^wrong_pose_expected_([a-z_]+?)_got_([a-z_]+)$/.exec(reason ?? '')
  if (m) {
    const [, expected, got] = m
    if (expected === 'front') {
      return { ok: false, text: FRONT_CORRECTIONS[got] ?? 'Face the camera straight on' }
    }
    const hint = POSE_HINTS[expected]
    if (hint) {
      const text = hint.charAt(0).toUpperCase() + hint.slice(1)
      return { ok: false, text: `${text} a bit more` }
    }
  }
  return { ok: false, text: reasonLabel(reason) }
}
