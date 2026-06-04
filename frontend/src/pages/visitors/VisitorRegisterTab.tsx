import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input, Select } from '../../components/ui/Input'
import { Label } from '../../components/ui/Label'
import { useEmployeeOptions, useRegisterVisitor } from './queries'
import { VISIT_TYPES, VISITOR_CATEGORIES } from './types'

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

export function VisitorRegisterTab({ onRegistered }: { onRegistered: () => void }) {
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
    <Card className="mb-6">
      <h3 className="mb-4 text-sm font-semibold text-slate-300">Visitor registration</h3>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
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
        <Label>
          Category
          <Select value={form.visitor_category} onChange={(e) => setForm({ ...form, visitor_category: e.target.value })}>
            {VISITOR_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </Select>
        </Label>
        <Label>
          Visit type
          <Select value={form.visit_type} onChange={(e) => setForm({ ...form, visit_type: e.target.value })}>
            {VISIT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </Label>
        <Label>
          Host employee
          <Select value={form.host_employee_id} onChange={(e) => setForm({ ...form, host_employee_id: e.target.value })}>
            <option value="">—</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="sm:col-span-2">
          Purpose
          <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        </Label>
        <Label className="sm:col-span-2">
          Visit description
          <Input value={form.visit_description} onChange={(e) => setForm({ ...form, visit_description: e.target.value })} />
        </Label>
        <Label>
          Visit start
          <Input type="datetime-local" value={form.visit_start_at} onChange={(e) => setForm({ ...form, visit_start_at: e.target.value })} />
        </Label>
        <Label>
          Visit end
          <Input type="datetime-local" value={form.visit_end_at} onChange={(e) => setForm({ ...form, visit_end_at: e.target.value })} />
        </Label>
        {form.visitor_category === 'contractor' && (
          <>
            <Label>
              Contract start
              <Input type="date" value={form.contract_start_date} onChange={(e) => setForm({ ...form, contract_start_date: e.target.value })} />
            </Label>
            <Label>
              Contract end
              <Input type="date" value={form.contract_end_date} onChange={(e) => setForm({ ...form, contract_end_date: e.target.value })} />
            </Label>
          </>
        )}
        <Label>
          Vehicle number
          <Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
        </Label>
        <Label>
          Parking zone
          <Input value={form.parking_zone} onChange={(e) => setForm({ ...form, parking_zone: e.target.value })} />
        </Label>
        <Label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.pre_registered}
            onChange={(e) => setForm({ ...form, pre_registered: e.target.checked })}
          />
          Pre-registration (requires approval workflow)
        </Label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={register.isPending}>
            {register.isPending ? 'Registering…' : 'Register visitor'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
