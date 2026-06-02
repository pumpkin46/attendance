import { useRef, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'

interface IdentifyResult {
  matched: boolean
  reason?: string
  confidence?: number
  processing_ms?: number
  liveness_score?: number
  liveness_checks?: Record<string, unknown>
  employee?: { id: number; employee_code: string; first_name: string; last_name: string }
  attendance?: { action: string; employee_id?: number }
}

export default function RecognitionTestPage() {
  const [preview, setPreview] = useState<string | null>(null)
  const [cameraId, setCameraId] = useState('')
  const [requireLiveness, setRequireLiveness] = useState(true)
  const [result, setResult] = useState<IdentifyResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result as string)
    reader.readAsDataURL(file)
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
      const { data } = await api.post<IdentifyResult>('/recognition/identify', {
        image: preview,
        camera_id: cameraId ? Number(cameraId) : undefined,
        require_liveness: requireLiveness,
      })
      setResult(data)
    } catch {
      setError('Recognition request failed. Is the API and ai-service running?')
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
    multiple_or_no_face: 'Exactly one face must be visible in the frame.',
    low_detection_score: 'Face not clear enough — move closer to the camera.',
    unknown: 'No matching enrolled face. Enroll this person under Face Enrollment first.',
    low_confidence: 'Face found but similarity below threshold. Re-enroll with a clearer photo.',
  }

  return (
    <div>
      <PageHeader
        title="Test recognition (attendance)"
        description="Step 1: Face Enrollment with your image. Step 2: run recognition here (same or similar photo)."
      />

      <Card className="mb-6">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Label>
            Camera ID (optional)
            <Input
              type="number"
              placeholder="e.g. 1"
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
            />
          </Label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500"
              checked={requireLiveness}
              onChange={(e) => setRequireLiveness(e.target.checked)}
            />
            Require liveness / anti-spoof (recommended for production)
          </label>
          <Label>
            Camera image
            <Input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              required
            />
          </Label>
          {preview && (
            <img src={preview} alt="Preview" className="max-h-64 rounded-lg border border-slate-700" />
          )}
          <Button type="submit" disabled={loading}>
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
              {reasonHelp[result.reason ?? ''] ??
                `No match. Reason: ${result.reason ?? 'unknown'}`}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
