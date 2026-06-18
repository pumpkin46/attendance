import { useNavigate } from 'react-router-dom'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { SidePanel } from '@/shared/ui/SidePanel'
import { SnapshotImage } from '@/shared/components/SnapshotImage'
import type { Camera } from '@/shared/types'
import { eventTone } from '@/features/dashboard/lib'
import type { LiveEvent } from '@/features/dashboard/types'

// Payload keys rendered as dedicated rows; anything else falls through to the
// generic "extra details" list so future payload fields still show up.
const KNOWN_KEYS = new Set([
  'recognition_event_id',
  'confidence',
  'liveness_passed',
  'reason',
  'attendance_action',
  'snapshot',
  'employee_id',
])

const prettify = (s: string) => {
  const text = s.replace(/[._]/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800 py-2.5 text-sm last:border-0">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className="min-w-0 break-words text-right text-slate-200">{value}</span>
    </div>
  )
}

export function LiveEventDetailPanel({
  event,
  cameras,
  open,
  onClose,
}: {
  event: LiveEvent | null
  cameras: Camera[]
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  if (!event) return null

  const payload = (event.payload ?? {})
  const recognitionEventId =
    typeof payload.recognition_event_id === 'number' ? payload.recognition_event_id : null
  const hasSnapshot = recognitionEventId != null && payload.snapshot !== false
  const confidence = typeof payload.confidence === 'number' ? payload.confidence : null
  const liveness = typeof payload.liveness_passed === 'boolean' ? payload.liveness_passed : null
  const reason = typeof payload.reason === 'string' ? payload.reason : null
  const attendanceAction =
    typeof payload.attendance_action === 'string' ? payload.attendance_action : null
  const cameraName =
    event.camera_id != null
      ? cameras.find((c) => c.id === event.camera_id)?.name ?? `Camera #${event.camera_id}`
      : null
  const extras = Object.entries(payload).filter(([k, v]) => !KNOWN_KEYS.has(k) && v != null)

  const isUnknown = event.event_type === 'recognition.unknown'
  const eventDate = new Date(event.occurred_at).toISOString().slice(0, 10)

  return (
    <SidePanel
      open={open}
      title="Event details"
      description={new Date(event.occurred_at).toLocaleString()}
      onClose={onClose}
      footer={
        <>
          {isUnknown && (
            <Button
              type="button"
              onClick={() => navigate(`/unknown-faces?from=${eventDate}&to=${eventDate}`)}
            >
              Open Unknown Faces
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {hasSnapshot && (
          <SnapshotImage
            eventId={recognitionEventId}
            alt="Event snapshot"
            className="aspect-video w-full rounded-lg object-cover ring-1 ring-slate-700/60"
          />
        )}

        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-100">{event.message}</p>
          <Badge tone={eventTone(event.event_type)} className="shrink-0 capitalize">
            {event.event_type.replace(/[._]/g, ' ')}
          </Badge>
        </div>

        <div>
          {cameraName && <Row label="Camera" value={cameraName} />}
          {confidence != null && <Row label="Confidence" value={`${(confidence * 100).toFixed(1)}%`} />}
          {liveness != null && (
            <Row
              label="Liveness"
              value={<Badge tone={liveness ? 'ok' : 'danger'}>{liveness ? 'Pass' : 'Fail'}</Badge>}
            />
          )}
          {attendanceAction && (
            <Row label="Attendance" value={<span className="capitalize">{attendanceAction.replace(/_/g, ' ')}</span>} />
          )}
          {reason && (
            <Row label="Reason" value={<span className="capitalize">{reason.replace(/_/g, ' ')}</span>} />
          )}
          {event.employee_id != null && <Row label="Employee" value={`#${event.employee_id}`} />}
          {event.visitor_id != null && <Row label="Visitor" value={`#${event.visitor_id}`} />}
          {extras.map(([key, value]) => (
            <Row key={key} label={prettify(key)} value={String(value)} />
          ))}
        </div>
      </div>
    </SidePanel>
  )
}
