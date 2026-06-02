import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Employee, Paginated } from '../types'

interface Visitor {
  id: number
  name: string
  company?: string
  phone?: string
  purpose?: string
  visit_start_at: string
  visit_end_at: string
  status: string
  face_registered: boolean
  face_expires_at?: string
  host?: Employee
}

export default function VisitorsPage() {
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    organization_id: '1',
    name: '',
    company: '',
    phone: '',
    purpose: '',
    host_employee_id: '',
    visit_start_at: '',
    visit_end_at: '',
  })

  const load = () => {
    api.get<Paginated<Visitor>>('/visitors', { params: { per_page: 50 } }).then((r) => setVisitors(r.data.data))
  }

  useEffect(() => {
    load()
    api.get<Paginated<Employee>>('/employees', { params: { per_page: 100 } }).then((r) => setEmployees(r.data.data))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await api.post('/visitors', {
      ...form,
      organization_id: Number(form.organization_id),
      host_employee_id: form.host_employee_id ? Number(form.host_employee_id) : null,
      visit_start_at: form.visit_start_at || undefined,
      visit_end_at: form.visit_end_at || undefined,
    })
    setShowForm(false)
    load()
  }

  const enrollSample = async (visitorId: number) => {
    const dataUrl = prompt('Paste base64 image data URL for visitor face enrollment')
    if (!dataUrl) return
    await api.post(`/visitors/${visitorId}/enroll-face`, { image: dataUrl })
    load()
  }

  return (
    <div>
      <PageHeader
        title="Visitor Management"
        description="Register visitors, temporary face enrollment, and automatic expiration."
        actions={
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Register visitor'}
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <Label>
              Name *
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
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
              Host employee
              <Select
                value={form.host_employee_id}
                onChange={(e) => setForm({ ...form, host_employee_id: e.target.value })}
              >
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
            <Label>
              Visit start
              <Input
                type="datetime-local"
                value={form.visit_start_at}
                onChange={(e) => setForm({ ...form, visit_start_at: e.target.value })}
              />
            </Label>
            <Label>
              Visit end
              <Input
                type="datetime-local"
                value={form.visit_end_at}
                onChange={(e) => setForm({ ...form, visit_end_at: e.target.value })}
              />
            </Label>
            <div className="sm:col-span-2">
              <Button type="submit">Save visitor</Button>
            </div>
          </form>
        </Card>
      )}

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Company</Th>
          <Th>Host</Th>
          <Th>Visit</Th>
          <Th>Face</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {visitors.map((v) => (
            <tr key={v.id}>
              <Td>{v.name}</Td>
              <Td>{v.company ?? '—'}</Td>
              <Td>
                {v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}
              </Td>
              <Td className="text-xs">
                {new Date(v.visit_start_at).toLocaleString()} –{' '}
                {new Date(v.visit_end_at).toLocaleString()}
              </Td>
              <Td>
                <Badge tone={v.face_registered ? 'ok' : 'neutral'}>
                  {v.face_registered ? 'Enrolled' : 'No face'}
                </Badge>
              </Td>
              <Td className="capitalize">{v.status}</Td>
              <Td>
                {!v.face_registered && v.status !== 'expired' && (
                  <Button variant="ghost" onClick={() => enrollSample(v.id)}>
                    Enroll face
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
