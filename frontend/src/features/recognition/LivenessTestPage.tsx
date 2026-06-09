import { useEffect, useRef, useState } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { cn } from '@/shared/lib/cn'
import { useLivenessHealth, useVerifyLiveness } from '@/features/enrollment/api/queries'
import type { LivenessResult } from '@/features/enrollment/types'

const FRAME_MS = 250
const MAX_FRAMES = 20
const MIN_FRAMES = 5

const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const CrossIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const ScanIcon = (
  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="11" r="3" />
    <path d="M7 17c.5-1.8 2.5-3 5-3s4.5 1.2 5 3" />
  </svg>
)

function StatusTile({
  label,
  ok,
  text,
  detail,
}: {
  label: string
  ok: boolean | null
  text: string
  detail?: string
}) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            ok === null ? 'bg-slate-500' : ok ? 'bg-emerald-400' : 'bg-amber-400'
          )}
        />
        <span className="truncate text-sm font-semibold text-slate-100">{text}</span>
      </span>
      {detail && <span className="truncate text-xs text-slate-500">{detail}</span>}
    </Card>
  )
}

function CheckRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2.5">
      <span className="text-sm text-slate-300">{label}</span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium',
          value ? 'text-emerald-400' : 'text-slate-500'
        )}
      >
        <span
          className={cn(
            'grid h-5 w-5 place-items-center rounded-full',
            value ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-500'
          )}
        >
          {value ? CheckIcon : CrossIcon}
        </span>
        {value ? 'Detected' : 'Not detected'}
      </span>
    </div>
  )
}

export default function LivenessTestPage() {
  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()
  const { data: health } = useLivenessHealth()
  const verify = useVerifyLiveness()
  const loading = verify.isPending
  const [recording, setRecording] = useState(false)
  const [frames, setFrames] = useState<string[]>([])
  const [result, setResult] = useState<LivenessResult | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    setResult(null)
    try {
      const data = await verify.mutateAsync(frames)
      setResult(data)
    } catch {
      // error surfaced via toast
    }
  }

  const ready = frames.length >= MIN_FRAMES
  const captureProgress = Math.min(100, Math.round((frames.length / MIN_FRAMES) * 100))
  const scorePct = result?.score != null ? Math.round(result.score * 100) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liveness Detection Test"
        description="FR-017 anti-spoof (print, screen, video, deepfake) and FR-018 blink/head-movement verification"
      />

      {/* Capability status */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          label="AI anti-spoof model"
          ok={health?.antispoof_model_loaded ?? null}
          text={health?.antispoof_model_loaded ? 'Loaded' : 'Not loaded'}
          detail={health?.liveness_methods?.ai_model ?? undefined}
        />
        <StatusTile
          label="Blink detection"
          ok={health?.liveness_methods?.blink_detection ?? null}
          text={health?.liveness_methods?.blink_detection ? 'Enabled' : 'Disabled'}
        />
        <StatusTile
          label="Head movement"
          ok={health?.liveness_methods?.head_movement ?? null}
          text={health?.liveness_methods?.head_movement ? 'Enabled' : 'Disabled'}
        />
        <StatusTile
          label="Spoof types covered"
          ok={(health?.liveness_methods?.spoof_types?.length ?? 0) > 0 ? true : null}
          text={`${health?.liveness_methods?.spoof_types?.length ?? 0} types`}
          detail={(health?.liveness_methods?.spoof_types ?? []).join(', ') || undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Capture */}
        <Card padding={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-500/15 text-blue-400">
                {ScanIcon}
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-100">Capture</h2>
                <p className="text-xs text-slate-400">
                  Blink and move your head slightly while recording.
                </p>
              </div>
            </div>
            {active &&
              (recording ? (
                <Button variant="ghost" onClick={stopRecording}>
                  Stop
                </Button>
              ) : (
                <Badge tone="neutral">Paused</Badge>
              ))}
          </div>

          <div className="p-4">
            <div className="relative aspect-video overflow-hidden rounded-lg bg-black ring-1 ring-slate-700/60">
              {active ? (
                <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="flex flex-col items-center gap-3 text-slate-500">
                    <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-800/80 text-slate-400">
                      {ScanIcon}
                    </span>
                    <span className="text-sm">Camera off — start to record frames.</span>
                  </div>
                </div>
              )}
              <canvas ref={canvasRef} hidden />

              {recording && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold text-white">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  REC
                </span>
              )}
              {active && (
                <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-white/15">
                  {frames.length} / {MAX_FRAMES} frames
                </span>
              )}
            </div>

            {/* Frame progress */}
            {active && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {ready ? 'Enough frames captured' : `Capturing… (${MIN_FRAMES} min)`}
                  </span>
                  <span className="font-mono text-slate-300">{frames.length}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      ready ? 'bg-emerald-500' : 'bg-blue-500'
                    )}
                    style={{ width: `${captureProgress}%` }}
                  />
                </div>
              </div>
            )}

            {camError && <p className="mt-3 text-sm text-red-400">{camError}</p>}

            {/* Controls */}
            <div className="mt-4 flex flex-wrap gap-2">
              {!active ? (
                <Button onClick={startRecording}>Start webcam &amp; record</Button>
              ) : (
                <Button onClick={runVerify} isLoading={loading} disabled={!ready}>
                  {ready ? 'Verify liveness' : `Need ${MIN_FRAMES - frames.length} more frames`}
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Result / guidance */}
        <div className="space-y-4">
          {result ? (
            <>
              <Card
                className={cn(
                  'border',
                  result.passed
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-red-500/30 bg-red-500/10'
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'grid h-12 w-12 place-items-center rounded-full',
                      result.passed
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/20 text-red-300'
                    )}
                  >
                    <span className="scale-150">{result.passed ? CheckIcon : CrossIcon}</span>
                  </span>
                  <div>
                    <p
                      className={cn(
                        'text-lg font-semibold',
                        result.passed ? 'text-emerald-300' : 'text-red-300'
                      )}
                    >
                      {result.passed ? 'Liveness passed' : 'Liveness failed'}
                    </p>
                    <p className="text-sm text-slate-400">
                      {result.frame_count} frames analysed
                      {result.processing_ms != null && ` · ${result.processing_ms} ms`}
                    </p>
                  </div>
                </div>

                {scorePct != null && (
                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-slate-400">Liveness score</span>
                      <span className="font-mono font-medium text-slate-200">{scorePct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          result.passed ? 'bg-emerald-500' : 'bg-red-500'
                        )}
                        style={{ width: `${scorePct}%` }}
                      />
                    </div>
                  </div>
                )}

                {!result.passed && result.reason && (
                  <p className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {result.reason.replace(/_/g, ' ')}
                  </p>
                )}
              </Card>

              <Card className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Active liveness checks
                </h3>
                <CheckRow label="Blink" value={result.blink_detected} />
                <CheckRow label="Head movement" value={result.head_movement_detected} />
              </Card>

              <details className="group rounded-xl border border-slate-700 bg-slate-900">
                <summary className="cursor-pointer list-none p-4 text-sm text-slate-400 hover:text-slate-200">
                  <span className="select-none">Raw response ▾</span>
                </summary>
                <pre className="overflow-x-auto border-t border-slate-800 p-4 text-xs text-slate-400">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <Card className="space-y-4">
              <h3 className="text-base font-semibold text-slate-100">How it works</h3>
              <ol className="space-y-3 text-sm text-slate-300">
                {[
                  'Start the webcam to begin recording frames.',
                  `Blink and turn your head slightly until at least ${MIN_FRAMES} frames are captured.`,
                  'Run verification — the AI model checks for spoofing and active liveness.',
                ].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-semibold text-blue-400">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="rounded-lg bg-slate-800/50 px-3 py-2 text-xs text-slate-400">
                Tip: use a live face in good lighting. Photos, phone screens, and video replays are
                designed to fail.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
