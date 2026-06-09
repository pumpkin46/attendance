import { useEffect, useRef, useState } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { getToken } from '@/shared/lib/session'
import { Button } from '@/shared/ui/Button'
import { Combobox } from '@/shared/ui/Combobox'
import { detectFaces, identifyFace } from '@/features/recognition/api/recognitionApi'
import { useEngineStreams } from '@/features/recognition/api/queries'
import type { IdentifyResult } from '@/features/recognition/types'

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

export default function WebcamMonitor() {
  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const { data: streamsData } = useEngineStreams()
  const streams = Object.values(streamsData?.streams ?? {})

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
  // <img>, revoking the previous. Auto-reconnects if the socket drops.
  useEffect(() => {
    if (typeof source !== 'number') return
    const token = getToken()
    if (!token) return // protected page — token is always present here

    const apiBase = import.meta.env.VITE_API_URL ?? '/api/v1'
    const httpBase = /^https?:\/\//.test(apiBase) ? apiBase : window.location.origin + apiBase
    const wsUrl = `${httpBase.replace(/^http/, 'ws')}/engine/streams/${source}/ws`

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let lastUrl: string | null = null

    const connect = () => {
      if (cancelled) return
      ws = new WebSocket(wsUrl, ['bearer', token])
      ws.binaryType = 'blob'

      ws.onmessage = (ev) => {
        if (cancelled) return
        if (typeof ev.data === 'string') {
          // Text status frame (e.g. stream not started yet).
          setStreamErr('Stream not live yet — start the engine and this camera below.')
          return
        }
        const url = URL.createObjectURL(ev.data as Blob)
        setStreamImg(url)
        setStreamErr(null)
        if (lastUrl) URL.revokeObjectURL(lastUrl)
        lastUrl = url
      }

      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 1500)
      }
      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      if (lastUrl) URL.revokeObjectURL(lastUrl)
    }
  }, [source])

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
  const mediaClass = isFullscreen ? 'mx-auto h-full w-full object-contain' : 'block w-full'
  const showFullscreenBtn = isWebcam ? active : !!streamImg

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Webcam monitor</h2>
          <p className="text-xs text-slate-400">
            Local camera spot-check, or a live view of a registered stream.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Combobox
            value={isWebcam ? 'webcam' : String(source)}
            onChange={(value) => changeSource(value)}
          >
            <option value="webcam">Local webcam</option>
            {streams.map((s) => (
              <option key={s.camera_id} value={s.camera_id}>
                Camera #{s.camera_id} ({s.status})
              </option>
            ))}
          </Combobox>

          {isWebcam ? (
            <>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[status]}`}>
                {STATUS_LABEL[status]}
              </span>
              {running ? (
                <Button variant="danger" onClick={handleStop}>
                  Stop
                </Button>
              ) : (
                <Button onClick={handleStart}>Start camera</Button>
              )}
            </>
          ) : (
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${streamImg ? STATUS_STYLE.recognized : STATUS_STYLE.idle}`}>
              {streamImg ? '● Live' : 'Offline'}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div ref={videoBoxRef} className="relative overflow-hidden rounded-lg bg-black">
          {isWebcam ? (
            <>
              <video ref={videoRef} className={mediaClass} playsInline muted autoPlay />
              <canvas ref={canvasRef} hidden />
              {!active && (
                <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
                  Camera off
                </div>
              )}
            </>
          ) : streamImg ? (
            <img src={streamImg} alt={`Camera ${source}`} className={mediaClass} />
          ) : (
            <div className="grid min-h-[240px] place-items-center p-6 text-center text-sm text-slate-400">
              {streamErr ?? 'Connecting…'}
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

          {/* Live badge for server streams */}
          {!isWebcam && streamImg && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-3 py-1 text-sm font-medium text-white">
              ● Live · Camera #{source}
            </span>
          )}

          {/* Recognition overlay (local webcam only) — visible in fullscreen too. */}
          {isWebcam && active && (
            <>
              <span className={`absolute left-2 top-2 inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[status]}`}>
                {STATUS_LABEL[status]}
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

        <div className="flex flex-col justify-center gap-2 text-sm">
          {!isWebcam ? (
            <div className="text-slate-400">
              <p className="text-slate-200">Live view · Camera #{source}</p>
              <p className="mt-2 text-xs">
                Recognition and attendance for registered streams are handled by the engine
                pipeline (use “Start engine” and start this stream below). This panel is a
                live preview.
              </p>
              {streamErr && <p className="mt-2 text-xs text-amber-400">{streamErr}</p>}
            </div>
          ) : camError ? (
            <p className="text-red-400">{camError}</p>
          ) : last?.matched && last.employee ? (
            <>
              <p className="text-lg font-semibold text-slate-100">
                {last.employee.first_name} {last.employee.last_name}
              </p>
              {last.employee.employee_code && (
                <p className="text-slate-400">{last.employee.employee_code}</p>
              )}
              {last.confidence != null && (
                <p className="text-slate-400">Confidence: {(last.confidence * 100).toFixed(1)}%</p>
              )}
              {last.attendance?.action && (
                <p className="text-slate-400">
                  Attendance: <span className="font-medium text-slate-200">{last.attendance.action}</span>
                </p>
              )}
            </>
          ) : status === 'spoof' ? (
            <p className="text-red-400">Spoof / liveness check failed.</p>
          ) : status === 'unknown' ? (
            <div className="text-amber-400">
              <p>{UNKNOWN_HINTS[last?.reason ?? ''] ?? UNKNOWN_HINTS.default}</p>
              {last?.confidence != null && (
                <p className="mt-1 text-xs text-slate-500">
                  best match {(last.confidence * 100).toFixed(1)}%
                  {last.reason ? ` · ${last.reason}` : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-400">
              {running ? 'Look at the camera to identify.' : 'Start the camera to monitor recognition.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
