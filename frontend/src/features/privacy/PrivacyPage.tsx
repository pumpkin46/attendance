import { useState, type ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { confirmDialog } from '@/shared/ui/dialogs'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Spinner } from '@/shared/ui/Loading'
import { cn } from '@/shared/lib/cn'
import { downloadBlob } from '@/shared/lib/download'
import { useAuth } from '@/features/auth/AuthProvider'
import { useActiveEmployees } from '@/features/employees/api/queries'
import { useEraseEmployeeData, useMyData, usePrivacyPolicy } from '@/features/privacy/api/queries'

const ShieldIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
const UserIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
  </svg>
)
const TrashIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
)
const DownloadIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
  </svg>
)

function SectionCard({
  icon,
  iconClass = 'bg-blue-500/15 text-blue-400',
  title,
  description,
  children,
  className,
}: {
  icon: ReactNode
  iconClass?: string
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="mb-4 flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', iconClass)}>
          {icon}
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
      </div>
      {children}
    </Card>
  )
}

function StatusPill({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-emerald-400' : 'bg-amber-400')} />
      {on ? onText : offText}
    </span>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">
      {children}
    </span>
  )
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-800/40 p-3">
      <div className="text-xl font-semibold text-slate-100">{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  )
}

export default function PrivacyPage() {
  const { hasPermission } = useAuth()
  const canErase = hasPermission('employees.manage')

  const { data: policy } = usePrivacyPolicy()
  const { data: myData } = useMyData()
  const { data: employeesResp } = useActiveEmployees(canErase)
  const employees = employeesResp?.data ?? []

  const [eraseId, setEraseId] = useState('')

  const erase = useEraseEmployeeData()

  const downloadMyData = () => {
    if (!myData) return
    const blob = new Blob([JSON.stringify(myData, null, 2)], { type: 'application/json' })
    downloadBlob(blob, `my-data-${myData.user.id}.json`)
  }

  const confirmErase = async () => {
    if (!eraseId) return
    const emp = employees.find((e) => String(e.id) === eraseId)
    const name = emp ? `${emp.first_name} ${emp.last_name}` : `#${eraseId}`
    const ok = await confirmDialog({
      title: 'Erase personal data',
      message: `Permanently erase ${name}'s biometric data, attendance, and PII? This anonymizes the record and cannot be undone.`,
      confirmLabel: 'Erase permanently',
    })
    if (ok) erase.mutate(Number(eraseId), { onSuccess: () => setEraseId('') })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy & GDPR"
        description="Data retention policy, personal-data export, and right-to-erasure (GDPR Art. 15 & 17)."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard icon={ShieldIcon} title="Data policy" description="Retention, collection, and purpose of processing">
          {policy ? (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-2.5">
                <span className="text-slate-300">GDPR mode</span>
                <StatusPill on={policy.gdpr_enabled} onText="Enabled" offText="Disabled" />
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Retention period
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat label="Audit logs" value={`${policy.retention_audit_logs_days}d`} />
                  <MiniStat label="Recognition" value={`${policy.retention_recognition_events_days}d`} />
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Data collected
                </p>
                <div className="flex flex-wrap gap-2">
                  {policy.data_collected.map((d) => (
                    <Chip key={d}>{d}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Purposes
                </p>
                <div className="flex flex-wrap gap-2">
                  {policy.data_purposes.map((d) => (
                    <Chip key={d}>{d}</Chip>
                  ))}
                </div>
              </div>

              {policy.privacy_contact_email && (
                <p className="border-t border-slate-800 pt-3 text-slate-400">
                  Privacy contact:{' '}
                  <a
                    href={`mailto:${policy.privacy_contact_email}`}
                    className="text-blue-400 hover:underline"
                  >
                    {policy.privacy_contact_email}
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Spinner size="sm" /> Loading…
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={UserIcon}
          iconClass="bg-emerald-500/15 text-emerald-400"
          title="My data (Art. 15)"
          description="Everything linked to your account"
        >
          {myData ? (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-3 rounded-lg bg-slate-800/40 p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-700 text-sm font-semibold text-slate-200">
                  {(myData.user.name ?? '?').slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-100">{myData.user.name ?? '—'}</div>
                  <div className="truncate text-xs text-slate-400">{myData.user.email ?? '—'}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Attendance" value={myData.attendance_records.length} />
                <MiniStat label="Audit logs" value={myData.audit_logs_count} />
              </div>
              <Button onClick={downloadMyData} leftIcon={DownloadIcon}>
                Download my data (JSON)
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No personal data linked to this account.</p>
          )}
        </SectionCard>

        {canErase && (
          <SectionCard
            icon={TrashIcon}
            iconClass="bg-red-500/15 text-red-400"
            title="Right to erasure (Art. 17)"
            description="Irreversible removal of an employee's personal data"
            className="border-red-800/40 lg:col-span-2"
          >
            <div className="mb-4 rounded-lg border border-red-800/40 bg-red-500/5 px-3 py-2.5 text-sm text-red-300">
              Permanently removes face embeddings, anonymizes recognition/attendance data, and
              deactivates the record. This action cannot be undone.
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Label className="min-w-[260px] flex-1">
                Employee
                <Combobox value={eraseId} onChange={(value) => setEraseId(value)}>
                  <option value="">Select employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_code} — {e.first_name} {e.last_name}
                    </option>
                  ))}
                </Combobox>
              </Label>
              <Button variant="danger" disabled={!eraseId} isLoading={erase.isPending} onClick={confirmErase}>
                Erase data
              </Button>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  )
}
