import { useRef, useState, type FormEvent } from 'react'
import { api } from '../api/client'

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
      <h1>Test recognition (attendance)</h1>
      <p className="muted">
        Step 1: <strong>Face Enrollment</strong> with your image. Step 2: run recognition here (same or similar photo).
      </p>

      <form className="card enroll-form" onSubmit={submit}>
        <label>
          Camera ID (optional)
          <input
            type="number"
            placeholder="e.g. 1"
            value={cameraId}
            onChange={(e) => setCameraId(e.target.value)}
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={requireLiveness}
            onChange={(e) => setRequireLiveness(e.target.checked)}
          />
          Require liveness / anti-spoof (recommended for production)
        </label>
        <label>
          Camera image
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            required
          />
        </label>
        {preview && <img src={preview} alt="Preview" className="enroll-preview" />}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Processing…' : 'Run recognition + attendance'}
        </button>
      </form>

      {error && <p className="text-danger">{error}</p>}

      {result && (
        <div className="card">
          <h2>Result</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
          {result.matched && result.attendance?.action && (
            <p className="text-ok">
              Attendance action: <strong>{result.attendance.action}</strong>
            </p>
          )}
          {!result.matched && (
            <p className="text-danger">
              {reasonHelp[result.reason ?? ''] ??
                `No match. Reason: ${result.reason ?? 'unknown'}`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
