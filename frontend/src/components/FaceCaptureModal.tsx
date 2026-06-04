import { useEffect, useRef, useState } from 'react'
import { useWebcam } from '../hooks/useWebcam'
import { Button } from './ui/Button'

/**
 * Modal that captures a single face image from the webcam (or an uploaded file)
 * and returns it as a data URL. Replaces ad-hoc `prompt()` base64 paste flows.
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
  const { videoRef, canvasRef, active, error, start, stop, captureFrame } = useWebcam()
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    start()
    return () => stop()
  }, [start, stop])

  const grab = () => {
    const frame = captureFrame(640)
    if (frame) setPreview(frame)
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const confirm = () => {
    if (preview) onCapture(preview)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="relative overflow-hidden rounded-xl bg-black">
          {preview ? (
            <img src={preview} alt="Captured face preview" className="block max-h-80 w-full object-contain" />
          ) : (
            <video ref={videoRef} className="block w-full" playsInline muted autoPlay />
          )}
          <canvas ref={canvasRef} hidden />
        </div>

        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {preview ? (
            <>
              <Button onClick={confirm} disabled={submitting}>
                {submitting ? 'Enrolling…' : 'Use this photo'}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={submitting}>
                Retake
              </Button>
            </>
          ) : (
            <>
              {active ? (
                <Button onClick={grab}>Capture</Button>
              ) : (
                <Button onClick={start}>Start camera</Button>
              )}
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                Upload file
              </Button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
      </div>
    </div>
  )
}
