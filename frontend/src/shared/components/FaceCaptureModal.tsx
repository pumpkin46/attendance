import { useEffect, useRef, useState, useId } from 'react'
import { createPortal } from 'react-dom'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/cn'

const CameraIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5l-2-3Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
)

const UploadIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

const RetakeIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v4h4" />
  </svg>
)

const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {children}
    </span>
  )
}

/**
 * Modal that captures a single face image from the webcam (or an uploaded /
 * dropped file) and returns it as a data URL. The live view is mirrored like a
 * selfie camera with an oval framing guide; the captured photo is shown (and
 * stored) unmirrored.
 */
export function FaceCaptureModal({
  title = 'Capture face',
  description,
  submitting = false,
  onCapture,
  onClose,
}: {
  title?: string
  description?: string
  submitting?: boolean
  onCapture: (dataUrl: string) => void
  onClose: () => void
}) {
  const titleId = useId()
  const { videoRef, canvasRef, active, error, start, stop, captureFrame } = useWebcam()
  const [preview, setPreview] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    void start()
    return () => stop()
  }, [start, stop])

  // Dialog semantics: trap initial focus, close on Escape, restore focus after.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => restoreFocusRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  const grab = () => {
    const frame = captureFrame(640)
    if (!frame) return
    setFlash(true)
    window.setTimeout(() => setFlash(false), 180)
    setPreview(frame)
  }

  const onFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const starting = !active && !error && !preview

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] animate-[backdrop-in_150ms_ease-out]"
      onClick={() => !submitting && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 outline-none animate-[dialog-in_150ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-800 px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-blue-400">
            {CameraIcon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-100">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          {/* Viewport */}
          <div
            className={cn(
              'relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-950 ring-1 ring-inset ring-slate-800',
              dragOver && 'ring-2 ring-blue-500'
            )}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) onFile(file)
            }}
          >
            {/* Selfie view: mirrored for natural framing; the capture itself stays
                unmirrored. Kept mounted (hidden) while previewing so the stream
                survives "Retake" — reattaching only happens when `active` flips. */}
            <video
              ref={videoRef}
              className={cn(
                'h-full w-full -scale-x-100 object-cover',
                (preview || error) && 'hidden'
              )}
              playsInline
              muted
              autoPlay
            />
            {preview ? (
              <>
                <img
                  src={preview}
                  alt="Captured face preview"
                  className="absolute inset-0 h-full w-full object-contain"
                />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-300 backdrop-blur-sm">
                  {CheckIcon}
                  Photo ready
                </span>
              </>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-slate-500">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5l-2-3Z" />
                    <path d="m4 4 16 16" />
                  </svg>
                </span>
                <p className="text-sm text-slate-400">{error}</p>
                <Button size="sm" variant="ghost" onClick={start}>Retry camera</Button>
              </div>
            ) : (
              <>
                {starting && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950">
                    <span className="h-7 w-7 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
                    <p className="text-sm text-slate-500">Starting camera…</p>
                  </div>
                )}
                {active && (
                  <>
                    {/* Face framing guide */}
                    <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="h-[78%] aspect-[3/4] rounded-[50%] border-2 border-dashed border-white/35 shadow-[0_0_0_999px_rgba(2,6,23,0.35)]" />
                    </div>
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-slate-950/70 px-2.5 py-1 text-xs font-medium text-slate-200 backdrop-blur-sm">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute h-full w-full animate-ping rounded-full bg-red-500/60" />
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                      </span>
                      Live
                    </span>
                    <span className="absolute inset-x-0 bottom-3 text-center text-xs text-white/70">
                      Center the face inside the oval
                    </span>
                  </>
                )}
              </>
            )}
            {/* Shutter flash */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 bg-white transition-opacity duration-150',
                flash ? 'opacity-70' : 'opacity-0'
              )}
            />
            <canvas ref={canvasRef} hidden />
          </div>

          {/* Capture tips */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <Hint>Good lighting</Hint>
            <Hint>Look at the camera</Hint>
            <Hint>No hat or mask</Hint>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-4">
          <Button
            variant="ghost"
            leftIcon={UploadIcon}
            disabled={submitting}
            onClick={() => fileRef.current?.click()}
          >
            Upload photo
          </Button>
          <div className="flex gap-2">
            {preview ? (
              <>
                <Button
                  variant="ghost"
                  leftIcon={RetakeIcon}
                  disabled={submitting}
                  onClick={() => setPreview(null)}
                >
                  Retake
                </Button>
                <Button leftIcon={CheckIcon} isLoading={submitting} onClick={() => onCapture(preview)}>
                  {submitting ? 'Enrolling…' : 'Use this photo'}
                </Button>
              </>
            ) : (
              <Button leftIcon={CameraIcon} disabled={!active} onClick={grab}>
                Capture photo
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) onFile(e.target.files[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
