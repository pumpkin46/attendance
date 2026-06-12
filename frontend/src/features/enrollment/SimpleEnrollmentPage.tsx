import { useState, type FormEvent } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { CameraPanel } from '@/shared/ui/CameraPanel'
import { ImageDropzone } from '@/shared/ui/ImageDropzone'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Badge } from '@/shared/ui/Badge'
import { Combobox } from '@/shared/ui/Combobox'
import {
  ProgressBar,
  SectionCard,
  SegmentedToggle,
  StatusAlert,
  UploadIcon,
  WebcamIcon,
} from '@/features/enrollment/components/EnrollmentUI'
import { useEnrollableEmployees, useSimpleEnroll } from '@/features/enrollment/api/queries'
import { reasonLabel } from '@/features/enrollment/types'

const MAX_SHOTS = 5

export default function SimpleEnrollmentPage() {
  const { data: employeesPage } = useEnrollableEmployees()
  const employees = employeesPage?.data ?? []

  const [employeeId, setEmployeeId] = useState('')
  const [shots, setShots] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [source, setSource] = useState<'camera' | 'upload'>('camera')

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
  const selectedEmployee = employees.find((e) => String(e.id) === employeeId)

  return (
    <div>
      <PageHeader
        title="Quick Face Register"
        description="Enroll an employee's face from a few clear photos, without the guided capture flow."
        actions={<Badge tone="neutral">Simple mode</Badge>}
      />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        {/* Capture column */}
        <div className="space-y-6 lg:col-span-2">
          <SectionCard step={1} title="Select employee" subtitle="Choose who you're registering a face for.">
            <Combobox value={employeeId} onChange={(value) => setEmployeeId(value)} required placeholder="Select employee">
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.first_name} {e.last_name}
                  {e.face_enrolled ? ' (re-enroll)' : ''}
                </option>
              ))}
            </Combobox>
            {selectedEmployee?.face_enrolled && (
              <p className="mt-2 text-xs text-amber-400">
                This employee already has a face enrolled — saving will add more reference images.
              </p>
            )}
          </SectionCard>

          <SectionCard
            step={2}
            title="Capture photos"
            subtitle={`Add up to ${MAX_SHOTS} photos. More angles improve recognition accuracy.`}
            actions={
              <SegmentedToggle
                value={source}
                onChange={(next) => {
                  setSource(next)
                  if (next === 'upload') stop()
                }}
                options={[
                  { key: 'camera', label: 'Webcam', icon: <WebcamIcon /> },
                  { key: 'upload', label: 'Upload', icon: <UploadIcon /> },
                ]}
              />
            }
          >
            {source === 'camera' ? (
              <CameraPanel
                videoRef={videoRef}
                canvasRef={canvasRef}
                active={active}
                error={camError}
                onStart={start}
                hint={
                  shots.length >= MAX_SHOTS
                    ? `Maximum ${MAX_SHOTS} photos reached.`
                    : 'Center your face in the guide, then capture.'
                }
                controls={
                  <>
                    <Button type="button" onClick={captureFromCamera} disabled={shots.length >= MAX_SHOTS}>
                      Take photo ({shots.length}/{MAX_SHOTS})
                    </Button>
                    <Button type="button" variant="ghost" onClick={stop}>
                      Stop camera
                    </Button>
                  </>
                }
              />
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
          </SectionCard>
        </div>

        {/* Summary column */}
        <div className="lg:col-span-1">
          <SectionCard
            title="Captured photos"
            subtitle={`${shots.length} of ${MAX_SHOTS} added`}
            className="lg:sticky lg:top-6"
          >
            <ProgressBar value={shots.length} max={MAX_SHOTS} />

            {shots.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3">
                {shots.map((src, i) => (
                  <div key={i} className="group relative aspect-square">
                    <img
                      src={src}
                      alt={`Shot ${i + 1}`}
                      className="h-full w-full rounded-lg object-cover ring-1 ring-slate-700"
                    />
                    <button
                      type="button"
                      onClick={() => removeShot(i)}
                      className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-slate-800 text-xs text-slate-300 opacity-0 ring-1 ring-slate-600 transition-opacity hover:text-white group-hover:opacity-100"
                      aria-label={`Remove shot ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 grid place-items-center rounded-lg border border-dashed border-slate-700 px-4 py-8 text-center">
                <p className="text-sm text-slate-400">No photos yet</p>
                <p className="mt-1 text-xs text-slate-500">Capture at least one photo to register.</p>
              </div>
            )}

            <Button type="submit" fullWidth className="mt-5" isLoading={submitting} disabled={!canSubmit}>
              {submitting ? 'Registering…' : 'Register face'}
            </Button>

            {message && (
              <div className="mt-4">
                <StatusAlert tone={success ? 'ok' : 'error'}>{message}</StatusAlert>
              </div>
            )}
          </SectionCard>
        </div>
      </form>
    </div>
  )
}
