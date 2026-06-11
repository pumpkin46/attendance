import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '@/shared/api/client'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Badge } from '@/shared/ui/Badge'
import { SidePanel } from '@/shared/ui/SidePanel'
import { promptDialog } from '@/shared/ui/dialogs'
import { AuthImage } from '@/shared/components/AuthImage'
import { openAuthMedia } from '@/shared/lib/authMedia'

interface Host {
  id: number
  first_name: string
  last_name: string
  department?: string
}

export interface VisitorDetail {
  id: number
  organization_id: number
  name: string
  company?: string
  status: string
  approval_status?: string
  visitor_category?: string
  visit_type?: string
  purpose?: string
  photo_url?: string
  check_in_code?: string
  badge_number?: string
  pin_code?: string
  face_registered: boolean
  visit_start_at: string
  visit_end_at: string
  host?: Host
}

interface Photo {
  id: number
  url: string
  is_primary: boolean
  caption?: string
}

interface Document {
  id: number
  document_type: string
  url: string
  filename?: string
}

interface AccessPerm {
  id: number
  zone_name: string
  granted: boolean
}

const APPROVAL_STEPS = [
  { key: 'pending', label: 'Submitted' },
  { key: 'manager_approved', label: 'Manager' },
  { key: 'security_approved', label: 'Security' },
  { key: 'approved', label: 'Approved' },
]

const DOC_TYPES = [
  { value: 'id_front', label: 'ID front' },
  { value: 'id_back', label: 'ID back' },
  { value: 'work_permit', label: 'Work permit' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'vehicle_registration', label: 'Vehicle registration' },
  { value: 'other', label: 'Other' },
]

function stepIndex(status?: string) {
  if (!status || status === 'rejected') return -1
  return APPROVAL_STEPS.findIndex((s) => s.key === status)
}

export function VisitorDetailPanel({
  visitorId,
  open = true,
  onClose,
  onUpdated,
}: {
  visitorId: number
  open?: boolean
  onClose: () => void
  onUpdated: () => void
}) {
  const [visitor, setVisitor] = useState<VisitorDetail | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [zones, setZones] = useState('')
  const [perms, setPerms] = useState<AccessPerm[]>([])
  const [docType, setDocType] = useState('id_front')
  const [loadError, setLoadError] = useState(false)
  const [auxError, setAuxError] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api
      .get<VisitorDetail>(`/visitors/${visitorId}`)
      .then((r) => {
        setVisitor(r.data)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))
    api.get<Photo[]>(`/visitors/${visitorId}/photos`).then((r) => setPhotos(r.data)).catch(() => setAuxError(true))
    api.get<Document[]>(`/visitors/${visitorId}/documents`).then((r) => setDocuments(r.data)).catch(() => setAuxError(true))
    api.get<AccessPerm[]>(`/visitors/${visitorId}/access-permissions`)
      .then((r) => {
        setPerms(r.data)
        setZones(r.data.map((p) => p.zone_name).join(', '))
      })
      .catch(() => setAuxError(true))
  }, [visitorId])

  // Clears prior error flags then reloads (used by retry buttons).
  const retry = () => {
    setLoadError(false)
    setAuxError(false)
    load()
  }

  useEffect(() => {
    load()
  }, [load])

  const approve = async (stage: string) => {
    await api.post(`/visitors/${visitorId}/approve`, { stage })
    load()
    onUpdated()
  }

  const reject = async () => {
    const notes = await promptDialog({
      title: 'Reject visitor',
      message: 'The visit request will be rejected and the visitor will not be able to check in.',
      label: 'Reason (optional)',
      placeholder: 'e.g. host unavailable, missing documents…',
      multiline: true,
      confirmLabel: 'Reject visitor',
      tone: 'danger',
    })
    if (notes === null) return
    await api.post(`/visitors/${visitorId}/reject`, { notes: notes.trim() || undefined })
    load()
    onUpdated()
  }

  const uploadPhoto = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('is_primary', 'true')
    await api.post(`/visitors/${visitorId}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    load()
    onUpdated()
  }

  const uploadDoc = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('document_type', docType)
    await api.post(`/visitors/${visitorId}/documents`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    load()
  }

  const saveZones = async (e: FormEvent) => {
    e.preventDefault()
    const zoneList = zones.split(',').map((z) => z.trim()).filter(Boolean)
    await api.put(`/visitors/${visitorId}/access-permissions`, { zones: zoneList })
    load()
  }

  const currentStep = stepIndex(visitor?.approval_status)
  const isRejected = visitor?.approval_status === 'rejected'

  return (
    <SidePanel
      open={open}
      title={visitor?.name ?? 'Visitor details'}
      description={visitor ? (visitor.company ?? '—') : 'Loading visitor record…'}
      onClose={onClose}
    >
      {!visitor ? (
        <div className="py-16 text-center">
          {loadError ? (
            <>
              <p className="text-sm text-red-400">Failed to load visitor details.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="ghost" onClick={retry}>Retry</Button>
                <Button variant="ghost" onClick={onClose}>Close</Button>
              </div>
            </>
          ) : (
            <p className="text-slate-400">Loading…</p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4 flex gap-2">
            <Badge tone="neutral">{visitor.status.replace(/_/g, ' ')}</Badge>
            {visitor.approval_status && (
              <Badge tone={isRejected ? 'danger' : 'ok'}>
                {visitor.approval_status.replace(/_/g, ' ')}
              </Badge>
            )}
          </div>

          {auxError && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              <span>Some details (photos, documents, or zones) couldn&apos;t be loaded.</span>
              <button type="button" onClick={retry} className="font-medium underline hover:no-underline">
                Retry
              </button>
            </div>
          )}

          {/* Approval workflow */}
          <Card className="mb-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-300">Approval workflow</h3>
            <div className="flex items-center gap-1">
              {APPROVAL_STEPS.map((step, i) => (
                <div key={step.key} className="flex flex-1 flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      isRejected
                        ? 'bg-slate-700 text-slate-500'
                        : i <= currentStep
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span className="mt-1 text-center text-[10px] text-slate-400">{step.label}</span>
                </div>
              ))}
            </div>
            {visitor.status === 'pending_approval' && !isRejected && (
              <div className="mt-4 flex flex-wrap gap-2">
                {visitor.approval_status === 'pending' && (
                  <Button variant="ghost" onClick={() => approve('manager')}>Manager approve</Button>
                )}
                {visitor.approval_status === 'manager_approved' && (
                  <Button variant="ghost" onClick={() => approve('security')}>Security approve</Button>
                )}
                {visitor.approval_status === 'security_approved' && (
                  <Button variant="ghost" onClick={() => approve('final')}>Final approve</Button>
                )}
                {(visitor.approval_status === 'pending' ||
                  visitor.approval_status === 'manager_approved' ||
                  visitor.approval_status === 'security_approved') && (
                  <Button variant="ghost" onClick={() => approve('final')}>Approve all</Button>
                )}
                <Button variant="ghost" onClick={reject}>Reject</Button>
              </div>
            )}
          </Card>

          {/* Visit info */}
          <Card className="mb-4 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div><dt className="text-slate-500">Host</dt><dd>{visitor.host ? `${visitor.host.first_name} ${visitor.host.last_name}` : '—'}</dd></div>
              <div><dt className="text-slate-500">Purpose</dt><dd>{visitor.purpose ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Badge</dt><dd className="font-mono">{visitor.badge_number ?? '—'}</dd></div>
              <div><dt className="text-slate-500">PIN</dt><dd className="font-mono">{visitor.pin_code ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Check-in code</dt><dd className="font-mono">{visitor.check_in_code ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Face</dt><dd>{visitor.face_registered ? 'Enrolled' : 'Not enrolled'}</dd></div>
            </dl>
          </Card>

          {/* Photos */}
          <Card className="mb-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300">Photos</h3>
              <Button variant="ghost" onClick={() => photoRef.current?.click()}>Upload photo</Button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadPhoto(f)
                }}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              {visitor.photo_url && (
                <AuthImage src={visitor.photo_url} alt="Primary" className="h-20 w-20 rounded-lg object-cover" />
              )}
              {photos.map((p) => (
                <AuthImage
                  key={p.id}
                  src={p.url}
                  alt={p.caption ?? ''}
                  className="h-20 w-20 rounded-lg object-cover"
                />
              ))}
              {photos.length === 0 && !visitor.photo_url && (
                <p className="text-sm text-slate-500">No photos uploaded.</p>
              )}
            </div>
          </Card>

          {/* Documents */}
          <Card className="mb-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-300">Documents</h3>
              <Combobox
                value={docType}
                onChange={(value) => setDocType(value)}
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
              >
                {DOC_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </Combobox>
              <Button variant="ghost" onClick={() => docRef.current?.click()}>Upload</Button>
              <input
                ref={docRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadDoc(f)
                }}
              />
            </div>
            <ul className="space-y-2 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded bg-slate-800/50 px-3 py-2">
                  <span className="capitalize">{d.document_type.replace(/_/g, ' ')}</span>
                  <button
                    type="button"
                    onClick={() => openAuthMedia(d.url).catch(() => {})}
                    className="text-indigo-400 hover:underline"
                  >
                    {d.filename ?? 'View'}
                  </button>
                </li>
              ))}
              {documents.length === 0 && <li className="text-slate-500">No documents.</li>}
            </ul>
          </Card>

          {/* Access zones */}
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-300">Access zones</h3>
            <form onSubmit={saveZones} className="space-y-3">
              <Label>
                Authorized zones (comma-separated)
                <Input
                  value={zones}
                  onChange={(e) => setZones(e.target.value)}
                  placeholder="Reception, Meeting Rooms, Visitor Lounge"
                />
              </Label>
              <p className="text-xs text-slate-500">
                Match access point names or use &quot;Reception&quot; for lobby doors.
                {perms.length > 0 && ` Current: ${perms.map((p) => p.zone_name).join(', ')}`}
              </p>
              <Button type="submit">Save access zones</Button>
            </form>
          </Card>
        </>
      )}
    </SidePanel>
  )
}
