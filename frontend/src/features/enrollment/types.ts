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
  message: string
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
