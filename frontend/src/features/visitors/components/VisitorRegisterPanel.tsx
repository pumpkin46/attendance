import { useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Combobox } from '@/shared/ui/Combobox'
import { DatePicker } from '@/shared/ui/DatePicker'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { SidePanel } from '@/shared/ui/SidePanel'
import { useEmployeeOptions, useRegisterVisitor } from '@/features/visitors/api/queries'
import { VISIT_TYPES, VISITOR_CATEGORIES } from '@/features/visitors/types'

const FORM_ID = 'visitor-register-form'

const emptyForm = {
  first_name: '',
  last_name: '',
  company: '',
  phone: '',
  email: '',
  purpose: '',
  host_employee_id: '',
  visit_start_at: '',
  visit_end_at: '',
  visitor_category: 'walk_in',
  visit_type: 'business_meeting',
  visit_description: '',
  id_number: '',
  nationality: '',
  pre_registered: false,
  contract_start_date: '',
  contract_end_date: '',
  vehicle_number: '',
  parking_zone: '',
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}

export function VisitorRegisterPanel({
  onClose,
  onRegistered,
}: {
  onClose: () => void
  onRegistered: () => void
}) {
  const [form, setForm] = useState(emptyForm)
  const { data: employeesResp } = useEmployeeOptions()
  const employees = employeesResp?.data ?? []
  const register = useRegisterVisitor()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await register.mutateAsync({
      first_name: form.first_name,
      last_name: form.last_name,
      company: form.company || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      purpose: form.purpose || undefined,
      host_employee_id: form.host_employee_id ? Number(form.host_employee_id) : null,
      visit_start_at: form.visit_start_at || undefined,
      visit_end_at: form.visit_end_at || undefined,
      visitor_category: form.visitor_category,
      visit_type: form.visit_type,
      visit_description: form.visit_description || undefined,
      id_number: form.id_number || undefined,
      nationality: form.nationality || undefined,
      pre_registered: form.pre_registered,
      contract_start_date: form.contract_start_date || undefined,
      contract_end_date: form.contract_end_date || undefined,
      vehicle_number: form.vehicle_number || undefined,
      parking_zone: form.parking_zone || undefined,
    })
    setForm(emptyForm)
    onRegistered()
  }

  return (
    <SidePanel
      title="Register visitor"
      description="Capture visitor and visit details. Fields marked * are required."
      onClose={onClose}
      footer={
        <>
          <Button type="submit" form={FORM_ID} isLoading={register.isPending}>
            Register visitor
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="space-y-8" onSubmit={submit}>
        <FormSection title="Visitor details">
          <Label>
            First name *
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          </Label>
          <Label>
            Last name *
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
          </Label>
          <Label>
            Company
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </Label>
          <Label>
            Phone
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Label>
          <Label>
            Email
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Label>
          <Label>
            ID number
            <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} />
          </Label>
          <Label>
            Nationality
            <Input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} />
          </Label>
        </FormSection>

        <FormSection title="Visit details">
          <Label>
            Category
            <Combobox value={form.visitor_category} onChange={(value) => setForm({ ...form, visitor_category: value })}>
              {VISITOR_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Visit type
            <Combobox value={form.visit_type} onChange={(value) => setForm({ ...form, visit_type: value })}>
              {VISIT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Host employee
            <Combobox value={form.host_employee_id} onChange={(value) => setForm({ ...form, host_employee_id: value })}>
              <option value="">—</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.first_name} {emp.last_name}
                </option>
              ))}
            </Combobox>
          </Label>
          <Label>
            Purpose
            <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          </Label>
          <Label className="sm:col-span-2">
            Visit description
            <Input value={form.visit_description} onChange={(e) => setForm({ ...form, visit_description: e.target.value })} />
          </Label>
          <Label>
            Visit start
            <DatePicker withTime value={form.visit_start_at} onChange={(value) => setForm({ ...form, visit_start_at: value })} />
          </Label>
          <Label>
            Visit end
            <DatePicker withTime value={form.visit_end_at} onChange={(value) => setForm({ ...form, visit_end_at: value })} />
          </Label>
          {form.visitor_category === 'contractor' && (
            <>
              <Label>
                Contract start
                <DatePicker value={form.contract_start_date} onChange={(value) => setForm({ ...form, contract_start_date: value })} />
              </Label>
              <Label>
                Contract end
                <DatePicker value={form.contract_end_date} onChange={(value) => setForm({ ...form, contract_end_date: value })} />
              </Label>
            </>
          )}
        </FormSection>

        <FormSection title="Vehicle & parking">
          <Label>
            Vehicle number
            <Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
          </Label>
          <Label>
            Parking zone
            <Input value={form.parking_zone} onChange={(e) => setForm({ ...form, parking_zone: e.target.value })} />
          </Label>
        </FormSection>

        <div className="border-t border-slate-800 pt-5">
          <Checkbox
            checked={form.pre_registered}
            onChange={(e) => setForm({ ...form, pre_registered: e.target.checked })}
            label="Pre-registration (requires approval workflow)"
          />
        </div>
      </form>
    </SidePanel>
  )
}
