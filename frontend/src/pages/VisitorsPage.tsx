import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import { VisitorDetailPanel } from '../components/VisitorDetailPanel'
import type { Employee, Paginated } from '../types'

type Tab = 'dashboard' | 'register' | 'visitors' | 'active' | 'approvals' | 'blacklist'

interface Host {
  id: number
  first_name: string
  last_name: string
  employee_code?: string
  department?: string
}

interface Visitor {
  id: number
  visitor_code?: string
  name: string
  first_name?: string
  last_name?: string
  company?: string
  phone?: string
  email?: string
  purpose?: string
  visit_start_at: string
  visit_end_at: string
  status: string
  approval_status?: string
  visitor_category?: string
  visit_type?: string
  face_registered: boolean
  check_in_code?: string
  badge_number?: string
  pin_code?: string
  face_expires_at?: string
  checked_in_at?: string
  checked_out_at?: string
  current_zone?: string
  host?: Host
}

interface DashboardStats {
  on_site: number
  expected: number
  checked_in_today: number
  checked_out_today: number
  overdue: number
  pending_approval: number
}

interface BlacklistEntry {
  id: number
  name: string
  id_number?: string
  reason: string
  notes?: string
  is_active: boolean
}

const VISITOR_CATEGORIES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'pre_registered', label: 'Pre-registered' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'interview_candidate', label: 'Interview candidate' },
  { value: 'temporary_staff', label: 'Temporary staff' },
  { value: 'government_official', label: 'Government official' },
  { value: 'delivery', label: 'Delivery' },
]

const VISIT_TYPES = [
  { value: 'business_meeting', label: 'Business meeting' },
  { value: 'interview', label: 'Interview' },
  { value: 'vendor_visit', label: 'Vendor visit' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'training', label: 'Training' },
  { value: 'contractor_work', label: 'Contractor work' },
  { value: 'government_visit', label: 'Government visit' },
  { value: 'audit', label: 'Audit' },
  { value: 'guest_visit', label: 'Guest visit' },
]

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  checked_in: 'ok',
  scheduled: 'neutral',
  pending_approval: 'warn',
  checked_out: 'neutral',
  expired: 'danger',
  cancelled: 'danger',
}

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

export default function VisitorsPage() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [activeVisitors, setActiveVisitors] = useState<Visitor[]>([])
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [blacklistForm, setBlacklistForm] = useState({ name: '', id_number: '', reason: 'blocked', notes: '' })
  const [pendingApprovals, setPendingApprovals] = useState<Visitor[]>([])
  const [detailVisitorId, setDetailVisitorId] = useState<number | null>(null)

  const loadDashboard = useCallback(() => {
    api.get<DashboardStats>('/visitors/dashboard').then((r) => setStats(r.data)).catch(() => {})
    api.get<Visitor[]>('/visitors/active').then((r) => setActiveVisitors(r.data)).catch(() => {})
  }, [])

  const loadVisitors = useCallback(() => {
    const params: Record<string, string | number> = { per_page: 50 }
    if (search) params.search = search
    if (statusFilter) params.status = statusFilter
    api.get<Paginated<Visitor>>('/visitors', { params }).then((r) => setVisitors(r.data.data))
  }, [search, statusFilter])

  const loadBlacklist = useCallback(() => {
    api.get<Paginated<BlacklistEntry>>('/visitor-blacklist', { params: { per_page: 50 } })
      .then((r) => setBlacklist(r.data.data))
      .catch(() => {})
  }, [])

  const loadPending = useCallback(() => {
    api.get<Visitor[]>('/visitors/pending-approval').then((r) => setPendingApprovals(r.data)).catch(() => {})
  }, [])

  const refreshAll = useCallback(() => {
    loadDashboard()
    loadVisitors()
    loadPending()
  }, [loadDashboard, loadVisitors, loadPending])

  useEffect(() => {
    api.get<Paginated<Employee>>('/employees', { params: { per_page: 100 } }).then((r) => setEmployees(r.data.data))
  }, [])

  useEffect(() => {
    if (tab === 'dashboard' || tab === 'active') loadDashboard()
    if (tab === 'visitors' || tab === 'register') loadVisitors()
    if (tab === 'approvals') loadPending()
    if (tab === 'blacklist') loadBlacklist()
  }, [tab, loadDashboard, loadVisitors, loadBlacklist, loadPending])

  useEffect(() => {
    if (tab === 'dashboard') {
      const timer = setInterval(loadDashboard, 15000)
      return () => clearInterval(timer)
    }
  }, [tab, loadDashboard])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    await api.post('/visitors', {
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
    setShowForm(false)
    setForm(emptyForm)
    setTab('visitors')
    loadVisitors()
    loadDashboard()
  }

  const enrollFace = async (visitorId: number) => {
    const dataUrl = prompt('Paste base64 image data URL for visitor face enrollment')
    if (!dataUrl) return
    await api.post(`/visitors/${visitorId}/enroll-face`, { image: dataUrl, method: 'admin' })
    loadVisitors()
    loadDashboard()
  }

  const checkIn = async (id: number) => {
    await api.post(`/visitors/${id}/check-in`)
    loadDashboard()
    loadVisitors()
  }

  const checkOut = async (id: number) => {
    await api.post(`/visitors/${id}/check-out`)
    loadDashboard()
    loadVisitors()
  }

  const cancel = async (id: number) => {
    if (!confirm('Cancel this visit?')) return
    await api.post(`/visitors/${id}/cancel`)
    loadVisitors()
    loadDashboard()
  }

  const addBlacklist = async (e: FormEvent) => {
    e.preventDefault()
    await api.post('/visitor-blacklist', blacklistForm)
    setBlacklistForm({ name: '', id_number: '', reason: 'blocked', notes: '' })
    loadBlacklist()
  }

  const removeBlacklist = async (id: number) => {
    await api.delete(`/visitor-blacklist/${id}`)
    loadBlacklist()
  }

  const formatDuration = (start: string) => {
    const ms = Date.now() - new Date(start).getTime()
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'register', label: 'Register' },
    { id: 'visitors', label: 'All visitors' },
    { id: 'active', label: 'On site' },
    { id: 'blacklist', label: 'Blacklist' },
  ]

  return (
    <div>
      <PageHeader
        title="Visitor Management"
        description="Register, verify, track, and manage visitors with face recognition and badge access."
        actions={
          tab !== 'register' && (
            <Button onClick={() => { setTab('register'); setShowForm(true) }}>
              Register visitor
            </Button>
          )
        }
      />

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-700 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && stats && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="On site" value={stats.on_site} tone="ok" />
            <StatCard label="Expected today" value={stats.expected} />
            <StatCard label="Checked in today" value={stats.checked_in_today} tone="ok" />
            <StatCard label="Checked out today" value={stats.checked_out_today} />
            <StatCard label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'danger' : undefined} />
            <StatCard label="Pending approval" value={stats.pending_approval} tone={stats.pending_approval > 0 ? 'warn' : undefined} />
          </div>
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-slate-300">Currently on site</h3>
            {activeVisitors.length === 0 ? (
              <p className="text-sm text-slate-500">No visitors on site.</p>
            ) : (
              <TableShell>
                <TableHead>
                  <Th>Visitor</Th>
                  <Th>Host</Th>
                  <Th>Zone</Th>
                  <Th>Check-in</Th>
                  <Th>Duration</Th>
                  <Th>Status</Th>
                </TableHead>
                <TableBody>
                  {activeVisitors.map((v) => (
                    <tr key={v.id}>
                      <Td>
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-slate-500">{v.company ?? '—'}</div>
                      </Td>
                      <Td>
                        {v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}
                      </Td>
                      <Td>{v.current_zone ?? 'Reception'}</Td>
                      <Td className="text-xs">
                        {v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString() : '—'}
                      </Td>
                      <Td>{v.checked_in_at ? formatDuration(v.checked_in_at) : '—'}</Td>
                      <Td>
                        <Badge tone="ok">On site</Badge>
                      </Td>
                    </tr>
                  ))}
                </TableBody>
              </TableShell>
            )}
          </Card>
        </>
      )}

      {(tab === 'register' || showForm) && tab === 'register' && (
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
              <Button type="submit">Register visitor</Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'visitors' && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <Input
              placeholder="Search name, company, code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[180px]">
              <option value="">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="pending_approval">Pending approval</option>
              <option value="checked_in">Checked in</option>
              <option value="checked_out">Checked out</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Button variant="ghost" onClick={loadVisitors}>Search</Button>
          </div>
          <TableShell>
            <TableHead>
              <Th>Visitor</Th>
              <Th>Category / Type</Th>
              <Th>Host</Th>
              <Th>Visit window</Th>
              <Th>Code / Badge</Th>
              <Th>Face</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {visitors.map((v) => (
                <tr key={v.id}>
                  <Td>
                    <div className="font-medium">{v.name}</div>
                    <div className="text-xs text-slate-500">{v.company ?? '—'}</div>
                    {v.visitor_code && <div className="font-mono text-xs text-slate-600">{v.visitor_code}</div>}
                  </Td>
                  <Td className="text-xs capitalize">
                    {v.visitor_category?.replace(/_/g, ' ') ?? '—'}
                    {v.visit_type && <div className="text-slate-500">{v.visit_type.replace(/_/g, ' ')}</div>}
                  </Td>
                  <Td>{v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}</Td>
                  <Td className="text-xs">
                    {new Date(v.visit_start_at).toLocaleString()} – {new Date(v.visit_end_at).toLocaleString()}
                  </Td>
                  <Td className="font-mono text-xs">
                    {v.check_in_code ?? '—'}
                    {v.badge_number && <div className="text-slate-500">{v.badge_number}</div>}
                    {v.pin_code && <div className="text-slate-600">PIN: {v.pin_code}</div>}
                  </Td>
                  <Td>
                    <Badge tone={v.face_registered ? 'ok' : 'neutral'}>
                      {v.face_registered ? 'Enrolled' : 'No face'}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>{v.status.replace(/_/g, ' ')}</Badge>
                  </Td>
                  <Td className="space-x-1">
                    <Button variant="ghost" onClick={() => setDetailVisitorId(v.id)}>View</Button>
                    {v.status === 'pending_approval' && (
                      <Button variant="ghost" onClick={() => setDetailVisitorId(v.id)}>Review</Button>
                    )}
                    {v.status === 'scheduled' && (
                      <Button variant="ghost" onClick={() => checkIn(v.id)}>Check in</Button>
                    )}
                    {v.status === 'checked_in' && (
                      <Button variant="ghost" onClick={() => checkOut(v.id)}>Check out</Button>
                    )}
                    {!v.face_registered && !['expired', 'cancelled', 'checked_out'].includes(v.status) && (
                      <Button variant="ghost" onClick={() => enrollFace(v.id)}>Enroll face</Button>
                    )}
                    {!['cancelled', 'checked_out', 'expired'].includes(v.status) && (
                      <Button variant="ghost" onClick={() => cancel(v.id)}>Cancel</Button>
                    )}
                  </Td>
                </tr>
              ))}
            </TableBody>
          </TableShell>
        </>
      )}

      {tab === 'approvals' && (
        <>
          <Card className="mb-4">
            <p className="text-sm text-slate-400">
              Pre-registered visitors require manager and security approval before check-in.
            </p>
          </Card>
          <TableShell>
            <TableHead>
              <Th>Visitor</Th>
              <Th>Company</Th>
              <Th>Host</Th>
              <Th>Visit date</Th>
              <Th>Approval stage</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {pendingApprovals.length === 0 ? (
                <tr>
                  <Td colSpan={6} className="text-center text-slate-500">No pending approvals.</Td>
                </tr>
              ) : (
                pendingApprovals.map((v) => (
                  <tr key={v.id}>
                    <Td>
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs capitalize text-slate-500">{v.visitor_category?.replace(/_/g, ' ')}</div>
                    </Td>
                    <Td>{v.company ?? '—'}</Td>
                    <Td>{v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}</Td>
                    <Td className="text-xs">{new Date(v.visit_start_at).toLocaleString()}</Td>
                    <Td>
                      <Badge tone="warn">{v.approval_status?.replace(/_/g, ' ') ?? 'pending'}</Badge>
                    </Td>
                    <Td>
                      <Button variant="ghost" onClick={() => setDetailVisitorId(v.id)}>Review</Button>
                    </Td>
                  </tr>
                ))
              )}
            </TableBody>
          </TableShell>
        </>
      )}

      {tab === 'active' && (
        <TableShell>
          <TableHead>
            <Th>Visitor</Th>
            <Th>Host</Th>
            <Th>Zone</Th>
            <Th>Check-in</Th>
            <Th>Duration</Th>
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {activeVisitors.map((v) => (
              <tr key={v.id}>
                <Td>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-slate-500">{v.badge_number}</div>
                </Td>
                <Td>{v.host ? `${v.host.first_name} ${v.host.last_name}` : '—'}</Td>
                <Td>{v.current_zone ?? 'Reception'}</Td>
                <Td className="text-xs">{v.checked_in_at ? new Date(v.checked_in_at).toLocaleString() : '—'}</Td>
                <Td>{v.checked_in_at ? formatDuration(v.checked_in_at) : '—'}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => checkOut(v.id)}>Check out</Button>
                </Td>
              </tr>
            ))}
          </TableBody>
        </TableShell>
      )}

      {tab === 'blacklist' && (
        <>
          <Card className="mb-6">
            <h3 className="mb-4 text-sm font-semibold text-slate-300">Add to blacklist / watchlist</h3>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={addBlacklist}>
              <Label>
                Name *
                <Input value={blacklistForm.name} onChange={(e) => setBlacklistForm({ ...blacklistForm, name: e.target.value })} required />
              </Label>
              <Label>
                ID number
                <Input value={blacklistForm.id_number} onChange={(e) => setBlacklistForm({ ...blacklistForm, id_number: e.target.value })} />
              </Label>
              <Label>
                Reason
                <Select value={blacklistForm.reason} onChange={(e) => setBlacklistForm({ ...blacklistForm, reason: e.target.value })}>
                  <option value="blocked">Blocked</option>
                  <option value="watchlist">Watchlist</option>
                  <option value="former_employee">Former employee</option>
                  <option value="restricted_contractor">Restricted contractor</option>
                </Select>
              </Label>
              <Label>
                Notes
                <Input value={blacklistForm.notes} onChange={(e) => setBlacklistForm({ ...blacklistForm, notes: e.target.value })} />
              </Label>
              <div className="sm:col-span-2">
                <Button type="submit">Add to blacklist</Button>
              </div>
            </form>
          </Card>
          <TableShell>
            <TableHead>
              <Th>Name</Th>
              <Th>ID number</Th>
              <Th>Reason</Th>
              <Th>Notes</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {blacklist.map((b) => (
                <tr key={b.id}>
                  <Td>{b.name}</Td>
                  <Td>{b.id_number ?? '—'}</Td>
                  <Td className="capitalize">{b.reason.replace(/_/g, ' ')}</Td>
                  <Td>{b.notes ?? '—'}</Td>
                  <Td>
                    <Button variant="ghost" onClick={() => removeBlacklist(b.id)}>Remove</Button>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </TableShell>
        </>
      )}

      {detailVisitorId !== null && (
        <VisitorDetailPanel
          visitorId={detailVisitorId}
          onClose={() => setDetailVisitorId(null)}
          onUpdated={refreshAll}
        />
      )}
    </div>
  )
}
