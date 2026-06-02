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
  min_images: number
  max_images: number
  retain_raw_images: boolean
}

interface CapturedImage {
  id: string
  dataUrl: string
  accepted: boolean | null
  reason?: string
  quality_score?: number
}

const REASON_LABELS: Record<string, string> = {
  blurry: 'Too blurry',
  multiple_faces: 'Multiple faces',
  no_face: 'No face detected',
  covered_face: 'Face covered or partial',
  low_detection_score: 'Face not clear enough',
  low_quality: 'Overall quality too low',
  invalid_image: 'Invalid image',
}

export default function EnrollmentPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [config, setConfig] = useState<EnrollmentConfig>({
    min_images: 10,
    max_images: 50,
    retain_raw_images: false,
  })
  const [captured, setCaptured] = useState<CapturedImage[]>([])
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [useCamera, setUseCamera] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const { videoRef, canvasRef, active, error: camError, start, stop, captureFrame } = useWebcam()

  useEffect(() => {
    api.get<Paginated<Employee>>('/employees', { params: { per_page: 100, is_active: true } })
      .then((r) => setEmployees(r.data.data))
    api.get<EnrollmentConfig>('/enrollment/config').then((r) => setConfig(r.data))
  }, [])

  const validateAndAdd = useCallback(async (dataUrl: string) => {
    if (captured.length >= config.max_images) {
      setMessage(`Maximum ${config.max_images} images reached`)
      return
    }

    try {
      const { data } = await api.post<{
        accepted: boolean
        reason?: string
        quality_score?: number
      }>('/enrollment/validate-image', { image: dataUrl })

      setCaptured((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          dataUrl,
          accepted: data.accepted,
          reason: data.reason,
          quality_score: data.quality_score,
        },
      ])
    } catch {
      setCaptured((prev) => [
        ...prev,
        { id: crypto.randomUUID(), dataUrl, accepted: false, reason: 'validation_error' },
      ])
    }
  }, [captured.length, config.max_images])

  const captureFromCamera = async () => {
    const frame = captureFrame(640)
    if (frame) await validateAndAdd(frame)
  }

  const onFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (captured.length >= config.max_images) break
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      await validateAndAdd(dataUrl)
    }
  }

  const removeImage = (id: string) => {
    setCaptured((prev) => prev.filter((c) => c.id !== id))
  }

  const acceptedCount = captured.filter((c) => c.accepted).length
  const canSubmit = acceptedCount >= config.min_images && employeeId && !submitting
  const successMessage = message.includes('completed') || message.includes('stored')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const images = captured.filter((c) => c.accepted).map((c) => c.dataUrl)
    setSubmitting(true)
    setMessage('')
    try {
      const { data } = await api.post<{ message: string; embeddings_stored: number }>(
        `/employees/${employeeId}/enroll-face-batch`,
        { images }
      )
      setMessage(
        `${data.message} — ${data.embeddings_stored} embeddings stored (FR-006/FR-008)`
      )
      setCaptured([])
      stop()
    } catch (err: unknown) {
      const rejected = (err as { response?: { data?: { rejected?: { reason: string }[] } } })
        ?.response?.data?.rejected
      if (rejected?.length) {
        setMessage(`${rejected.length} image(s) rejected: ${rejected.map((r) => r.reason).join(', ')}`)
      } else {
        setMessage('Enrollment failed — ensure 10–50 valid face images')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Face Enrollment"
        description={`Capture ${config.min_images}–${config.max_images} images. Blur, covered face, and multiple-face images are rejected automatically.`}
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
              Upload files
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
                    <Button type="button" onClick={captureFromCamera}>
                      Capture frame
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
              Select multiple images
              <Input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => e.target.files && onFiles(e.target.files)}
              />
            </Label>
          )}

          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="text-sm">
              Valid images: {acceptedCount} / {config.min_images} minimum
            </strong>
            <span className="text-sm text-slate-400">
              ({captured.length} total, max {config.max_images})
            </span>
          </div>

          {captured.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3">
              {captured.map((img) => (
                <div
                  key={img.id}
                  className={cn(
                    'relative overflow-hidden rounded-lg border-2',
                    img.accepted ? 'border-green-500' : 'border-red-500'
                  )}
                >
                  <img src={img.dataUrl} alt="" className="aspect-square w-full object-cover" />
                  <span className="block bg-slate-900/90 px-1 py-0.5 text-center text-[10px] leading-tight">
                    {img.accepted
                      ? `OK ${img.quality_score != null ? (img.quality_score * 100).toFixed(0) + '%' : ''}`
                      : REASON_LABELS[img.reason ?? ''] ?? img.reason}
                  </span>
                  <button
                    type="button"
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-xs hover:bg-red-600"
                    onClick={() => removeImage(img.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button type="submit" disabled={!canSubmit}>
            {submitting
              ? 'Registering…'
              : `Register face (${acceptedCount}/${config.min_images} min)`}
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
