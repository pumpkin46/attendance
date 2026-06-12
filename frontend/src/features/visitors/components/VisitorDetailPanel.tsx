import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { SidePanel } from '@/shared/ui/SidePanel'
import { confirmDialog, promptDialog } from '@/shared/ui/dialogs'
import { AuthImage } from '@/shared/components/AuthImage'
import { FaceCaptureModal } from '@/shared/components/FaceCaptureModal'
import { MediaPreviewModal, type MediaPreviewItem } from '@/shared/components/MediaPreviewModal'
import {
  useApproveVisitor,
  useCancelVisit,
  useCheckInVisitor,
  useCheckOutVisitor,
  useDeleteVisitorDocument,
  useDeleteVisitorPhoto,
  useEnrollVisitorFace,
  useRejectVisitor,
  useSaveVisitorZones,
  useSetPrimaryVisitorPhoto,
  useUpdateVisitor,
  useUploadVisitorDocument,
  useUploadVisitorPhoto,
  useVisitorDetail,
  useVisitorDocuments,
  useVisitorPermissions,
  useVisitorPhotos,
  useVisitorTimeline,
} from '@/features/visitors/api/queries'
import { STATUS_TONE } from '@/features/visitors/types'
import { initials } from '@/shared/lib/format'

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

const ENDED_STATUSES = ['checked_out', 'expired', 'cancelled']

const EVENT_META: Record<string, { label: string; dot: string }> = {
  created: { label: 'Visitor registered', dot: 'bg-blue-400' },
  checked_in: { label: 'Checked in', dot: 'bg-emerald-400' },
  checked_out: { label: 'Checked out', dot: 'bg-slate-400' },
  approved: { label: 'Approved', dot: 'bg-emerald-400' },
  rejected: { label: 'Rejected', dot: 'bg-red-400' },
  cancelled: { label: 'Visit cancelled', dot: 'bg-red-400' },
  expired: { label: 'Access expired', dot: 'bg-red-400' },
  face_enrolled: { label: 'Face enrolled', dot: 'bg-violet-400' },
  photo_uploaded: { label: 'Photo uploaded', dot: 'bg-blue-400' },
  photo_deleted: { label: 'Photo deleted', dot: 'bg-slate-400' },
  document_uploaded: { label: 'Document uploaded', dot: 'bg-blue-400' },
  document_deleted: { label: 'Document deleted', dot: 'bg-slate-400' },
  access_revoked: { label: 'Access revoked', dot: 'bg-red-400' },
}

function stepIndex(status?: string) {
  if (!status || status === 'rejected') return -1
  return APPROVAL_STEPS.findIndex((s) => s.key === status)
}

function formatDateTime(value?: string) {
  if (!value) return '—'
  const d = new Date(value)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** ISO timestamp → `YYYY-MM-DDTHH:mm` in local time for the DatePicker. */
function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const icon = 'h-3.5 w-3.5'
const StarIcon = (
  <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
)
const TrashIcon = (
  <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" /></svg>
)
const PlusIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
)
const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
)
const CopyIcon = (
  <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
)
const PencilIcon = (
  <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
)
const FileIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
)
const UploadCloudIcon = (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" /><path d="M12 12v9M16 16l-4-4-4 4" /></svg>
)

const MAX_DOC_BYTES = 10 * 1024 * 1024
const DOC_EXT_RE = /\.(pdf|jpe?g|png|webp)$/i
const DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/** Card with a uniform header row — keeps every panel section visually aligned. */
function Section({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card padding={false} className={cn('overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-200">{children}</dd>
    </div>
  )
}

/** Mono credential chip with one-click copy (badge number, PIN, check-in code). */
function CopyChip({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Copy failed')
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label.toLowerCase()}`}
      className="group inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs transition-colors hover:border-slate-500"
    >
      <span className="text-slate-500">{label}</span>
      <span className="font-mono font-medium text-slate-200">{value}</span>
      <span className="text-slate-500 group-hover:text-slate-300">{CopyIcon}</span>
    </button>
  )
}

function PhotoActionButton({
  title,
  danger = false,
  onClick,
  children,
}: {
  title: string
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-md bg-slate-900/80 text-slate-200 backdrop-blur transition-colors',
        danger ? 'hover:bg-red-600 hover:text-white' : 'hover:bg-blue-600 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

export function VisitorDetailPanel({
  visitorId,
  open = true,
  onClose,
}: {
  visitorId: number
  open?: boolean
  onClose: () => void
}) {
  const { data: visitor, isError: loadError, refetch } = useVisitorDetail(visitorId)
  const { data: photos = [] } = useVisitorPhotos(visitorId)
  const { data: documents = [] } = useVisitorDocuments(visitorId)
  const { data: perms = [] } = useVisitorPermissions(visitorId)
  const { data: timeline = [] } = useVisitorTimeline(visitorId)

  const updateVisitor = useUpdateVisitor(visitorId)
  const approve = useApproveVisitor(visitorId)
  const rejectVisitor = useRejectVisitor(visitorId)
  const uploadPhoto = useUploadVisitorPhoto(visitorId)
  const deletePhoto = useDeleteVisitorPhoto(visitorId)
  const setPrimary = useSetPrimaryVisitorPhoto(visitorId)
  const uploadDoc = useUploadVisitorDocument(visitorId)
  const deleteDoc = useDeleteVisitorDocument(visitorId)
  const saveZonesMutation = useSaveVisitorZones(visitorId)
  const checkIn = useCheckInVisitor()
  const checkOut = useCheckOutVisitor()
  const cancelVisit = useCancelVisit()
  const enrollFace = useEnrollVisitorFace()

  const [docType, setDocType] = useState('id_front')
  const [docDragOver, setDocDragOver] = useState(false)
  const [zones, setZones] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [showFaceCapture, setShowFaceCapture] = useState(false)
  const [preview, setPreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  const currentStep = stepIndex(visitor?.approval_status)
  const isRejected = visitor?.approval_status === 'rejected'
  const ended = visitor ? ENDED_STATUSES.includes(visitor.status) : true
  const zonesValue = zones ?? perms.map((p) => p.zone_name).join(', ')

  const startEditing = () => {
    if (!visitor) return
    setEditForm({
      first_name: visitor.first_name ?? '',
      last_name: visitor.last_name ?? '',
      company: visitor.company ?? '',
      phone: visitor.phone ?? '',
      email: visitor.email ?? '',
      purpose: visitor.purpose ?? '',
      visit_start_at: toLocalInput(visitor.visit_start_at),
      visit_end_at: toLocalInput(visitor.visit_end_at),
    })
    setEditing(true)
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    await updateVisitor.mutateAsync({
      first_name: editForm.first_name || undefined,
      last_name: editForm.last_name || undefined,
      company: editForm.company,
      phone: editForm.phone,
      email: editForm.email,
      purpose: editForm.purpose,
      visit_start_at: editForm.visit_start_at || undefined,
      visit_end_at: editForm.visit_end_at || undefined,
    })
    setEditing(false)
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
    rejectVisitor.mutate(notes.trim() || undefined)
  }

  const onDeletePhoto = async (photoId: number) => {
    const ok = await confirmDialog({
      title: 'Delete photo',
      message: 'Remove this photo permanently? This cannot be undone.',
      confirmLabel: 'Delete photo',
    })
    if (ok) deletePhoto.mutate(photoId)
  }

  const uploadDocFiles = async (files: FileList | File[] | null) => {
    if (!files || uploadDoc.isPending) return
    for (const f of Array.from(files)) {
      if (!DOC_MIME.includes(f.type) && !DOC_EXT_RE.test(f.name)) {
        toast.error(`"${f.name}": unsupported type. Use PDF, JPG, PNG or WEBP.`)
        continue
      }
      if (f.size > MAX_DOC_BYTES) {
        toast.error(`"${f.name}" is too large (max 10 MB).`)
        continue
      }
      // Sequential so each file gets a distinct success/error toast.
      await uploadDoc.mutateAsync({ file: f, documentType: docType }).catch(() => {})
    }
  }

  const onDeleteDoc = async (docId: number, name: string) => {
    const ok = await confirmDialog({
      title: 'Delete document',
      message: `Remove "${name}" permanently? This cannot be undone.`,
      confirmLabel: 'Delete document',
    })
    if (ok) deleteDoc.mutate(docId)
  }

  const onCancelVisit = async () => {
    const ok = await confirmDialog({
      title: 'Cancel visit',
      message: 'Cancel this visit? The visitor will no longer be able to check in.',
      confirmLabel: 'Cancel visit',
      cancelLabel: 'Keep visit',
    })
    if (ok) cancelVisit.mutate(visitorId)
  }

  const saveZones = (e: FormEvent) => {
    e.preventDefault()
    const zoneList = zonesValue.split(',').map((z) => z.trim()).filter(Boolean)
    saveZonesMutation.mutate(zoneList, { onSuccess: () => setZones(null) })
  }

  const footer = visitor && !editing && (
    <>
      {visitor.status === 'scheduled' && (
        <Button variant="success" isLoading={checkIn.isPending} onClick={() => checkIn.mutate(visitorId)}>
          Check in
        </Button>
      )}
      {visitor.status === 'checked_in' && (
        <Button isLoading={checkOut.isPending} onClick={() => checkOut.mutate(visitorId)}>
          Check out
        </Button>
      )}
      {!visitor.face_registered && !ended && (
        <Button variant="ghost" onClick={() => setShowFaceCapture(true)}>
          Enroll face
        </Button>
      )}
      {!ended && (
        <Button
          variant="ghost"
          className="ml-auto text-red-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          onClick={onCancelVisit}
        >
          Cancel visit
        </Button>
      )}
    </>
  )

  return (
    <SidePanel
      open={open}
      title={visitor?.name ?? 'Visitor details'}
      description={
        visitor
          ? [visitor.company, visitor.visitor_category?.replace(/_/g, ' ')].filter(Boolean).join(' · ') || '—'
          : 'Loading visitor record…'
      }
      onClose={onClose}
      footer={footer || undefined}
    >
      {!visitor ? (
        <div className="py-16 text-center">
          {loadError ? (
            <>
              <p className="text-sm text-red-400">Failed to load visitor details.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="ghost" onClick={() => refetch()}>Retry</Button>
                <Button variant="ghost" onClick={onClose}>Close</Button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="mx-auto h-20 w-20 animate-pulse rounded-2xl bg-slate-800" />
              <div className="mx-auto h-3 w-40 animate-pulse rounded bg-slate-800" />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Identity hero */}
          <div className="flex items-center gap-4">
            {visitor.photo_url ? (
              <AuthImage
                src={visitor.photo_url}
                alt={visitor.name}
                cache
                className="h-20 w-20 shrink-0 rounded-2xl border border-slate-700 object-cover"
              />
            ) : (
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-xl font-semibold text-slate-300">
                {initials(visitor.name)}
              </span>
            )}
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[visitor.status] ?? 'neutral'} className="capitalize">
                  {visitor.status.replace(/_/g, ' ')}
                </Badge>
                {visitor.approval_status && (
                  <Badge tone={isRejected ? 'danger' : visitor.approval_status === 'approved' ? 'ok' : 'warn'} className="capitalize">
                    {visitor.approval_status.replace(/_/g, ' ')}
                  </Badge>
                )}
                <Badge tone={visitor.face_registered ? 'ok' : 'neutral'}>
                  {visitor.face_registered ? 'Face enrolled' : 'No face'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <CopyChip label="Code" value={visitor.check_in_code} />
                <CopyChip label="Badge" value={visitor.badge_number} />
                <CopyChip label="PIN" value={visitor.pin_code} />
              </div>
            </div>
          </div>

          {/* Approval workflow */}
          {(visitor.status === 'pending_approval' || isRejected) && (
            <Section title="Approval workflow">
              {isRejected ? (
                <p className="text-sm text-red-400">
                  This visit request was rejected. The visitor cannot check in.
                </p>
              ) : (
                <>
                  <div className="flex items-start">
                    {APPROVAL_STEPS.map((step, i) => {
                      const done = i <= currentStep
                      return (
                        <Fragment key={step.key}>
                          {i > 0 && (
                            <div
                              className={cn(
                                'mt-4 h-0.5 flex-1 rounded-full',
                                i <= currentStep ? 'bg-blue-500' : 'bg-slate-700'
                              )}
                            />
                          )}
                          <div className="flex w-16 shrink-0 flex-col items-center">
                            <div
                              className={cn(
                                'grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors',
                                done ? 'bg-blue-600 text-white' : 'border border-slate-600 bg-slate-800 text-slate-400'
                              )}
                            >
                              {done ? CheckIcon : i + 1}
                            </div>
                            <span className={cn('mt-1.5 text-center text-[10px]', done ? 'text-slate-200' : 'text-slate-500')}>
                              {step.label}
                            </span>
                          </div>
                        </Fragment>
                      )
                    })}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {visitor.approval_status === 'pending' && (
                      <Button size="sm" isLoading={approve.isPending} onClick={() => approve.mutate('manager')}>
                        Manager approve
                      </Button>
                    )}
                    {visitor.approval_status === 'manager_approved' && (
                      <Button size="sm" isLoading={approve.isPending} onClick={() => approve.mutate('security')}>
                        Security approve
                      </Button>
                    )}
                    {visitor.approval_status === 'security_approved' && (
                      <Button size="sm" isLoading={approve.isPending} onClick={() => approve.mutate('final')}>
                        Final approve
                      </Button>
                    )}
                    {['pending', 'manager_approved', 'security_approved'].includes(visitor.approval_status ?? '') && (
                      <Button size="sm" variant="ghost" isLoading={approve.isPending} onClick={() => approve.mutate('final')}>
                        Approve all stages
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
                      onClick={reject}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </Section>
          )}

          {/* Visit & contact details */}
          <Section
            title="Visit details"
            action={
              !editing ? (
                <Button size="sm" variant="ghost" leftIcon={PencilIcon} onClick={startEditing}>
                  Edit
                </Button>
              ) : undefined
            }
          >
            {editing ? (
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveEdit}>
                <Label>
                  First name
                  <Input value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} required />
                </Label>
                <Label>
                  Last name
                  <Input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} required />
                </Label>
                <Label>
                  Company
                  <Input value={editForm.company} onChange={(e) => setEditForm({ ...editForm, company: e.target.value })} />
                </Label>
                <Label>
                  Phone
                  <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </Label>
                <Label className="sm:col-span-2">
                  Email
                  <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </Label>
                <Label className="sm:col-span-2">
                  Purpose
                  <Input value={editForm.purpose} onChange={(e) => setEditForm({ ...editForm, purpose: e.target.value })} />
                </Label>
                <Label>
                  Visit start
                  <DatePicker withTime value={editForm.visit_start_at} onChange={(v) => setEditForm({ ...editForm, visit_start_at: v })} />
                </Label>
                <Label>
                  Visit end
                  <DatePicker withTime value={editForm.visit_end_at} onChange={(v) => setEditForm({ ...editForm, visit_end_at: v })} />
                </Label>
                <div className="flex gap-2 sm:col-span-2">
                  <Button size="sm" type="submit" isLoading={updateVisitor.isPending}>
                    Save changes
                  </Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <Field label="Host">
                  {visitor.host
                    ? `${visitor.host.first_name} ${visitor.host.last_name}${visitor.host.department ? ` · ${visitor.host.department}` : ''}`
                    : '—'}
                </Field>
                <Field label="Purpose">{visitor.purpose ?? '—'}</Field>
                <Field label="Visit type">
                  <span className="capitalize">{visitor.visit_type?.replace(/_/g, ' ') ?? '—'}</span>
                </Field>
                <Field label="Current zone">{visitor.current_zone ?? '—'}</Field>
                <Field label="Visit start">{formatDateTime(visitor.visit_start_at)}</Field>
                <Field label="Visit end">{formatDateTime(visitor.visit_end_at)}</Field>
                {visitor.checked_in_at && <Field label="Checked in">{formatDateTime(visitor.checked_in_at)}</Field>}
                {visitor.checked_out_at && <Field label="Checked out">{formatDateTime(visitor.checked_out_at)}</Field>}
                <Field label="Phone">{visitor.phone ?? '—'}</Field>
                <Field label="Email">{visitor.email ?? '—'}</Field>
                {visitor.id_number && <Field label="ID number">{visitor.id_number}</Field>}
                {visitor.nationality && <Field label="Nationality">{visitor.nationality}</Field>}
                {visitor.vehicle_number && <Field label="Vehicle">{visitor.vehicle_number}</Field>}
                {visitor.parking_zone && <Field label="Parking zone">{visitor.parking_zone}</Field>}
              </dl>
            )}
          </Section>

          {/* Photos */}
          <Section title={`Photos${photos.length ? ` (${photos.length})` : ''}`}>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {photos.map((p, photoIndex) => (
                <div
                  key={p.id}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-xl border',
                    p.is_primary ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-700'
                  )}
                >
                  <button
                    type="button"
                    title="View photo"
                    className="block h-full w-full cursor-zoom-in"
                    onClick={() =>
                      setPreview({
                        items: photos.map((photo, i) => ({
                          url: photo.url,
                          title: photo.caption ?? `Photo ${i + 1} of ${photos.length}`,
                        })),
                        index: photoIndex,
                      })
                    }
                  >
                    <AuthImage src={p.url} alt={p.caption ?? 'Visitor photo'} cache className="h-full w-full object-cover" />
                  </button>
                  {p.is_primary && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-blue-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                      Primary
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {!p.is_primary && (
                      <PhotoActionButton title="Set as primary" onClick={() => setPrimary.mutate(p.id)}>
                        {StarIcon}
                      </PhotoActionButton>
                    )}
                    <PhotoActionButton title="Delete photo" danger onClick={() => onDeletePhoto(p.id)}>
                      {TrashIcon}
                    </PhotoActionButton>
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={uploadPhoto.isPending}
                onClick={() => photoRef.current?.click()}
                className="grid aspect-square place-items-center rounded-xl border border-dashed border-slate-600 text-slate-500 transition-colors hover:border-blue-500 hover:text-blue-400 disabled:opacity-50"
              >
                {uploadPhoto.isPending ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
                ) : (
                  <span className="flex flex-col items-center gap-1 text-xs">
                    {PlusIcon}
                    Add photo
                  </span>
                )}
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  // Reset so picking the same file again still fires onChange.
                  e.target.value = ''
                  if (f && !uploadPhoto.isPending) uploadPhoto.mutate(f)
                }}
              />
            </div>
            {photos.length === 0 && (
              <p className="mt-3 text-xs text-slate-500">
                No photos yet. The first photo becomes the visitor&apos;s profile picture.
              </p>
            )}
          </Section>

          {/* Documents */}
          <Section title={`Documents${documents.length ? ` (${documents.length})` : ''}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">Document type</span>
              <Combobox
                value={docType}
                onChange={(value) => setDocType(value)}
                size="sm"
                aria-label="Document type"
                className="max-w-[11rem]"
              >
                {DOC_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </Combobox>
            </div>
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload document"
              onClick={() => docRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  docRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDocDragOver(true)
              }}
              onDragLeave={() => setDocDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDocDragOver(false)
                uploadDocFiles(e.dataTransfer.files)
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center outline-none transition-colors',
                docDragOver
                  ? 'border-blue-500 bg-blue-500/5'
                  : 'border-slate-600 hover:border-blue-500/70 focus-visible:border-blue-500',
                uploadDoc.isPending && 'pointer-events-none opacity-60'
              )}
            >
              {uploadDoc.isPending ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
                  <p className="mt-1 text-sm text-slate-300">Uploading…</p>
                </>
              ) : (
                <>
                  <span className="text-slate-500">{UploadCloudIcon}</span>
                  <p className="text-sm text-slate-300">
                    <span className="font-medium text-blue-400">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-500">PDF, JPG, PNG or WEBP · up to 10 MB</p>
                </>
              )}
            </div>
            <input
              ref={docRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,.pdf"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : null
                // Reset so picking the same file again still fires onChange.
                e.target.value = ''
                uploadDocFiles(files)
              }}
            />
            {documents.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No documents uploaded.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {documents.map((d, docIndex) => (
                  <li
                    key={d.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-700/60 text-slate-300">
                      {FileIcon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() =>
                          setPreview({
                            items: documents.map((doc) => ({
                              url: doc.url,
                              title: doc.filename ?? doc.document_type.replace(/_/g, ' '),
                            })),
                            index: docIndex,
                          })
                        }
                        className="block max-w-full truncate text-sm font-medium text-slate-200 hover:text-blue-400 hover:underline"
                      >
                        {d.filename ?? d.document_type.replace(/_/g, ' ')}
                      </button>
                      <div className="text-xs capitalize text-slate-500">
                        {d.document_type.replace(/_/g, ' ')}
                        {d.created_at && ` · ${formatDateTime(d.created_at)}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      title="Delete document"
                      aria-label="Delete document"
                      onClick={() => onDeleteDoc(d.id, d.filename ?? d.document_type.replace(/_/g, ' '))}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    >
                      {TrashIcon}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Access zones */}
          <Section title="Access zones">
            {perms.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {perms.map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium',
                      p.granted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/50 text-slate-400 line-through'
                    )}
                  >
                    {p.zone_name}
                  </span>
                ))}
              </div>
            )}
            <form onSubmit={saveZones} className="space-y-3">
              <Label>
                Authorized zones (comma-separated)
                <Input
                  value={zonesValue}
                  onChange={(e) => setZones(e.target.value)}
                  placeholder="Reception, Meeting Rooms, Visitor Lounge"
                />
              </Label>
              <p className="text-xs text-slate-500">
                Match access point names, or use &quot;Reception&quot; for lobby doors.
              </p>
              <Button size="sm" type="submit" isLoading={saveZonesMutation.isPending}>
                Save access zones
              </Button>
            </form>
          </Section>

          {/* Activity timeline */}
          <Section title="Activity">
            {timeline.length === 0 ? (
              <p className="text-xs text-slate-500">No activity recorded yet.</p>
            ) : (
              <ol className="relative ml-1.5 space-y-4 border-l border-slate-800 pl-5">
                {timeline.map((entry) => {
                  const meta = EVENT_META[entry.event_type] ?? {
                    label: entry.event_type.replace(/_/g, ' '),
                    dot: 'bg-slate-500',
                  }
                  return (
                    <li key={entry.id} className="relative">
                      <span
                        className={cn(
                          'absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-slate-900',
                          meta.dot
                        )}
                      />
                      <div className="text-sm font-medium capitalize text-slate-200">{meta.label}</div>
                      {entry.description && entry.description !== meta.label && (
                        <div className="text-xs text-slate-400">{entry.description}</div>
                      )}
                      <div className="mt-0.5 text-xs text-slate-600">{formatDateTime(entry.created_at)}</div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        </div>
      )}

      {preview && (
        <MediaPreviewModal items={preview.items} initialIndex={preview.index} onClose={() => setPreview(null)} />
      )}

      {showFaceCapture && (
        <FaceCaptureModal
          title="Enroll visitor face"
          description="Capture a clear, front-facing photo of the visitor."
          submitting={enrollFace.isPending}
          onClose={() => setShowFaceCapture(false)}
          onCapture={async (image) => {
            try {
              await enrollFace.mutateAsync({ id: visitorId, image })
              setShowFaceCapture(false)
            } catch {
              /* error toast handled globally; keep modal open to retry */
            }
          }}
        />
      )}
    </SidePanel>
  )
}
