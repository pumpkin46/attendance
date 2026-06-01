import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useWebcam } from '../hooks/useWebcam'

interface FaceBox {
  bbox: [number, number, number, number]
  det_score: number
}

interface DetectResponse {
  faces: FaceBox[]
  face_count: number
  processing_ms: number
  image_width?: number
  image_height?: number
}

interface IdentifyResult {
  matched: boolean
  reason?: string
  confidence?: number
  processing_ms?: number
  employee?: { id: number; employee_code: string; first_name: string; last_name: string }
  attendance?: { action: string }
}

type KioskStatus = 'idle' | 'scanning' | 'face_detected' | 'recognized' | 'unknown' | 'spoof' | 'duplicate'

const DETECT_MS = 400
const IDENTIFY_MS = 1500

interface LiveKioskPageProps {
  fullscreen?: boolean
}

export default function LiveKioskPage({ fullscreen = false }: LiveKioskPageProps) {
  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [running, setRunning] = useState(false)
  const [cameraId, setCameraId] = useState('')
  const [requireLiveness, setRequireLiveness] = useState(true)
  const [faces, setFaces] = useState<FaceBox[]>([])
  const [status, setStatus] = useState<KioskStatus>('idle')
  const [lastMatch, setLastMatch] = useState<IdentifyResult | null>(null)
  const [detectMs, setDetectMs] = useState(0)
  const [identifyMs, setIdentifyMs] = useState(0)
  const [fpsHint, setFpsHint] = useState('')

  const inFlightDetect = useRef(false)
  const inFlightIdentify = useRef(false)
  const faceCountRef = useRef(0)

  const drawOverlay = useCallback(
    (boxes: FaceBox[], matched: boolean | null) => {
      const video = videoRef.current
      const overlay = overlayRef.current
      if (!video || !overlay || video.videoWidth === 0) return

      overlay.width = video.clientWidth
      overlay.height = video.clientHeight
      const ctx = overlay.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, overlay.width, overlay.height)
      const sx = overlay.width / video.videoWidth
      const sy = overlay.height / video.videoHeight

      boxes.forEach((f) => {
        const [x1, y1, x2, y2] = f.bbox
        const x = x1 * sx
        const y = y1 * sy
        const w = (x2 - x1) * sx
        const h = (y2 - y1) * sy

        ctx.strokeStyle = matched === true ? '#22c55e' : matched === false ? '#ef4444' : '#3b82f6'
        ctx.lineWidth = 3
        ctx.strokeRect(x, y, w, h)

        const label =
          matched === true && lastMatch?.employee
            ? `${lastMatch.employee.first_name} ${lastMatch.employee.last_name}`
            : `Face ${Math.round(f.det_score * 100)}%`
        ctx.fillStyle = ctx.strokeStyle
        ctx.fillRect(x, y - 22, Math.max(w, 80), 22)
        ctx.fillStyle = '#fff'
        ctx.font = '12px sans-serif'
        ctx.fillText(label, x + 4, y - 7)
      })
    },
    [videoRef, lastMatch]
  )

  useEffect(() => {
    drawOverlay(faces, lastMatch?.matched ?? null)
  }, [faces, lastMatch, drawOverlay])

  useEffect(() => {
    if (!running || !active) return

    let detectTimer: ReturnType<typeof setInterval>
    let identifyTimer: ReturnType<typeof setInterval>
    let frames = 0
    let lastFps = performance.now()

    const runDetect = async () => {
      if (inFlightDetect.current) return
      const frame = captureFrame(480)
      if (!frame) return
      inFlightDetect.current = true
      try {
        const { data } = await api.post<DetectResponse>('/recognition/detect', { image: frame })
        setFaces(data.faces ?? [])
        setDetectMs(data.processing_ms ?? 0)
        faceCountRef.current = data.face_count ?? 0
        if (data.face_count > 0) {
          setStatus((s) => (s === 'recognized' || s === 'unknown' || s === 'spoof' ? s : 'face_detected'))
        } else {
          setStatus('scanning')
          setLastMatch(null)
        }
        frames++
        const now = performance.now()
        if (now - lastFps >= 2000) {
          setFpsHint(`~${Math.round((frames / (now - lastFps)) * 1000)} detect/s`)
          frames = 0
          lastFps = now
        }
      } catch {
        /* skip frame on error */
      } finally {
        inFlightDetect.current = false
      }
    }

    const runIdentify = async () => {
      if (inFlightIdentify.current || faceCountRef.current < 1) return
      const frame = captureFrame(640)
      if (!frame) return
      inFlightIdentify.current = true
      try {
        const { data } = await api.post<IdentifyResult>('/recognition/identify', {
          image: frame,
          camera_id: cameraId ? Number(cameraId) : undefined,
          require_liveness: requireLiveness,
        })
        setIdentifyMs(data.processing_ms ?? 0)
        setLastMatch(data)

        if (data.matched) {
          const action = data.attendance?.action
          setStatus(action === 'duplicate_ignored' ? 'duplicate' : 'recognized')
        } else if (
          data.reason === 'spoof_detected' ||
          data.reason === 'liveness_failed' ||
          data.reason === 'heuristic_failed'
        ) {
          setStatus('spoof')
        } else {
          setStatus('unknown')
        }
      } catch {
        /* skip */
      } finally {
        inFlightIdentify.current = false
      }
    }

    detectTimer = setInterval(runDetect, DETECT_MS)
    identifyTimer = setInterval(runIdentify, IDENTIFY_MS)
    runDetect()

    return () => {
      clearInterval(detectTimer)
      clearInterval(identifyTimer)
    }
  }, [running, active, captureFrame, cameraId, requireLiveness])

  const handleStart = async () => {
    await start()
    setRunning(true)
    setStatus('scanning')
  }

  const handleStop = () => {
    setRunning(false)
    stop()
    setStatus('idle')
    setFaces([])
    setLastMatch(null)
  }

  const statusLabel: Record<KioskStatus, string> = {
    idle: 'Camera off',
    scanning: 'Scanning for faces…',
    face_detected: 'Face detected — recognizing…',
    recognized: lastMatch?.employee
      ? `Welcome, ${lastMatch.employee.first_name} ${lastMatch.employee.last_name}`
      : 'Recognized',
    unknown: 'Unknown person',
    spoof: 'Spoof detected — use live face',
    duplicate: 'Already checked in (duplicate ignored)',
  }

  const statusClass: Record<KioskStatus, string> = {
    idle: 'kiosk-status-idle',
    scanning: 'kiosk-status-scan',
    face_detected: 'kiosk-status-scan',
    recognized: 'kiosk-status-ok',
    unknown: 'kiosk-status-warn',
    spoof: 'kiosk-status-danger',
    duplicate: 'kiosk-status-warn',
  }

  const content = (
    <div className={fullscreen ? 'kiosk-fullscreen' : 'kiosk-page'}>
      <div className="kiosk-header">
        <div>
          <h1>Live recognition</h1>
          <p className="muted">Real-time face detection and attendance check-in/out</p>
        </div>
        <div className="kiosk-controls">
          <input
            type="number"
            placeholder="Camera ID"
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
            className="kiosk-input"
          />
          <label className="checkbox-row kiosk-check">
            <input
              type="checkbox"
              checked={requireLiveness}
              onChange={(e) => setRequireLiveness(e.target.checked)}
            />
            Anti-spoof
          </label>
          {!active ? (
            <button type="button" className="btn btn-primary" onClick={handleStart}>
              Start camera
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={handleStop}>
              Stop
            </button>
          )}
        </div>
      </div>

      {camError && <p className="text-danger">{camError}</p>}

      <div className="kiosk-layout">
        <div className="kiosk-video-wrap">
          <video ref={videoRef} className="kiosk-video" playsInline muted autoPlay />
          <canvas ref={overlayRef} className="kiosk-overlay" />
          <canvas ref={canvasRef} hidden />
          <div className={`kiosk-status-bar ${statusClass[status]}`}>{statusLabel[status]}</div>
        </div>

        <div className="kiosk-panel card">
          <h2>Live stats</h2>
          <ul className="kiosk-stats">
            <li>
              <span>Status</span>
              <strong>{statusLabel[status]}</strong>
            </li>
            <li>
              <span>Faces in frame</span>
              <strong>{faces.length}</strong>
            </li>
            <li>
              <span>Detect latency</span>
              <strong>{detectMs ? `${detectMs} ms` : '—'}</strong>
            </li>
            <li>
              <span>Recognize latency</span>
              <strong>{identifyMs ? `${identifyMs} ms` : '—'}</strong>
            </li>
            <li>
              <span>Throughput</span>
              <strong>{fpsHint || '—'}</strong>
            </li>
          </ul>

          {lastMatch?.matched && lastMatch.employee && (
            <div className="kiosk-match">
              <p className="text-ok">
                <strong>
                  {lastMatch.employee.first_name} {lastMatch.employee.last_name}
                </strong>
              </p>
              <p className="muted">{lastMatch.employee.employee_code}</p>
              {lastMatch.confidence != null && (
                <p>Confidence: {(lastMatch.confidence * 100).toFixed(1)}%</p>
              )}
              {lastMatch.attendance?.action && (
                <p>
                  Attendance: <code>{lastMatch.attendance.action}</code>
                </p>
              )}
            </div>
          )}

          {!lastMatch?.matched && status === 'unknown' && (
            <p className="text-danger">Face not enrolled. Add under Face Enrollment.</p>
          )}
        </div>
      </div>
    </div>
  )

  return content
}
