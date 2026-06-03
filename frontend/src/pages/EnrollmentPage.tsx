import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { useWebcam } from '../hooks/useWebcam'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { Select } from '../components/ui/Input'
import { cn } from '../lib/cn'
import type { Employee, Paginated } from '../types'

interface EnrollmentConfig {
  mode: string
  required_poses: string[]
  pose_labels?: Record<string, string>
  min_images: number
  max_images: number
  retain_raw_images: boolean
  quality_thresholds?: Record<string, number>
}

interface PoseCapture {
  pose_type: string
  dataUrl: string
  accepted: boolean
  reason?: string
  quality_score?: number
  face_metadata?: Record<string, unknown>
}

const REASON_LABELS: Record<string, string> = {
  blurry: 'Too blurry',
  too_dark: 'Image too dark',
  low_resolution: 'Face too small / low resolution',
  multiple_faces: 'Multiple faces detected',
  no_face: 'No face detected',
  occluded_face: 'Face occluded or partial',
  covered_face: 'Face covered or partial',
  low_detection_score: 'Face not clear enough',
  low_quality: 'Overall quality too low',
  invalid_image: 'Invalid image',
  not_smiling: 'Please smile',
  not_neutral: 'Please use a neutral expression',
  glasses_not_detected: 'Glasses not visible',
  glasses_detected: 'Remove glasses for this step',
  wrong_pose: 'Pose does not match instruction',
  validation_error: 'Validation failed',
}

export default function EnrollmentPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [config, setConfig] = useState<EnrollmentConfig | null>(null)
  const [poses, setPoses] = useState<Record<string, PoseCapture>>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [useCamera, setUseCamera] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()

  const requiredPoses = config?.required_poses ?? []
  const currentPose = requiredPoses[stepIndex] ?? requiredPoses[0]
  const currentLabel = config?.pose_labels?.[currentPose] ?? currentPose?.replace(/_/g, ' ') ?? ''

  useEffect(() => {
    api.get<Paginated<Employee>>('/employees', { params: { per_page: 100, is_active: true } })
      .then((r) => setEmployees(r.data.data))
    api.get<EnrollmentConfig>('/enrollment/config').then((r) => setConfig(r.data))
  }, [])

  const validateAndSetPose = useCallback(
    async (poseType: string, dataUrl: string) => {
      try {
        const { data } = await api.post<{
          accepted: boolean
          reason?: string
          quality_score?: number
          face_metadata?: Record<string, unknown>
        }>('/enrollment/validate-image', {
          image: dataUrl,
          expected_pose: poseType,
        })

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
    [requiredPoses.length, stepIndex]
  )

  const captureFromCamera = async () => {
    if (!currentPose) return
    const frame = captureFrame(640)
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

    setSubmitting(true)
    setMessage('')
    try {
      const { data } = await api.post<{
        message: string
        embeddings_stored: number
        enrollment_score?: number
        average_quality_score?: number
      }>(`/employees/${employeeId}/enroll-face-structured`, { poses: posePayload })

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
          body.rejected.map((r) => `${r.pose_type}: ${REASON_LABELS[r.reason] ?? r.reason}`).join('; ')
        )
      } else {
        setMessage(body?.error ?? 'Enrollment failed')
      }
    } finally {
      setSubmitting(false)
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
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.first_name} {e.last_name}
                  {e.face_enrolled ? ' (re-enroll)' : ''}
                </option>
              ))}
            </Select>
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
            <Label>
              Image for current step
              <Input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </Label>
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
                    {REASON_LABELS[poses[currentPose].reason ?? ''] ?? poses[currentPose].reason}
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
