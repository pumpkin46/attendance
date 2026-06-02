import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useWebcam } from '../hooks/useWebcam'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { cn } from '../lib/cn'

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

const statusBarStyles: Record<KioskStatus, string> = {
  idle: 'bg-slate-700 text-slate-300',
  scanning: 'bg-blue-600/90 text-white',
  face_detected: 'bg-blue-600/90 text-white',
  recognized: 'bg-green-600/90 text-white',
  unknown: 'bg-amber-600/90 text-white',
  spoof: 'bg-red-600/90 text-white',
  duplicate: 'bg-amber-600/90 text-white',
}

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

  return (
    <div className={cn(fullscreen && 'fixed inset-0 z-50 overflow-auto bg-slate-950 p-6')}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Live recognition</h1>
          <p className="mt-1 text-sm text-slate-400">
            Real-time face detection and attendance check-in/out
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="number"
            placeholder="Camera ID"
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
            className="w-32"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
              checked={requireLiveness}
              onChange={(e) => setRequireLiveness(e.target.checked)}
            />
            Anti-spoof
          </label>
          {!active ? (
            <Button type="button" onClick={handleStart}>
              Start camera
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={handleStop}>
              Stop
            </Button>
          )}
        </div>
      </div>

      {camError && <p className="mb-4 text-sm text-red-400">{camError}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="block w-full" playsInline muted autoPlay />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <canvas ref={canvasRef} hidden />
          <div
            className={cn(
              'absolute bottom-0 left-0 right-0 px-4 py-3 text-center text-sm font-medium',
              statusBarStyles[status]
            )}
          >
            {statusLabel[status]}
          </div>
        </div>

        <Card>
          <h2 className="mb-4 text-lg font-medium">Live stats</h2>
          <ul className="divide-y divide-slate-800 text-sm">
            <li className="flex justify-between py-3">
              <span className="text-slate-400">Status</span>
              <strong className="text-right">{statusLabel[status]}</strong>
            </li>
            <li className="flex justify-between py-3">
              <span className="text-slate-400">Faces in frame</span>
              <strong>{faces.length}</strong>
            </li>
            <li className="flex justify-between py-3">
              <span className="text-slate-400">Detect latency</span>
              <strong>{detectMs ? `${detectMs} ms` : '—'}</strong>
            </li>
            <li className="flex justify-between py-3">
              <span className="text-slate-400">Recognize latency</span>
              <strong>{identifyMs ? `${identifyMs} ms` : '—'}</strong>
            </li>
            <li className="flex justify-between py-3">
              <span className="text-slate-400">Throughput</span>
              <strong>{fpsHint || '—'}</strong>
            </li>
          </ul>

          {lastMatch?.matched && lastMatch.employee && (
            <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
              <p className="font-medium text-green-400">
                {lastMatch.employee.first_name} {lastMatch.employee.last_name}
              </p>
              <p className="text-sm text-slate-400">{lastMatch.employee.employee_code}</p>
              {lastMatch.confidence != null && (
                <p className="mt-1 text-sm">
                  Confidence: {(lastMatch.confidence * 100).toFixed(1)}%
                </p>
              )}
              {lastMatch.attendance?.action && (
                <p className="mt-1 text-sm">
                  Attendance:{' '}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                    {lastMatch.attendance.action}
                  </code>
                </p>
              )}
            </div>
          )}

          {!lastMatch?.matched && status === 'unknown' && (
            <p className="mt-4 text-sm text-red-400">
              Face not enrolled. Add under Face Enrollment.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
