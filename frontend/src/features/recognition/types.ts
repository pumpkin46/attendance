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

