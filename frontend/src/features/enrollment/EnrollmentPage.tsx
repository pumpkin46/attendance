import { useCallback, useState, type FormEvent } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { CameraPanel } from '@/shared/ui/CameraPanel'
import { ImageDropzone } from '@/shared/ui/ImageDropzone'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Badge } from '@/shared/ui/Badge'
import { Combobox } from '@/shared/ui/Combobox'
import { cn } from '@/shared/lib/cn'
import {
  ProgressBar,
  SectionCard,
  SegmentedToggle,
  StatusAlert,
  UploadIcon,
  WebcamIcon,
} from '@/features/enrollment/components/EnrollmentUI'
import { useEnrollFace, useEnrollableEmployees, useEnrollmentConfig, useValidateImage } from '@/features/enrollment/api/queries'
import { reasonLabel, type PoseCapture } from '@/features/enrollment/types'

export default function EnrollmentPage() {
  const { data: employeesPage } = useEnrollableEmployees()
  const { data: config } = useEnrollmentConfig()
  const employees = employeesPage?.data ?? []

  const [employeeId, setEmployeeId] = useState('')
  const [poses, setPoses] = useState<Record<string, PoseCapture>>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [message, setMessage] = useState('')
  const [source, setSource] = useState<'camera' | 'upload'>('camera')

  const validateImage = useValidateImage()
  const enrollFace = useEnrollFace()
  const submitting = enrollFace.isPending

  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()

  const requiredPoses = config?.required_poses ?? []
  const currentPose = requiredPoses[stepIndex] ?? requiredPoses[0]
  const poseLabel = (pose?: string) =>
    (pose && config?.pose_labels?.[pose]) ?? pose?.replace(/_/g, ' ') ?? ''
  const currentLabel = poseLabel(currentPose)

  const validateAndSetPose = useCallback(
    async (poseType: string, dataUrl: string) => {
      try {
        const data = await validateImage.mutateAsync({ image: dataUrl, expected_pose: poseType })

        setPoses((prev) => ({
          ...prev,
          [poseType]: {
            pose_type: poseType,
            dataUrl,
            accepted: data.accepted,
            reason: data.reason,
            quality_score: data.quality_score,
            face_metadata: data.face_metadata,
          },
        }))

        if (data.accepted && stepIndex < requiredPoses.length - 1) {
          setStepIndex((i) => i + 1)
        }

        return data.accepted
      } catch {
        setPoses((prev) => ({
          ...prev,
          [poseType]: {
            pose_type: poseType,
            dataUrl,
            accepted: false,
            reason: 'validation_error',
          },
        }))
        return false
      }
    },
    [validateImage, requiredPoses.length, stepIndex]
  )

  const captureFromCamera = async () => {
    if (!currentPose) return
    // Capture at native resolution and high JPEG fidelity. Enrollment requires
    // at least 640×480 (a downscaled 640-wide 16:9 frame is only 640×360 and is
    // rejected as low_resolution), and aggressive JPEG compression strips the
    // high-frequency detail the blur check measures, causing false "blurry".
    const frame = captureFrame(1920, 0.95)
    if (frame) await validateAndSetPose(currentPose, frame)
  }

  const onFile = async (file: File) => {
    if (!currentPose) return
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
    await validateAndSetPose(currentPose, dataUrl)
  }

  const clearPose = (poseType: string) => {
    setPoses((prev) => {
      const next = { ...prev }
      delete next[poseType]
      return next
    })
    const idx = requiredPoses.indexOf(poseType)
    if (idx >= 0) setStepIndex(idx)
  }

  const completedCount = requiredPoses.filter((p) => poses[p]?.accepted).length
  const allComplete = requiredPoses.length > 0 && completedCount === requiredPoses.length
  const canSubmit = allComplete && employeeId && !submitting
  const successMessage = message.includes('completed') || message.includes('stored')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const posePayload: Record<string, string> = {}
    for (const p of requiredPoses) {
      if (poses[p]?.accepted) posePayload[p] = poses[p].dataUrl
    }

    setMessage('')
    try {
      const data = await enrollFace.mutateAsync({ employeeId, poses: posePayload })

      setMessage(
        `${data.message} — ${data.embeddings_stored} embeddings, ` +
          `enrollment score ${((data.enrollment_score ?? 0) * 100).toFixed(0)}%, ` +
          `avg quality ${((data.average_quality_score ?? 0) * 100).toFixed(0)}%`
      )
      setPoses({})
      setStepIndex(0)
      stop()
    } catch (err: unknown) {
      const body = (err as { response?: { data?: { error?: string; rejected?: { pose_type: string; reason: string }[] } } })
        ?.response?.data
      if (body?.rejected?.length) {
        setMessage(
          body.rejected.map((r) => `${poseLabel(r.pose_type)}: ${reasonLabel(r.reason)}`).join('; ')
        )
      } else {
        setMessage(body?.error ?? 'Enrollment failed')
      }
    }
  }

  const current = currentPose ? poses[currentPose] : undefined
  const selectedEmployee = employees.find((e) => String(e.id) === employeeId)

  return (
    <div>
      <PageHeader
        title="Face Enrollment"
        description="Capture all required angles and expressions. Blurry, dark, occluded, multi-face, and low-resolution images are rejected automatically."
        actions={<Badge tone="neutral">Guided mode</Badge>}
      />

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3">
        {/* Capture column */}
        <div className="space-y-6 lg:col-span-2">
          <SectionCard step={1} title="Select employee" subtitle="Choose who you're enrolling.">
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
                This employee is already enrolled — completing this flow will replace their reference set.
              </p>
            )}
          </SectionCard>

          <SectionCard
            step={2}
            title="Capture poses"
            subtitle={
              currentPose
                ? `Current step: ${currentLabel}`
                : 'Capture each required pose in turn.'
            }
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
                  currentPose
                    ? `Align your face with the guide for the “${currentLabel}” pose, then capture.`
                    : 'Center your face in the guide, then capture.'
                }
                controls={
                  <>
                    <Button
                      type="button"
                      onClick={captureFromCamera}
                      disabled={!currentPose}
                      isLoading={validateImage.isPending}
                    >
                      Capture {currentLabel || 'pose'}
                    </Button>
                    <Button type="button" variant="ghost" onClick={stop}>
                      Stop camera
                    </Button>
                  </>
                }
              />
            ) : (
              <ImageDropzone
                label="Image for current step"
                onFile={onFile}
                hint={
                  currentPose
                    ? `Upload the ${currentLabel} pose · JPEG or PNG`
                    : 'JPEG or PNG · one clear, front-facing face'
                }
              />
            )}

            {/* Feedback on the latest capture for the current pose */}
            {current && (
              <div
                className={cn(
                  'mt-4 flex items-start gap-3 rounded-lg border p-3',
                  current.accepted ? 'border-green-600/50 bg-green-500/5' : 'border-red-600/50 bg-red-500/5'
                )}
              >
                <img src={current.dataUrl} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-700" />
                <div className="text-sm">
                  {current.accepted ? (
                    <>
                      <span className="font-medium text-green-400">Accepted</span>
                      {current.quality_score != null && (
                        <p className="mt-0.5 text-slate-400">
                          Quality {(current.quality_score * 100).toFixed(0)}%
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="font-medium text-red-400">{reasonLabel(current.reason)}</span>
                  )}
                  <button
                    type="button"
                    className="mt-2 block text-xs text-slate-400 underline hover:text-slate-200"
                    onClick={() => clearPose(currentPose)}
                  >
                    Retake
                  </button>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* Checklist column */}
        <div className="lg:col-span-1">
          <SectionCard
            title="Pose checklist"
            subtitle={`${completedCount} of ${requiredPoses.length} validated`}
            className="lg:sticky lg:top-6"
          >
            <ProgressBar value={completedCount} max={requiredPoses.length || 1} />

            <ul className="mt-4 space-y-2">
              {requiredPoses.map((pose, i) => {
                const cap = poses[pose]
                const done = cap?.accepted
                const failed = cap && !cap.accepted
                const isCurrent = i === stepIndex
                return (
                  <li key={pose}>
                    <button
                      type="button"
                      onClick={() => setStepIndex(i)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        isCurrent
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                          done && 'bg-green-500/20 text-green-400',
                          failed && 'bg-red-500/20 text-red-400',
                          !cap && (isCurrent ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-800 text-slate-400')
                        )}
                      >
                        {done ? '✓' : failed ? '✕' : i + 1}
                      </span>
                      <span
                        className={cn(
                          'flex-1 capitalize',
                          done ? 'text-slate-200' : failed ? 'text-red-300' : 'text-slate-300'
                        )}
                      >
                        {poseLabel(pose)}
                      </span>
                      {isCurrent && !done && (
                        <span className="text-[11px] font-medium uppercase tracking-wide text-blue-400">
                          Current
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
              {requiredPoses.length === 0 && (
                <li className="rounded-lg border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
                  Loading required poses…
                </li>
              )}
            </ul>

            <Button type="submit" fullWidth className="mt-5" isLoading={submitting} disabled={!canSubmit}>
              {submitting
                ? 'Registering…'
                : `Complete enrollment (${completedCount}/${requiredPoses.length})`}
            </Button>

            {message && (
              <div className="mt-4">
                <StatusAlert tone={successMessage ? 'ok' : 'error'}>{message}</StatusAlert>
              </div>
            )}
          </SectionCard>
        </div>
      </form>
    </div>
  )
}
