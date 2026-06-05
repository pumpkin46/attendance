import type { Camera } from '@/shared/types'

export interface Location {
  id: number
  name: string
}

export interface CameraConfig {
  camera_types?: Record<string, string>
  zones?: Record<string, string>
  statuses?: string[]
}

export interface CaptureResult {
  face_count: number
  detect_ms: number
  capture_ms: number
  latency_ms?: number
  bandwidth_kbps?: number
  health?: Camera['health']
  identify?: {
    matched: boolean
    reason?: string
    employee?: { first_name: string; last_name: string }
  }
}

export interface CameraPayload {
  location_id: number
  name: string
  camera_type: string
  zone: string | null
  floor: string | null
  stream_url: string | null
  target_fps: number | null
  resolution_width: number | null
  resolution_height: number | null
  status: Camera['status']
  direction: string
  deployment_mode: Camera['deployment_mode']
}

export const CAMERA_TYPE_FALLBACK: Record<string, string> = {
  rtsp: 'RTSP IP Camera',
  ip: 'IP Camera (HTTP)',
  usb: 'USB Camera',
}

export const ZONE_FALLBACK: Record<string, string> = {
  entry: 'Entry',
  exit: 'Exit',
  lobby: 'Lobby',
  office: 'Office',
}

export const STATUS_LABELS: Record<Camera['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  maintenance: 'Maintenance',
}
