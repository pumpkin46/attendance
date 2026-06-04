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
