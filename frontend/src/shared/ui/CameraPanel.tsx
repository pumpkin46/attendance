import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface CameraPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  active: boolean
  error?: string | null
  onStart: () => void
  /** Capture / stop controls shown in the footer bar while the camera is live. */
  controls?: React.ReactNode
  /** Helper text shown under the stage in both idle and live states. */
  hint?: React.ReactNode
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h2.2a1.5 1.5 0 0 0 1.2-.6l.9-1.2A1.5 1.5 0 0 1 10 3.6h4a1.5 1.5 0 0 1 1.2.6l.9 1.2a1.5 1.5 0 0 0 1.2.6h2.2A1.5 1.5 0 0 1 21 7.5v10A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  )
}

/**
 * Framed, professional camera stage with a fixed aspect ratio, a face-framing
 * guide overlay, a LIVE indicator, and a polished idle state. The mirrored
 * preview matches what users expect from a selfie-style webcam.
 */
export function CameraPanel({
  videoRef,
  canvasRef,
  active,
  error,
  onStart,
  controls,
  hint,
}: CameraPanelProps) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-950 ring-1 ring-slate-700">
        {/* Live preview — always mounted so the stream can attach; visible only when active. */}
        <video
          ref={videoRef}
          className={cn(
            'h-full w-full -scale-x-100 object-cover transition-opacity duration-300',
            active ? 'opacity-100' : 'opacity-0'
          )}
          playsInline
          muted
          autoPlay
        />
        <canvas ref={canvasRef} hidden />

        {active ? (
          <>
            {/* Face-framing guide */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-[78%] w-[58%] rounded-[50%] border-2 border-white/40 shadow-[0_0_0_9999px_rgba(2,6,23,0.35)]" />
            </div>
            {/* Corner brackets for a clean viewfinder feel */}
            <div className="pointer-events-none absolute inset-3">
              <span className="absolute left-0 top-0 h-5 w-5 rounded-tl-md border-l-2 border-t-2 border-white/50" />
              <span className="absolute right-0 top-0 h-5 w-5 rounded-tr-md border-r-2 border-t-2 border-white/50" />
              <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-md border-b-2 border-l-2 border-white/50" />
              <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br-md border-b-2 border-r-2 border-white/50" />
            </div>
            {/* LIVE badge */}
            <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              Live
            </div>
          </>
        ) : (
          /* Idle state */
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-800/80 ring-1 ring-slate-700">
                <CameraIcon className="h-7 w-7 text-slate-400" />
              </div>
              <p className="text-sm text-slate-400">Camera is off</p>
              <Button type="button" onClick={onStart} leftIcon={<CameraIcon className="h-4 w-4" />}>
                Start camera
              </Button>
            </div>
          </div>
        )}
      </div>

      {active && controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}

      {hint && <p className="text-sm text-slate-400">{hint}</p>}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
