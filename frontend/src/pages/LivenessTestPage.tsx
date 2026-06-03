import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useWebcam } from '../hooks/useWebcam'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'

interface LivenessResult {
  passed: boolean
  score: number
  blink_detected: boolean
  head_movement_detected: boolean
  frame_count: number
  reason?: string
  checks?: Record<string, unknown>
  processing_ms?: number
}

interface HealthInfo {
  liveness_enabled?: boolean
  active_liveness_enabled?: boolean
  antispoof_model_loaded?: boolean
  liveness_methods?: {
    ai_model?: string
    blink_detection?: boolean
    head_movement?: boolean
    spoof_types?: string[]
  }
}

const FRAME_MS = 250
const MAX_FRAMES = 20
const MIN_FRAMES = 5

export default function LivenessTestPage() {
  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const [recording, setRecording] = useState(false)
  const [frames, setFrames] = useState<string[]>([])
  const [result, setResult] = useState<LivenessResult | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api
      .get<HealthInfo>('/health')
      .then((r) => setHealth(r.data))
      .catch(() => setHealth(null))
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const startRecording = async () => {
    await start()
    setFrames([])
    setResult(null)
    setRecording(true)

    timerRef.current = setInterval(() => {
      const frame = captureFrame(480)
      if (frame) {
        setFrames((prev) => [...prev, frame].slice(-MAX_FRAMES))
      }
    }, FRAME_MS)
  }

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecording(false)
    stop()
  }

  const runVerify = async () => {
    if (frames.length < MIN_FRAMES) return
    setLoading(true)
    setResult(null)
    try {
      const { data } = await api.post<LivenessResult>('/recognition/liveness/verify', {
        frames,
      })
      setResult(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Liveness Detection Test"
        description="FR-017 anti-spoof (print, screen, video, deepfake) and FR-018 blink/head-movement verification"
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-400">AI model</p>
          <p className="mt-1 font-medium">{health?.liveness_methods?.ai_model ?? '—'}</p>
          <Badge tone={health?.antispoof_model_loaded ? 'ok' : 'warn'} className="mt-2">
            {health?.antispoof_model_loaded ? 'Loaded' : 'Not loaded'}
          </Badge>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">Blink detection</p>
          <Badge tone={health?.liveness_methods?.blink_detection ? 'ok' : 'neutral'} className="mt-2">
            {health?.liveness_methods?.blink_detection ? 'Enabled' : 'Disabled'}
          </Badge>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">Head movement</p>
          <Badge tone={health?.liveness_methods?.head_movement ? 'ok' : 'neutral'} className="mt-2">
            {health?.liveness_methods?.head_movement ? 'Enabled' : 'Disabled'}
          </Badge>
        </Card>
        <Card>
          <p className="text-xs text-slate-400">Spoof types detected</p>
          <p className="mt-1 text-xs text-slate-300">
            {(health?.liveness_methods?.spoof_types ?? []).join(', ') || '—'}
          </p>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-400">
            Record {MIN_FRAMES}+ frames while blinking and moving your head slightly. Then run
            verification.
          </p>

          {!active ? (
            <Button onClick={startRecording}>Start webcam & record</Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={stopRecording}>
                Stop recording
              </Button>
              <Button onClick={runVerify} disabled={loading || frames.length < MIN_FRAMES}>
                {loading ? 'Verifying…' : `Verify liveness (${frames.length} frames)`}
              </Button>
            </div>
          )}

          {camError && <p className="text-sm text-red-400">{camError}</p>}

          {active && (
            <div className="relative max-w-xl overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} className="block w-full" playsInline muted autoPlay />
              <canvas ref={canvasRef} hidden />
              {recording && (
                <span className="absolute left-3 top-3 rounded bg-red-600 px-2 py-1 text-xs font-medium">
                  REC {frames.length}
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {result && (
        <Card>
          <h2 className="mb-4 text-lg font-medium">Verification result</h2>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone={result.passed ? 'ok' : 'danger'}>
              {result.passed ? 'Liveness passed' : 'Failed'}
            </Badge>
            <Badge tone={result.blink_detected ? 'ok' : 'warn'}>
              Blink: {result.blink_detected ? 'yes' : 'no'}
            </Badge>
            <Badge tone={result.head_movement_detected ? 'ok' : 'neutral'}>
              Head movement: {result.head_movement_detected ? 'yes' : 'no'}
            </Badge>
          </div>
          {!result.passed && result.reason && (
            <p className="mb-4 text-sm text-red-400">Reason: {result.reason}</p>
          )}
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300">
            {JSON.stringify(result, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  )
}
