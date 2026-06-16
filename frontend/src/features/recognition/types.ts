export interface EngineAlert {
  severity: string
  message: string
  timestamp: string
}

export interface StreamStatus {
  camera_id: number
  status: string
  protocol?: string
  health?: { fps?: number; latency_ms?: number | null }
}

export interface StreamsResponse {
  total_streams: number
  active_streams: number
  streams: Record<string, StreamStatus>
}

export interface EngineConfigDict {
  search?: { auto_accept_threshold?: number }
  liveness?: { min_score?: number; enabled?: boolean }
  attendance?: { duplicate_window_seconds?: number }
  unknown_person?: { enabled?: boolean }
  detection?: { max_faces_per_frame?: number }
}

export interface EngineStatus {
  running: boolean
  streams: { total_streams: number; active_streams: number }
  tracking: { total_tracks: number; recognized_tracks: number; unknown_tracks: number }
  search_index: { total_embeddings: number; total_employees: number }
  attendance: { total_events_generated: number; duplicates_prevented: number }
  unknown_persons: { total_detections: number; alerts_generated: number }
  metrics: {
    uptime_seconds: number
    recognition_metrics: {
      total_detections: number
      total_recognized: number
      total_unknown: number
      total_liveness_passed: number
      total_liveness_failed: number
      total_quality_rejected: number
      recognition_rate: number
      unknown_rate: number
    }
    pipeline_performance: { stage_averages_ms: Record<string, number>; total_pipeline_avg_ms: number }
    camera_health: { cameras_reporting: number; avg_fps: number; avg_latency_ms: number }
    alerts: { total: number; recent: EngineAlert[] }
  }
  sla_compliance: Record<string, { target_ms: number; actual_ms: number; met: boolean }>
}

export interface AddStreamInput {
  camera_id: string
  stream_url: string
  protocol: string
}

export interface EngineConfigPatch {
  recognition_threshold: number
  liveness_min_score: number
  liveness_enabled: boolean
  duplicate_window_seconds: number
  unknown_person_enabled: boolean
  max_faces_per_frame: number
}

// ── Performance compliance & ground-truth feedback ───────────────────────────

export interface RequirementCompliance {
  metric: string
  requirement: string
  target: number
  measured: number | null
  met: boolean | null
}

export interface PerformanceCompliance {
  requirements: RequirementCompliance[]
  labeled_samples: number
  pipeline_stage_averages_ms: Record<string, number>
}

export type FeedbackOutcome = 'correct' | 'incorrect'

export interface EventFeedbackResult {
  event_id: number
  result: string
  outcome: string
  label: string
}

// ── Recognition requests (kiosk / test) ──────────────────────────────────────

export interface FaceBox {
  bbox: [number, number, number, number]
  det_score: number
}

export interface DetectResponse {
  faces: FaceBox[]
  face_count: number
  processing_ms: number
}

export interface IdentifyResult {
  matched: boolean
  reason?: string
  spoof_type?: string
  confidence?: number
  processing_ms?: number
  liveness_score?: number
  liveness_checks?: Record<string, unknown>
  employee?: { id: number; employee_code: string; first_name: string; last_name: string }
  attendance?: { action: string; employee_id?: number }
}

// ── Live detection overlay (server-stream camera panel) ──────────────────────

export type DetectionStatus = 'recognized' | 'unknown' | 'spoof' | 'detecting'

export interface LiveDetectionFace {
  track_id: number
  /** Bounding box normalized to [0,1] as [x1, y1, x2, y2]. */
  bbox: [number, number, number, number]
  status: DetectionStatus
  /** Tenant-gated display name (recognized faces only). */
  name?: string | null
  code?: string | null
  confidence?: number | null
  liveness_passed?: boolean | null
  reason?: string | null
}

export interface LiveDetectionFrame {
  type: 'detections'
  camera_id: number
  running: boolean
  frame_width: number
  frame_height: number
  faces: LiveDetectionFace[]
}

