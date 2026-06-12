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
}

export const CAMERA_TYPE_FALLBACK: Record<string, string> = {
  rtsp: 'RTSP IP Camera',
  ip: 'IP Camera (HTTP)',
  usb: 'USB Camera',
  nvr: 'NVR Channel',
  cctv: 'CCTV Stream',
  mobile: 'Mobile Camera',
}

export const ZONE_FALLBACK: Record<string, string> = {
  entry: 'Entry',
  exit: 'Exit',
  lobby: 'Lobby',
  parking: 'Parking',
  office: 'Office',
  warehouse: 'Warehouse',
  other: 'Other',
}

export const STATUS_LABELS: Record<Camera['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
  maintenance: 'Maintenance',
}

export const DIRECTION_LABELS: Record<string, string> = {
  in: 'Entry',
  out: 'Exit',
  both: 'Entry & Exit',
}

/**
 * How the stream source field behaves for each camera type. The engine accepts
 * either a URL (rtsp/rtmp/http) or a bare numeric device index for USB cameras
 * (see backend stream_sync.protocol_for_url), so the form adapts its label,
 * placeholder, and validation to the selected type.
 */
export interface StreamFieldSpec {
  label: string
  placeholder: string
  hint: string
  /** Accepted URL schemes; empty means the value is a numeric device index. */
  schemes: string[]
  numeric?: boolean
}

export const STREAM_FIELD_BY_TYPE: Record<string, StreamFieldSpec> = {
  rtsp: {
    label: 'RTSP stream URL',
    placeholder: 'rtsp://user:pass@192.168.1.100:554/stream1',
    hint: 'Standard RTSP URL from the camera — the path is in the camera manual or web UI.',
    schemes: ['rtsp://'],
  },
  ip: {
    label: 'HTTP stream URL',
    placeholder: 'http://192.168.1.100:8080/video',
    hint: 'MJPEG or HTTP video endpoint exposed by the camera.',
    schemes: ['http://', 'https://'],
  },
  usb: {
    label: 'Device index',
    placeholder: '0',
    hint: 'Index of the USB camera on the host machine — 0 is the first device.',
    schemes: [],
    numeric: true,
  },
  nvr: {
    label: 'NVR channel URL',
    placeholder: 'rtsp://user:pass@nvr.local:554/Streaming/Channels/101',
    hint: 'Per-channel RTSP URL from the NVR (Hikvision shown; Dahua uses /cam/realmonitor?channel=1&subtype=0).',
    schemes: ['rtsp://'],
  },
  cctv: {
    label: 'CCTV stream URL',
    placeholder: 'rtsp://encoder.local:554/ch01',
    hint: 'RTSP or RTMP URL from the DVR / encoder that digitizes the CCTV feed.',
    schemes: ['rtsp://', 'rtmp://'],
  },
  mobile: {
    label: 'Mobile stream URL',
    placeholder: 'http://192.168.1.50:8080/video',
    hint: 'URL from an IP-camera app on the phone (e.g. IP Webcam, DroidCam) on the same network.',
    schemes: ['http://', 'https://', 'rtsp://'],
  },
}

export const DEFAULT_STREAM_FIELD: StreamFieldSpec = STREAM_FIELD_BY_TYPE.rtsp

/** Validate a stream source against the selected camera type. Empty is allowed. */
export function streamUrlProblem(cameraType: string, url: string): string | null {
  const spec = STREAM_FIELD_BY_TYPE[cameraType] ?? DEFAULT_STREAM_FIELD
  const value = url.trim()
  if (!value) return null
  if (spec.numeric) {
    return /^\d+$/.test(value) ? null : 'Enter the numeric device index (e.g. 0).'
  }
  return spec.schemes.some((s) => value.toLowerCase().startsWith(s))
    ? null
    : `Expected a URL starting with ${spec.schemes.join(' or ')}`
}
