import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { cn } from '@/shared/lib/cn'
import { detectFaces, identifyFace } from '@/features/recognition/api/recognitionApi'
import type { FaceBox, IdentifyResult } from '@/features/recognition/types'

type KioskStatus = 'idle' | 'scanning' | 'face_detected' | 'recognized' | 'unknown' | 'spoof' | 'duplicate'

const DETECT_MS = 400
const IDENTIFY_MS = 1500
const FRAME_BUFFER_MS = 300
const MAX_LIVENESS_FRAMES = 20

const statusBarStyles: Record<KioskStatus, string> = {
  idle: 'bg-slate-700 text-slate-300',
  scanning: 'bg-blue-600/90 text-white',
  face_detected: 'bg-blue-600/90 text-white',
  recognized: 'bg-green-600/90 text-white',
  unknown: 'bg-amber-600/90 text-white',
  spoof: 'bg-red-600/90 text-white',
  duplicate: 'bg-amber-600/90 text-white',
}

// Actionable hints for the kiosk "unknown" state. Without a specific reason it
// means no enrolled face matched; quality reasons mean the frame was rejected
// before matching even ran.
const UNKNOWN_HINTS: Record<string, string> = {
  default: 'No matching enrolled face. Register them under Quick Face Register.',
  blurry: 'Image too blurry — hold still and improve focus/lighting.',
  too_dark: 'Too dark — add more light on the face.',
  low_quality: 'Image quality too low — move closer with even lighting.',
  occluded_face: 'Face partly hidden — remove obstructions and face the camera.',
  low_detection_score: 'Face not clear enough — move closer to the camera.',
  no_face: 'No face detected — center your face in the frame.',
}

const SPOOF_REASONS = new Set([
  'spoof_detected',
  'liveness_failed',
  'heuristic_failed',
  'blink_not_detected',
  'head_movement_not_detected',
  'active_liveness_failed',
  'liveness_frames_required',
  'antispoof_model_unavailable',
])

interface LiveKioskPageProps {
  fullscreen?: boolean
}

export default function LiveKioskPage({ fullscreen = false }: LiveKioskPageProps) {
  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const frameBufferRef = useRef<string[]>([])
  const [running, setRunning] = useState(false)
  const [cameraId, setCameraId] = useState('')
  const [requireLiveness, setRequireLiveness] = useState(true)
  const [activeLiveness, setActiveLiveness] = useState(true)
  const [bufferCount, setBufferCount] = useState(0)
  const [faces, setFaces] = useState<FaceBox[]>([])
  const [status, setStatus] = useState<KioskStatus>('idle')
  const [lastMatch, setLastMatch] = useState<IdentifyResult | null>(null)
  const [detectMs, setDetectMs] = useState(0)
  const [identifyMs, setIdentifyMs] = useState(0)
  const [fpsHint, setFpsHint] = useState('')

  const inFlightDetect = useRef(false)
  const inFlightIdentify = useRef(false)
  const faceCountRef = useRef(0)
  const sessionIdRef = useRef('')

  // Generate a stable per-mount session id in an effect (time/random sources are
  // impure and not allowed during render).
  useEffect(() => {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `kiosk-${Date.now()}`
  }, [])

  const pushFrame = useCallback(
    (frame: string) => {
      frameBufferRef.current = [...frameBufferRef.current, frame].slice(-MAX_LIVENESS_FRAMES)
      setBufferCount(frameBufferRef.current.length)
    },
    []
  )

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

    let frames = 0
    let lastFps = performance.now()

    const runDetect = async () => {
      if (inFlightDetect.current) return
      const frame = captureFrame(480)
      if (!frame) return
      inFlightDetect.current = true
      try {
        const data = await detectFaces(frame)
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
        /* skip */
      } finally {
        inFlightDetect.current = false
      }
    }

    const sampleForLiveness = () => {
      if (!activeLiveness || faceCountRef.current < 1) return
      const frame = captureFrame(480)
      if (frame) pushFrame(frame)
    }

    const runIdentify = async () => {
      if (inFlightIdentify.current || faceCountRef.current < 1) return
      // Capture at native resolution + high JPEG fidelity. A downscaled, heavily
      // compressed frame loses the high-frequency detail the pipeline's blur gate
      // measures, so genuine faces get rejected as "blurry" before matching.
      const frame = captureFrame(1280, 0.92)
      if (!frame) return
      inFlightIdentify.current = true
      try {
        const payload: Record<string, unknown> = {
          image: frame,
          camera_id: cameraId ? Number(cameraId) : undefined,
          require_liveness: requireLiveness,
          source: 'webcam',
          session_id: sessionIdRef.current,
        }
        if (requireLiveness && activeLiveness && frameBufferRef.current.length >= 5) {
          payload.liveness_frames = frameBufferRef.current
        }

        const data = await identifyFace(payload)
        setIdentifyMs(data.processing_ms ?? 0)
        setLastMatch(data)

        if (data.matched) {
          const action = data.attendance?.action
          setStatus(action === 'duplicate_ignored' ? 'duplicate' : 'recognized')
        } else if (data.reason && SPOOF_REASONS.has(data.reason)) {
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

    const detectTimer = setInterval(runDetect, DETECT_MS)
    const identifyTimer = setInterval(runIdentify, IDENTIFY_MS)
    const bufferTimer = setInterval(sampleForLiveness, FRAME_BUFFER_MS)
    runDetect()

    return () => {
      clearInterval(detectTimer)
      clearInterval(identifyTimer)
      clearInterval(bufferTimer)
    }
  }, [running, active, captureFrame, cameraId, requireLiveness, activeLiveness, pushFrame])

  const handleStart = async () => {
    frameBufferRef.current = []
    setBufferCount(0)
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
    frameBufferRef.current = []
    setBufferCount(0)
  }

  const spoofLabel = (match: IdentifyResult | null) => {
    const type = match?.spoof_type
    if (type === 'printed_photo') return 'Printed photo detected'
    if (type === 'mobile_screen') return 'Mobile screen detected'
    if (type === 'video_replay') return 'Video replay detected'
    if (type === 'deepfake') return 'Deepfake attempt detected'
    if (match?.reason === 'blink_not_detected') return 'Blink not detected — look at camera naturally'
    return 'Spoof detected — use live face'
  }

  const statusLabel: Record<KioskStatus, string> = {
    idle: 'Camera off',
    scanning: activeLiveness ? 'Scanning — blink naturally…' : 'Scanning for faces…',
    face_detected: 'Face detected — verifying liveness…',
    recognized: lastMatch?.employee
      ? `Welcome, ${lastMatch.employee.first_name} ${lastMatch.employee.last_name}`
      : 'Recognized',
    unknown: 'Unknown person',
    spoof: spoofLabel(lastMatch),
    duplicate: 'Already checked in (duplicate ignored)',
  }

  return (
    <div className={cn(fullscreen && 'fixed inset-0 z-50 overflow-auto bg-slate-950 p-6')}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Live recognition</h1>
          <p className="mt-1 text-sm text-slate-400">
            FR-017 anti-spoof + FR-018 blink/head-movement active liveness
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
            Anti-spoof (AI model)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
              checked={activeLiveness}
              onChange={(e) => setActiveLiveness(e.target.checked)}
            />
            Blink / movement
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
              <strong className="max-w-[160px] text-right">{statusLabel[status]}</strong>
            </li>
            <li className="flex justify-between py-3">
              <span className="text-slate-400">Liveness frames</span>
              <strong>{bufferCount}</strong>
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

          {status === 'spoof' && (
            <p className="mt-4 text-sm text-red-400">{spoofLabel(lastMatch)}</p>
          )}

          {!lastMatch?.matched && status === 'unknown' && (
            <div className="mt-4 text-sm text-amber-400">
              <p>{UNKNOWN_HINTS[lastMatch?.reason ?? ''] ?? UNKNOWN_HINTS.default}</p>
              {(lastMatch?.reason || lastMatch?.confidence != null) && (
                <p className="mt-1 text-xs text-slate-500">
                  {lastMatch?.reason ? `reason: ${lastMatch.reason}` : 'no match'}
                  {lastMatch?.confidence != null &&
                    ` · best match ${(lastMatch.confidence * 100).toFixed(1)}%`}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
