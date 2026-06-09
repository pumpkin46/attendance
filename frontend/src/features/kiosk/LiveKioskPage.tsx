import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { CameraSelect } from '@/features/cameras/components/CameraSelect'
import { cn } from '@/shared/lib/cn'
import { initialsOf } from '@/shared/lib/format'
import { detectFaces, identifyFace } from '@/features/recognition/api/recognitionApi'
import type { FaceBox, IdentifyResult } from '@/features/recognition/types'

type KioskStatus = 'idle' | 'scanning' | 'face_detected' | 'recognized' | 'unknown' | 'spoof' | 'duplicate'

const DETECT_MS = 400
const IDENTIFY_MS = 1500
const FRAME_BUFFER_MS = 300
const MAX_LIVENESS_FRAMES = 12

const statusBarStyles: Record<KioskStatus, string> = {
  idle: 'bg-slate-700 text-slate-300',
  scanning: 'bg-blue-600/90 text-white',
  face_detected: 'bg-blue-600/90 text-white',
  recognized: 'bg-green-600/90 text-white',
  unknown: 'bg-amber-600/90 text-white',
  spoof: 'bg-red-600/90 text-white',
  duplicate: 'bg-amber-600/90 text-white',
}

const statusPillStyles: Record<KioskStatus, string> = {
  idle: 'bg-slate-500/15 text-slate-300',
  scanning: 'bg-blue-500/15 text-blue-300',
  face_detected: 'bg-indigo-500/15 text-indigo-300',
  recognized: 'bg-emerald-500/15 text-emerald-300',
  unknown: 'bg-amber-500/15 text-amber-300',
  spoof: 'bg-red-500/15 text-red-300',
  duplicate: 'bg-amber-500/15 text-amber-300',
}

const STATUS_SHORT: Record<KioskStatus, string> = {
  idle: 'Idle',
  scanning: 'Scanning…',
  face_detected: 'Face detected',
  recognized: 'Recognized',
  unknown: 'Unknown',
  spoof: 'Spoof blocked',
  duplicate: 'Duplicate',
}

const statusDotStyles: Record<KioskStatus, string> = {
  idle: 'bg-slate-500',
  scanning: 'bg-blue-400 animate-pulse',
  face_detected: 'bg-indigo-400 animate-pulse',
  recognized: 'bg-emerald-400',
  unknown: 'bg-amber-400',
  spoof: 'bg-red-400',
  duplicate: 'bg-amber-400',
}


function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = pct >= 85 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">Confidence</span>
        <span className="font-mono font-medium text-slate-200">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const FaceScanIcon = (
  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="11" r="3" />
    <path d="M7 17c.5-1.8 2.5-3 5-3s4.5 1.2 5 3" />
  </svg>
)

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
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/15 text-blue-400">
            {FaceScanIcon}
          </span>
          <div>
            <h1 className="text-2xl font-semibold">Live recognition</h1>
            <p className="mt-0.5 text-sm text-slate-400">
              FR-017 anti-spoof + FR-018 blink/head-movement active liveness
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CameraSelect
            value={cameraId}
            onChange={setCameraId}
            allowEmpty
            emptyLabel="No camera"
            className="w-48"
          />
          <div className="flex items-center gap-4 rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2">
            <Checkbox
              checked={requireLiveness}
              onChange={(e) => setRequireLiveness(e.target.checked)}
              label="Anti-spoof (AI model)"
            />
            <Checkbox
              checked={activeLiveness}
              onChange={(e) => setActiveLiveness(e.target.checked)}
              label="Blink / movement"
            />
          </div>
          {!active ? (
            <Button type="button" onClick={handleStart}>
              Start camera
            </Button>
          ) : (
            <Button type="button" variant="danger" onClick={handleStop}>
              Stop
            </Button>
          )}
        </div>
      </div>

      {camError && <p className="mb-4 text-sm text-red-400">{camError}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-slate-700/60">
          <video ref={videoRef} className="h-full w-full" playsInline muted autoPlay />
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <canvas ref={canvasRef} hidden />

          {!active && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-3 text-slate-500">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-800/80 text-slate-400">
                  {FaceScanIcon}
                </span>
                <span className="text-sm">Camera off — press “Start camera”.</span>
              </div>
            </div>
          )}

          {active && (
            <span
              className={cn(
                'absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                statusPillStyles[status]
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', statusDotStyles[status])} />
              {STATUS_SHORT[status]}
            </span>
          )}

          <div
            className={cn(
              'absolute bottom-0 left-0 right-0 px-4 py-3 text-center text-sm font-medium',
              statusBarStyles[status]
            )}
          >
            {statusLabel[status]}
          </div>
        </div>

        <Card padding={false} className="overflow-hidden">
          <div className="border-b border-slate-800 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">Live stats</h2>
            <div className="mt-2 flex items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', statusDotStyles[status])} />
              <span className="text-sm font-semibold text-slate-100">{statusLabel[status]}</span>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-px bg-slate-800">
            {[
              ['Liveness frames', bufferCount],
              ['Faces in frame', faces.length],
              ['Detect latency', detectMs ? `${detectMs} ms` : '—'],
              ['Recognize latency', identifyMs ? `${identifyMs} ms` : '—'],
              ['Throughput', fpsHint || '—'],
              ['Anti-spoof', requireLiveness ? 'On' : 'Off'],
            ].map(([label, value]) => (
              <div key={label as string} className="bg-slate-900 p-3">
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="p-4">
            {lastMatch?.matched && lastMatch.employee ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-sm font-semibold text-emerald-300">
                    {initialsOf(lastMatch.employee.first_name, lastMatch.employee.last_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-emerald-300">
                      {lastMatch.employee.first_name} {lastMatch.employee.last_name}
                    </p>
                    <p className="truncate text-sm text-slate-400">
                      {lastMatch.employee.employee_code}
                    </p>
                  </div>
                </div>
                {lastMatch.confidence != null && <ConfidenceBar value={lastMatch.confidence} />}
                {lastMatch.attendance?.action && (
                  <div className="mt-3 flex items-center justify-between rounded-md bg-slate-900/60 px-3 py-2 text-sm">
                    <span className="text-slate-400">Attendance</span>
                    <span className="font-medium capitalize text-emerald-300">
                      {lastMatch.attendance.action.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
              </div>
            ) : status === 'spoof' ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
                <p className="font-medium">{spoofLabel(lastMatch)}</p>
                <p className="mt-1 text-xs text-slate-500">Use a live face — not a photo or screen.</p>
              </div>
            ) : status === 'unknown' ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
                <p>{UNKNOWN_HINTS[lastMatch?.reason ?? ''] ?? UNKNOWN_HINTS.default}</p>
                {(lastMatch?.reason || lastMatch?.confidence != null) && (
                  <p className="mt-1 text-xs text-slate-500">
                    {lastMatch?.reason ? `reason: ${lastMatch.reason}` : 'no match'}
                    {lastMatch?.confidence != null &&
                      ` · best match ${(lastMatch.confidence * 100).toFixed(1)}%`}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-center text-sm text-slate-500">
                {running ? 'Look at the camera to identify.' : 'Start the camera to begin recognition.'}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
