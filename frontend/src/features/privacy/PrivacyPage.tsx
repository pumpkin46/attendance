import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { useAuth } from '@/features/auth/AuthProvider'
import { useActiveEmployees } from '@/features/employees/api/queries'
import { useEraseEmployeeData, useMyData, usePrivacyPolicy } from '@/features/privacy/api/queries'

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
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-data-${myData.user.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const confirmErase = () => {
    if (!eraseId) return
    const emp = employees.find((e) => String(e.id) === eraseId)
    const name = emp ? `${emp.first_name} ${emp.last_name}` : `#${eraseId}`
    if (
      window.confirm(
        `Permanently erase ${name}'s biometric data, attendance, and PII? This anonymizes the record and cannot be undone.`
      )
    ) {
      erase.mutate(Number(eraseId), { onSuccess: () => setEraseId('') })
    }
  }

  return (
    <div>
      <PageHeader
        title="Privacy & GDPR"
        description="Data retention policy, personal-data export, and right-to-erasure (GDPR Art. 15 & 17)."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-lg font-medium">Data policy</h2>
          {policy ? (
            <div className="space-y-3 text-sm text-slate-300">
              <p>
                GDPR mode:{' '}
                <span className={policy.gdpr_enabled ? 'text-green-400' : 'text-amber-400'}>
                  {policy.gdpr_enabled ? 'enabled' : 'disabled'}
                </span>
              </p>
              <div>
                <p className="mb-1 text-slate-400">Retention</p>
                <ul className="list-inside list-disc text-slate-300">
                  <li>Audit logs: {policy.retention_audit_logs_days} days</li>
                  <li>Recognition events: {policy.retention_recognition_events_days} days</li>
                  <li>Notifications: {policy.retention_notifications_days} days</li>
                </ul>
              </div>
              <div>
                <p className="mb-1 text-slate-400">Data collected</p>
                <div className="flex flex-wrap gap-2">
                  {policy.data_collected.map((d) => (
                    <span key={d} className="rounded-full bg-slate-800 px-3 py-1 text-xs">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-slate-400">Purposes</p>
                <div className="flex flex-wrap gap-2">
                  {policy.data_purposes.map((d) => (
                    <span key={d} className="rounded-full bg-slate-800 px-3 py-1 text-xs">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
              {policy.privacy_contact_email && (
                <p className="text-slate-400">
                  Contact: <span className="text-slate-200">{policy.privacy_contact_email}</span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Loading…</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-medium">My data (Art. 15)</h2>
          {myData ? (
            <div className="space-y-3 text-sm text-slate-300">
              <p>
                {myData.user.name} · {myData.user.email}
              </p>
              <ul className="list-inside list-disc text-slate-300">
                <li>{myData.attendance_records.length} attendance records</li>
                <li>{myData.notifications_count} notifications</li>
                <li>{myData.audit_logs_count} audit log entries</li>
              </ul>
              <Button onClick={downloadMyData}>Download my data (JSON)</Button>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No personal data linked to this account.</p>
          )}
        </Card>

        {canErase && (
          <Card className="border-red-800/40 lg:col-span-2">
            <h2 className="mb-3 text-lg font-medium text-red-300">Right to erasure (Art. 17)</h2>
            <p className="mb-4 text-sm text-slate-400">
              Permanently removes an employee's face embeddings, anonymizes recognition/attendance data,
              and deactivates the record.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Label className="min-w-[260px] flex-1">
                Employee
                <Select value={eraseId} onChange={(e) => setEraseId(e.target.value)}>
                  <option value="">Select employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.employee_code} — {e.first_name} {e.last_name}
                    </option>
                  ))}
                </Select>
              </Label>
              <Button variant="danger" disabled={!eraseId || erase.isPending} onClick={confirmErase}>
                Erase data
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
