import { useState, type FormEvent } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ImageDropzone } from '@/shared/ui/ImageDropzone'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Combobox } from '@/shared/ui/Combobox'
import { cn } from '@/shared/lib/cn'
import { useEnrollableEmployees, useSimpleEnroll } from '@/features/enrollment/api/queries'
import { reasonLabel } from '@/features/enrollment/types'

const MAX_SHOTS = 5

export default function SimpleEnrollmentPage() {
  const { data: employeesPage } = useEnrollableEmployees()
  const employees = employeesPage?.data ?? []

  const [employeeId, setEmployeeId] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [useCamera, setUseCamera] = useState(true)

  const simpleEnroll = useSimpleEnroll()
  const submitting = simpleEnroll.isPending

  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()

  const addShot = (dataUrl: string) =>
    setShots((prev) => (prev.length >= MAX_SHOTS ? prev : [...prev, dataUrl]))

  const captureFromCamera = () => {
    if (shots.length >= MAX_SHOTS) return
    // Native resolution + high JPEG fidelity (same as the guided flow) so the
    // backend's face detector gets a clean frame.
    const frame = captureFrame(1920, 0.95)
    if (frame) addShot(frame)
  }

  const onFile = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
    addShot(dataUrl)
  }

  const removeShot = (i: number) => setShots((prev) => prev.filter((_, idx) => idx !== i))

  const canSubmit = employeeId && shots.length > 0 && !submitting

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setMessage('')
    try {
      const data = await simpleEnroll.mutateAsync({ employeeId, images: shots })
      setMessage(
        `Face registered — ${data.embeddings_stored ?? shots.length} image(s) stored` +
          (data.rejected_count ? `, ${data.rejected_count} skipped (no clear face)` : '')
      )
      setShots([])
      stop()
    } catch (err: unknown) {
      const body = (err as { response?: { data?: { error?: string; rejected?: { reason: string }[] } } })
        ?.response?.data
      if (body?.rejected?.length) {
        const reasons = [...new Set(body.rejected.map((r) => reasonLabel(r.reason)))]
        setMessage(body.error ?? `No image accepted: ${reasons.join(', ')}`)
      } else {
        setMessage(body?.error ?? 'Registration failed')
      }
    }
  }

  const success = message.startsWith('Face registered')

  return (
    <div>
      <PageHeader
        title="Quick Face Register"
        description="Register a face the simple way: pick an employee, take one or more photos, and save. No guided pose steps — just a clear, single face."
      />

      <Card>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Label>
            Employee
            <Combobox value={employeeId} onChange={(value) => setEmployeeId(value)} required>
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.first_name} {e.last_name}
                  {e.face_enrolled ? ' (re-enroll)' : ''}
                </option>
              ))}
            </Combobox>
          </Label>

          <div className="flex gap-2">
            <Button type="button" variant={useCamera ? 'primary' : 'ghost'} onClick={() => setUseCamera(true)}>
              Webcam
            </Button>
            <Button
              type="button"
              variant={!useCamera ? 'primary' : 'ghost'}
              onClick={() => {
                setUseCamera(false)
                stop()
              }}
            >
              Upload file
            </Button>
          </div>

          {useCamera ? (
            <div className="flex flex-col gap-3">
              {!active ? (
                <Button type="button" onClick={start}>
                  Start camera
                </Button>
              ) : (
                <>
                  <div className="relative max-w-xl overflow-hidden rounded-xl bg-black">
                    <video ref={videoRef} className="block w-full" playsInline muted autoPlay />
                    <canvas ref={canvasRef} hidden />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" onClick={captureFromCamera} disabled={shots.length >= MAX_SHOTS}>
                      Take photo ({shots.length}/{MAX_SHOTS})
                    </Button>
                    <Button type="button" variant="ghost" onClick={stop}>
                      Stop camera
                    </Button>
                  </div>
                </>
              )}
              {camError && <p className="text-sm text-red-400">{camError}</p>}
            </div>
          ) : (
            <ImageDropzone
              label="Photo"
              onFile={onFile}
              disabled={shots.length >= MAX_SHOTS}
              hint={
                shots.length >= MAX_SHOTS
                  ? `Maximum ${MAX_SHOTS} photos reached`
                  : 'JPEG or PNG · one clear, single face per photo'
              }
            />
          )}

          {shots.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {shots.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt={`Shot ${i + 1}`} className="h-24 w-24 rounded-lg object-cover" />
                  <button
                    type="button"
                    onClick={() => removeShot(i)}
                    className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-xs text-slate-300 ring-1 ring-slate-600 hover:text-white"
                    aria-label={`Remove shot ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-sm text-slate-300">
            {shots.length === 0
              ? 'Capture at least one photo to register.'
              : `${shots.length} photo(s) ready. More angles improve recognition.`}
          </p>

          <Button type="submit" disabled={!canSubmit}>
            {submitting ? 'Registering…' : 'Register face'}
          </Button>

          {message && (
            <p className={cn('text-sm', success ? 'text-green-400' : 'text-red-400')}>{message}</p>
          )}
        </form>
      </Card>
    </div>
  )
}
