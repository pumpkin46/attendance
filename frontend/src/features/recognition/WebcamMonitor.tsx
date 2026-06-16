import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { useAuthedWebSocket } from '@/shared/hooks/useAuthedWebSocket'
import { Button } from '@/shared/ui/Button'
import { Combobox } from '@/shared/ui/Combobox'
import { detectFaces, identifyFace } from '@/features/recognition/api/recognitionApi'
import { useEngineStreams } from '@/features/recognition/api/queries'
import { useStreamDetections } from '@/features/recognition/useStreamDetections'
import { DetectionOverlay } from '@/features/recognition/DetectionOverlay'
import { faceLabel } from '@/features/recognition/detectionLabels'
import { useCameras } from '@/features/cameras/api/queries'
import { initialsOf } from '@/shared/lib/format'
import type { DetectionStatus, IdentifyResult, LiveDetectionFace } from '@/features/recognition/types'

/**
 * Recognition monitor embedded in the AI Engine page. Two sources:
 *  - Local webcam: accessed via the browser; runs detection/identification here
 *    (and records attendance, like the Live Kiosk).
 *  - A registered server stream (USB/RTSP): shows its live frames by polling the
 *    engine snapshot endpoint. Recognition + attendance for those run server-side
 *    in the engine pipeline, so this is a live view (no client-side matching).
 */

const DETECT_MS = 500
const IDENTIFY_MS = 1500

type MonitorStatus = 'idle' | 'scanning' | 'face' | 'recognized' | 'duplicate' | 'unknown' | 'spoof'

const SPOOF_REASONS = new Set([
  'spoof_detected',
  'liveness_failed',
  'heuristic_failed',
  'blink_not_detected',
  'head_movement_not_detected',
  'active_liveness_failed',
  'antispoof_model_unavailable',
])

const UNKNOWN_HINTS: Record<string, string> = {
  default: 'No matching enrolled face.',
  blurry: 'Too blurry — improve focus/lighting.',
  too_dark: 'Too dark — add more light.',
  low_quality: 'Quality too low — move closer.',
  occluded_face: 'Face partly hidden.',
  low_detection_score: 'Face not clear — move closer.',
  no_face: 'No face detected.',
}

const STATUS_STYLE: Record<MonitorStatus, string> = {
  idle: 'bg-slate-500/15 text-slate-400',
  scanning: 'bg-blue-500/15 text-blue-400',
  face: 'bg-indigo-500/15 text-indigo-300',
  recognized: 'bg-emerald-500/15 text-emerald-400',
  duplicate: 'bg-amber-500/15 text-amber-400',
  unknown: 'bg-yellow-500/15 text-yellow-400',
  spoof: 'bg-red-500/15 text-red-400',
}

const STATUS_LABEL: Record<MonitorStatus, string> = {
  idle: 'Camera off',
  scanning: 'Scanning…',
  face: 'Face detected',
  recognized: 'Recognized',
  duplicate: 'Already recorded',
  unknown: 'Unknown',
  spoof: 'Spoof blocked',
}

const STATUS_DOT: Record<MonitorStatus, string> = {
  idle: 'bg-slate-500',
  scanning: 'bg-blue-400 animate-pulse',
  face: 'bg-indigo-400 animate-pulse',
  recognized: 'bg-emerald-400',
  duplicate: 'bg-amber-400',
  unknown: 'bg-yellow-400',
  spoof: 'bg-red-400',
}

function StatusPill({ status }: { status: MonitorStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = pct >= 85 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">Confidence</span>
        <span className="font-mono font-medium text-slate-200">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const DETECTION_DOT: Record<DetectionStatus, string> = {
  recognized: 'bg-emerald-400',
  unknown: 'bg-amber-400',
  spoof: 'bg-red-400',
  detecting: 'bg-sky-400',
}

const DETECTION_TALLY_TONE: Record<DetectionStatus, string> = {
  recognized: 'text-emerald-400',
  unknown: 'text-amber-400',
  spoof: 'text-red-400',
  detecting: 'text-sky-400',
}

function DetectionTally({ label, value, tone }: { label: string; value: number; tone: DetectionStatus }) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-800/30 px-2.5 py-1.5">
      <div className={`text-lg font-semibold tabular-nums ${DETECTION_TALLY_TONE[tone]}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

const ScanIcon = (
  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="11" r="3" />
    <path d="M7 17c.5-1.8 2.5-3 5-3s4.5 1.2 5 3" />
  </svg>
)

export default function WebcamMonitor() {
  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const { data: streamsData } = useEngineStreams()
  const streams = Object.values(streamsData?.streams ?? {})

  // Map camera_id → name so the source picker shows names, not raw ids.
  const { data: camerasData } = useCameras()
  const cameraNames = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of camerasData?.data ?? []) map.set(c.id, c.name)
    return map
  }, [camerasData])

  const [source, setSource] = useState<'webcam' | number>('webcam')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<MonitorStatus>('idle')
  const [last, setLast] = useState<IdentifyResult | null>(null)
  const [streamImg, setStreamImg] = useState<string | null>(null)
  const [streamErr, setStreamErr] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const faceCountRef = useRef(0)
  const inFlightDetect = useRef(false)
  const inFlightIdentify = useRef(false)
  const sessionIdRef = useRef('')
  const videoBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `monitor-${Date.now()}`
  }, [])

  // Local-webcam recognition loops (only in webcam mode).
  useEffect(() => {
    if (source !== 'webcam' || !running || !active) return

    const runDetect = async () => {
      if (inFlightDetect.current) return
      const frame = captureFrame(480)
      if (!frame) return
      inFlightDetect.current = true
      try {
        const data = await detectFaces(frame)
        faceCountRef.current = data.face_count ?? 0
        if (!data.face_count) {
          setStatus('scanning')
          setLast(null)
        } else {
          setStatus((s) =>
            s === 'recognized' || s === 'unknown' || s === 'spoof' || s === 'duplicate' ? s : 'face'
          )
        }
      } catch {
        /* transient — loop retries next tick */
      } finally {
        inFlightDetect.current = false
      }
    }

    const runIdentify = async () => {
      if (inFlightIdentify.current || faceCountRef.current < 1) return
      const frame = captureFrame(1280, 0.92)
      if (!frame) return
      inFlightIdentify.current = true
      try {
        const data = await identifyFace({
          image: frame,
          require_liveness: true,
          source: 'engine-monitor',
          session_id: sessionIdRef.current,
        })
        setLast(data)
        if (data.matched) {
          setStatus(data.attendance?.action === 'duplicate_ignored' ? 'duplicate' : 'recognized')
        } else if (data.reason && SPOOF_REASONS.has(data.reason)) {
          setStatus('spoof')
        } else {
          setStatus('unknown')
        }
      } catch {
        /* transient — loop retries next tick */
      } finally {
        inFlightIdentify.current = false
      }
    }

    const detectTimer = setInterval(runDetect, DETECT_MS)
    const identifyTimer = setInterval(runIdentify, IDENTIFY_MS)
    runDetect()

    return () => {
      clearInterval(detectTimer)
      clearInterval(identifyTimer)
    }
  }, [source, running, active, captureFrame])

  // Server-stream live view over a WebSocket: the backend pushes JPEG frames on a
  // single persistent connection (replacing snapshot polling, which saturated the
  // browser's connection pool under load). Each binary frame → object URL on the
  // <img>, revoking the previous. Shared hook handles fresh-token auth + backoff.
  const lastUrlRef = useRef<string | null>(null)
  const onStreamFrame = useCallback((ev: MessageEvent) => {
    if (typeof ev.data === 'string') {
      // Text status frame (e.g. stream not started yet).
      setStreamErr('Stream not live yet — start the engine and this camera below.')
      return
    }
    const url = URL.createObjectURL(ev.data as Blob)
    setStreamImg(url)
    setStreamErr(null)
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current)
    lastUrlRef.current = url
  }, [])

  useAuthedWebSocket({
    path: typeof source === 'number' ? `/engine/streams/${source}/ws` : '',
    enabled: typeof source === 'number',
    binaryType: 'blob',
    onMessage: onStreamFrame,
    onTeardown: () => {
      if (lastUrlRef.current) {
        URL.revokeObjectURL(lastUrlRef.current)
        lastUrlRef.current = null
      }
    },
    deps: [source],
  })

  // Live per-face detection metadata for the selected server stream (boxes +
  // tenant-gated identities), streamed alongside the JPEG preview.
  const detection = useStreamDetections(typeof source === 'number' ? source : null)
  const detectFacesList: LiveDetectionFace[] = detection?.faces ?? []
  const detectionCounts = detectFacesList.reduce(
    (acc, f) => ({ ...acc, [f.status]: acc[f.status] + 1 }),
    { recognized: 0, unknown: 0, spoof: 0, detecting: 0 } as Record<DetectionStatus, number>
  )
  const engineIdle = detection != null && !detection.running

  // Keep the fullscreen label in sync with reality (covers Esc / OS exits).
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === videoBoxRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void videoBoxRef.current?.requestFullscreen?.()
    }
  }

  const changeSource = (value: string) => {
    // Clear any prior stream preview up front (event handler, not an effect).
    setStreamImg(null)
    setStreamErr(null)
    if (value === 'webcam') {
      setSource('webcam')
    } else {
      // Switching to a server stream — release the local camera.
      stop()
      setRunning(false)
      setStatus('idle')
      setLast(null)
      setSource(Number(value))
    }
  }

  const handleStart = async () => {
    await start()
    setRunning(true)
    setStatus('scanning')
  }

  const handleStop = () => {
    setRunning(false)
    stop()
    setStatus('idle')
    setLast(null)
    faceCountRef.current = 0
  }

  const isWebcam = source === 'webcam'
  const mediaClass = isFullscreen
    ? 'mx-auto h-full w-full object-contain'
    : 'h-full w-full object-cover'
  const showFullscreenBtn = isWebcam ? active : !!streamImg

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-500/15 text-blue-400">
            {ScanIcon}
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-100">Live detection monitor</h2>
            <p className="text-xs text-slate-400">
              Local camera spot-check, or a registered stream with live AI detection overlay.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Combobox
            value={isWebcam ? 'webcam' : String(source)}
            onChange={(value) => changeSource(value)}
            className="max-w-[180px]"
          >
            <option value="webcam">Local webcam</option>
            {streams.map((s) => (
              <option key={s.camera_id} value={s.camera_id}>
                {`${cameraNames.get(s.camera_id) ?? `Camera #${s.camera_id}`} (${s.status})`}
              </option>
            ))}
          </Combobox>

          {isWebcam ? (
            running ? (
              <Button variant="danger" onClick={handleStop}>
                Stop
              </Button>
            ) : (
              <Button onClick={handleStart}>Start camera</Button>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300">
              <span className={`h-1.5 w-1.5 rounded-full ${streamImg ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {engineIdle
                ? 'Engine stopped'
                : streamImg
                  ? `Live · ${detectFacesList.length} ${detectFacesList.length === 1 ? 'face' : 'faces'}`
                  : 'Connecting…'}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div
          ref={videoBoxRef}
          className={`relative overflow-hidden rounded-lg bg-black ${isFullscreen ? '' : 'aspect-video ring-1 ring-slate-700/60'}`}
        >
          {isWebcam ? (
            <>
              <video ref={videoRef} className={mediaClass} playsInline muted autoPlay />
              <canvas ref={canvasRef} hidden />
              {!active && (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-800/80 text-slate-400">
                      {ScanIcon}
                    </span>
                    <span className="text-sm">Camera off</span>
                  </div>
                </div>
              )}
            </>
          ) : streamImg ? (
            <div className="absolute inset-0">
              <img src={streamImg} alt={`Camera ${source}`} className="h-full w-full object-contain" />
              {detection && detectFacesList.length > 0 && (
                <DetectionOverlay
                  faces={detectFacesList}
                  frameWidth={detection.frame_width}
                  frameHeight={detection.frame_height}
                />
              )}
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
                {streamErr ?? 'Connecting…'}
              </span>
            </div>
          )}

          {showFullscreenBtn && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg bg-black/55 text-white ring-1 ring-white/20 hover:bg-black/75"
            >
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 9H5V5M9 9V5M9 9L4 4M15 9h4V5M15 9V5M15 9l5-5M9 15H5v4M9 15v4M9 15l-5 5M15 15h4v4M15 15v4M15 15l5 5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>
          )}

          {/* Live badge + detection summary for server streams */}
          {!isWebcam && streamImg && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-sm font-medium text-white">
              <span className="inline-flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                Live
              </span>
              <span className="text-white/70">Camera #{source}</span>
              {detectFacesList.length > 0 && (
                <span className="text-white/70">
                  · {detectFacesList.length} {detectFacesList.length === 1 ? 'face' : 'faces'}
                </span>
              )}
            </span>
          )}

          {/* Recognition overlay (local webcam only) — visible in fullscreen too. */}
          {isWebcam && active && (
            <>
              <span className="absolute left-2 top-2">
                <StatusPill status={status} />
              </span>

              {(last || status === 'spoof') && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-4 pb-3 pt-10 text-white">
                  {last?.matched && last.employee ? (
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xl font-semibold leading-tight">
                          {last.employee.first_name} {last.employee.last_name}
                        </p>
                        <p className="text-sm text-white/70">
                          {last.employee.employee_code}
                          {last.confidence != null && ` · ${(last.confidence * 100).toFixed(1)}%`}
                        </p>
                      </div>
                      {last.attendance?.action && (
                        <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-medium capitalize">
                          {last.attendance.action.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  ) : status === 'spoof' ? (
                    <p className="text-lg font-medium text-red-300">Spoof / liveness check failed</p>
                  ) : status === 'unknown' ? (
                    <div className="text-yellow-200">
                      <p className="font-medium">{UNKNOWN_HINTS[last?.reason ?? ''] ?? UNKNOWN_HINTS.default}</p>
                      {last?.confidence != null && (
                        <p className="text-sm text-white/60">
                          best match {(last.confidence * 100).toFixed(1)}%
                          {last.reason ? ` · ${last.reason}` : ''}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col rounded-lg border border-slate-700/60 bg-slate-800/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {isWebcam ? 'Recognition result' : 'Live detection'}
            </h3>
            {isWebcam && <StatusPill status={status} />}
          </div>

          <div className="flex flex-1 flex-col justify-center">
            {!isWebcam ? (
              <div className="flex h-full flex-col gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${streamImg && !engineIdle ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  <span className="font-medium text-slate-200">
                    {engineIdle ? 'Engine stopped' : streamImg ? 'Live AI detection' : 'Connecting'} · Camera #{source}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <DetectionTally label="Recognized" value={detectionCounts.recognized} tone="recognized" />
                  <DetectionTally label="Unknown" value={detectionCounts.unknown} tone="unknown" />
                  <DetectionTally label="Spoof" value={detectionCounts.spoof} tone="spoof" />
                  <DetectionTally label="Detecting" value={detectionCounts.detecting} tone="detecting" />
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {detectFacesList.length > 0 ? (
                    <ul className="space-y-1.5">
                      {detectFacesList.map((f) => (
                        <li
                          key={f.track_id}
                          className="flex items-center gap-2 rounded-lg bg-slate-800/40 px-2.5 py-1.5"
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${DETECTION_DOT[f.status]}`} />
                          <span className="truncate text-slate-200">{faceLabel(f)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs leading-relaxed text-slate-500">
                      {engineIdle
                        ? 'The engine is stopped — start it (and this stream) to see live detections.'
                        : 'No faces in view. Boxes and identities appear here as the engine detects faces on this camera.'}
                    </p>
                  )}
                </div>

                {streamErr && <p className="text-xs text-amber-400">{streamErr}</p>}
              </div>
            ) : camError ? (
              <div className="flex flex-col items-center gap-2 text-center text-red-400">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                  </svg>
                </span>
                <p className="text-sm">{camError}</p>
              </div>
            ) : last?.matched && last.employee ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-base font-semibold text-emerald-300">
                    {initialsOf(last.employee.first_name, last.employee.last_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-slate-100">
                      {last.employee.first_name} {last.employee.last_name}
                    </p>
                    {last.employee.employee_code && (
                      <p className="truncate text-sm text-slate-400">{last.employee.employee_code}</p>
                    )}
                  </div>
                </div>
                {last.confidence != null && <ConfidenceBar value={last.confidence} />}
                {last.attendance?.action && (
                  <div className="flex items-center justify-between rounded-lg bg-slate-800/60 px-3 py-2 text-sm">
                    <span className="text-slate-400">Attendance</span>
                    <span className="font-medium capitalize text-emerald-300">
                      {last.attendance.action.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
              </div>
            ) : status === 'spoof' ? (
              <div className="flex flex-col items-center gap-2 text-center text-red-400">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4Z" />
                    <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
                  </svg>
                </span>
                <p className="text-sm font-medium">Spoof / liveness check failed</p>
                <p className="text-xs text-slate-500">Use a live face, not a photo or screen.</p>
              </div>
            ) : status === 'unknown' ? (
              <div className="flex flex-col items-center gap-2 text-center text-amber-400">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/15">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3M12 17h.01" />
                  </svg>
                </span>
                <p className="text-sm font-medium">
                  {UNKNOWN_HINTS[last?.reason ?? ''] ?? UNKNOWN_HINTS.default}
                </p>
                {last?.confidence != null && (
                  <p className="text-xs text-slate-500">
                    best match {(last.confidence * 100).toFixed(1)}%
                    {last.reason ? ` · ${last.reason}` : ''}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center text-slate-400">
                <span className={`grid h-12 w-12 place-items-center rounded-full ${running ? 'bg-blue-500/15 text-blue-400' : 'bg-slate-800/80 text-slate-500'}`}>
                  {ScanIcon}
                </span>
                <p className="text-sm">
                  {running ? 'Look at the camera to identify.' : 'Start the camera to monitor recognition.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
