import { useCallback, useState, type FormEvent } from 'react'
import { useWebcam } from '@/shared/hooks/useWebcam'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ImageDropzone } from '@/shared/ui/ImageDropzone'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Combobox } from '@/shared/ui/Combobox'
import { cn } from '@/shared/lib/cn'
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
  const [useCamera, setUseCamera] = useState(true)

  const validateImage = useValidateImage()
  const enrollFace = useEnrollFace()
  const submitting = enrollFace.isPending

  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()

  const requiredPoses = config?.required_poses ?? []
  const currentPose = requiredPoses[stepIndex] ?? requiredPoses[0]
  const currentLabel = config?.pose_labels?.[currentPose] ?? currentPose?.replace(/_/g, ' ') ?? ''

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
          body.rejected.map((r) => `${r.pose_type}: ${reasonLabel(r.reason)}`).join('; ')
        )
      } else {
        setMessage(body?.error ?? 'Enrollment failed')
      }
    }
  }

  return (
    <div>
      <PageHeader
        title="Face Enrollment"
        description="Capture all required angles and expressions. Blurry, dark, occluded, multi-face, and low-resolution images are rejected automatically."
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

          {config && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <p className="text-sm font-medium text-slate-200">
                Step {Math.min(stepIndex + 1, requiredPoses.length)} of {requiredPoses.length}:{' '}
                {currentLabel}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {requiredPoses.map((pose, i) => {
                  const cap = poses[pose]
                  const done = cap?.accepted
                  const failed = cap && !cap.accepted
                  return (
                    <button
                      key={pose}
                      type="button"
                      className={cn(
                        'rounded-full px-3 py-1 text-xs capitalize',
                        i === stepIndex && 'ring-2 ring-blue-400',
                        done && 'bg-green-900/60 text-green-300',
                        failed && 'bg-red-900/60 text-red-300',
                        !cap && 'bg-slate-800 text-slate-400'
                      )}
                      onClick={() => setStepIndex(i)}
                    >
                      {pose.replace(/_/g, ' ')}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

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
                    <Button type="button" onClick={captureFromCamera} disabled={!currentPose}>
                      Capture {currentPose?.replace(/_/g, ' ') ?? 'pose'}
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
              label="Image for current step"
              onFile={onFile}
              hint={
                currentPose
                  ? `Upload the ${currentPose.replace(/_/g, ' ')} pose · JPEG or PNG`
                  : 'JPEG or PNG · one clear, front-facing face'
              }
            />
          )}

          {currentPose && poses[currentPose] && (
            <div
              className={cn(
                'flex max-w-xs items-start gap-3 rounded-lg border p-3',
                poses[currentPose].accepted ? 'border-green-600' : 'border-red-600'
              )}
            >
              <img
                src={poses[currentPose].dataUrl}
                alt=""
                className="h-20 w-20 rounded object-cover"
              />
              <div className="text-sm">
                {poses[currentPose].accepted ? (
                  <>
                    <span className="text-green-400">Accepted</span>
                    {poses[currentPose].quality_score != null && (
                      <p className="text-slate-400">
                        Quality: {(poses[currentPose].quality_score! * 100).toFixed(0)}%
                      </p>
                    )}
                  </>
                ) : (
                  <span className="text-red-400">
                    {reasonLabel(poses[currentPose].reason)}
                  </span>
                )}
                <button
                  type="button"
                  className="mt-2 text-xs text-slate-400 underline"
                  onClick={() => clearPose(currentPose)}
                >
                  Retake
                </button>
              </div>
            </div>
          )}

          <div className="text-sm text-slate-300">
            Progress: {completedCount} / {requiredPoses.length} poses validated
          </div>

          <Button type="submit" disabled={!canSubmit}>
            {submitting
              ? 'Registering…'
              : `Complete enrollment (${completedCount}/${requiredPoses.length})`}
          </Button>

          {message && (
            <p className={cn('text-sm', successMessage ? 'text-green-400' : 'text-red-400')}>
              {message}
            </p>
          )}
        </form>
      </Card>
    </div>
  )
}
