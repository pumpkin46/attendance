import { useState, type FormEvent } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { ImageDropzone } from '@/shared/ui/ImageDropzone'
import { PageHeader } from '@/shared/ui/PageHeader'
import { identifyFace } from '@/features/recognition/api/recognitionApi'
import type { IdentifyResult } from '@/features/recognition/types'

export default function RecognitionTestPage() {
  const [preview, setPreview] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [requireLiveness, setRequireLiveness] = useState(true)
  const [result, setResult] = useState<IdentifyResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const onFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG or PNG).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
    setFileName(file.name)
    setResult(null)
    setError('')
  }

  const clearImage = () => {
    setPreview(null)
    setFileName('')
    setResult(null)
    setError('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!preview) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const data = await identifyFace({
        image: preview,
        require_liveness: requireLiveness,
        source: 'upload',
      })
      setResult(data)
    } catch {
      setError('Recognition request failed. Is the backend API running?')
    } finally {
      setLoading(false)
    }
  }

  const reasonHelp: Record<string, string> = {
    liveness_failed: 'Anti-spoof check failed. Use a live face (not a photo of a photo or phone screen).',
    spoof_detected: 'Spoof detected (print or screen replay). Present your live face to the camera.',
    heuristic_failed: 'Image quality too low for liveness. Improve lighting and focus.',
    antispoof_model_unavailable:
      'Anti-spoof model not loaded. Run: python scripts/download_antispoof_model.py',
    blink_not_detected: 'Active liveness failed: no blink detected in the frame sequence.',
    head_movement_not_detected: 'Active liveness failed: insufficient head movement.',
    active_liveness_failed: 'Active liveness verification failed.',
    liveness_frames_required: 'Multi-frame liveness required — use Live Kiosk or Liveness Test.',
    multiple_or_no_face: 'Exactly one face must be visible in the frame.',
    low_detection_score: 'Face not clear enough — move closer to the camera.',
    unknown: 'No matching enrolled face. Enroll this person under Face Enrollment first.',
    low_confidence: 'Face found but similarity below threshold. Re-enroll with a clearer photo.',
  }

  const spoofLabels: Record<string, string> = {
    printed_photo: 'Printed photo attack detected (FR-017).',
    mobile_screen: 'Mobile screen replay detected (FR-017).',
    video_replay: 'Video replay detected (FR-017).',
    deepfake: 'Deepfake attempt detected (FR-017).',
  }

  return (
    <div>
      <PageHeader
        title="Test recognition (attendance)"
        description="Verify enrollment quality by running recognition against a test photo."
      />

      <Card className="mb-6">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Checkbox
            checked={requireLiveness}
            onChange={(e) => setRequireLiveness(e.target.checked)}
            label="Require liveness / anti-spoof (recommended for production)"
          />

          <ImageDropzone
            label="Camera image"
            preview={preview}
            fileName={fileName}
            onFile={onFile}
            onClear={clearImage}
          />

          <Button type="submit" disabled={loading || !preview}>
            {loading ? 'Processing…' : 'Run recognition + attendance'}
          </Button>
        </form>
      </Card>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {result && (
        <Card>
          <h2 className="mb-4 text-lg font-medium">Result</h2>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-300">
            {JSON.stringify(result, null, 2)}
          </pre>
          {result.matched && result.attendance?.action && (
            <p className="mt-4 text-sm text-green-400">
              Attendance action: <strong>{result.attendance.action}</strong>
            </p>
          )}
          {!result.matched && (
            <p className="mt-4 text-sm text-red-400">
              {result.spoof_type && spoofLabels[result.spoof_type]
                ? spoofLabels[result.spoof_type]
                : reasonHelp[result.reason ?? ''] ??
                  `No match. Reason: ${result.reason ?? 'unknown'}`}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
