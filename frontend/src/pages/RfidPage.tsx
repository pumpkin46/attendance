import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input, Select } from '../components/ui/Input'
import { Label } from '../components/ui/Label'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Employee, Paginated, RfidEvent, RfidReader } from '../types'

interface Location {
  id: number
  name: string
}

interface RfidCard {
  id: number
  uid: string
  label?: string
  is_active: boolean
  assigned_at: string
}

interface TapResult {
  matched: boolean
  reason?: string
  attendance_action?: string
  employee?: { first_name: string; last_name: string; employee_code: string }
}

const emptyReaderForm = {
  location_id: '',
  name: '',
  direction: 'both' as RfidReader['direction'],
}

export default function RfidPage() {
  const [readers, setReaders] = useState<RfidReader[]>([])
  const [events, setEvents] = useState<RfidEvent[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [showReaderForm, setShowReaderForm] = useState(false)
  const [readerForm, setReaderForm] = useState(emptyReaderForm)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [cardUid, setCardUid] = useState('')
  const [cardLabel, setCardLabel] = useState('')
  const [employeeCards, setEmployeeCards] = useState<RfidCard[]>([])
  const [simulateReaderId, setSimulateReaderId] = useState('')
  const [simulateUid, setSimulateUid] = useState('')
  const [tapResult, setTapResult] = useState<TapResult | null>(null)

  const loadReaders = () => api.get<RfidReader[]>('/rfid-readers').then((r) => setReaders(r.data))
  const loadEvents = () =>
    api
      .get<Paginated<RfidEvent>>('/rfid-events', { params: { per_page: 25 } })
      .then((r) => setEvents(r.data.data))

  useEffect(() => {
    loadReaders()
    loadEvents()
    api.get<Location[]>('/locations').then((r) => setLocations(r.data ?? []))
    api
      .get<Paginated<Employee>>('/employees', { params: { per_page: 100, is_active: true } })
      .then((r) => setEmployees(r.data.data))
  }, [])

  useEffect(() => {
    if (!selectedEmployeeId) {
      setEmployeeCards([])
      return
    }
    api.get<RfidCard[]>(`/employees/${selectedEmployeeId}/rfid-cards`).then((r) => setEmployeeCards(r.data))
  }, [selectedEmployeeId])

  const saveReader = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data } = await api.post<RfidReader & { api_token_plain?: string }>('/rfid-readers', {
      location_id: Number(readerForm.location_id),
      name: readerForm.name,
      direction: readerForm.direction,
    })
    if (data.api_token_plain) setNewToken(data.api_token_plain)
    setShowReaderForm(false)
    setReaderForm(emptyReaderForm)
    loadReaders()
  }

  const regenerateToken = async (readerId: number) => {
    const { data } = await api.post<{ api_token_plain: string }>(
      `/rfid-readers/${readerId}/regenerate-token`
    )
    setNewToken(data.api_token_plain)
  }

  const assignCard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployeeId) return
    await api.post(`/employees/${selectedEmployeeId}/rfid-cards`, {
      uid: cardUid,
      label: cardLabel || null,
    })
    setCardUid('')
    setCardLabel('')
    api.get<RfidCard[]>(`/employees/${selectedEmployeeId}/rfid-cards`).then((r) => setEmployeeCards(r.data))
  }

  const revokeCard = async (cardId: number) => {
    await api.delete(`/rfid-cards/${cardId}`)
    if (selectedEmployeeId) {
      api.get<RfidCard[]>(`/employees/${selectedEmployeeId}/rfid-cards`).then((r) => setEmployeeCards(r.data))
    }
  }

  const simulateTap = async (e: React.FormEvent) => {
    e.preventDefault()
    setTapResult(null)
    try {
      const { data } = await api.post<TapResult>('/rfid/simulate', {
        rfid_reader_id: Number(simulateReaderId),
        uid: simulateUid,
      })
      setTapResult(data)
      loadEvents()
      loadReaders()
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: TapResult } }
      setTapResult(axiosErr.response?.data ?? { matched: false, reason: 'request_failed' })
      loadEvents()
    }
  }

  const onlineCount = readers.filter((r) => r.online).length
  const tapsToday = readers.reduce((n, r) => n + (r.taps_today ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="RFID Integration"
        description="Register readers, assign cards to employees, and process tap events for attendance"
        actions={
          <Button
            onClick={() => {
              if (showReaderForm) {
                setShowReaderForm(false)
                setReaderForm(emptyReaderForm)
              } else setShowReaderForm(true)
            }}
          >
            {showReaderForm ? 'Cancel' : 'Register reader'}
          </Button>
        }
      />

      {newToken && (
        <Card className="mb-6 border-amber-700/50 bg-amber-950/30">
          <p className="text-sm font-medium text-amber-200">Reader API token (shown once)</p>
          <code className="mt-2 block break-all rounded bg-slate-950 px-3 py-2 text-xs">{newToken}</code>
          <p className="mt-2 text-xs text-slate-400">
            Configure your physical reader to POST to{' '}
            <code>/api/v1/rfid/tap</code> with{' '}
            <code>Authorization: Bearer &lt;token&gt;</code>
          </p>
          <Button variant="ghost" className="mt-3" onClick={() => setNewToken(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      {showReaderForm && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-medium">Register RFID reader</h2>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveReader}>
            <Label>
              Name *
              <Input
                value={readerForm.name}
                onChange={(e) => setReaderForm({ ...readerForm, name: e.target.value })}
                placeholder="Lobby entrance"
                required
              />
            </Label>
            <Label>
              Location *
              <Select
                value={readerForm.location_id}
                onChange={(e) => setReaderForm({ ...readerForm, location_id: e.target.value })}
                required
              >
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Direction
              <Select
                value={readerForm.direction}
                onChange={(e) =>
                  setReaderForm({ ...readerForm, direction: e.target.value as RfidReader['direction'] })
                }
              >
                <option value="both">Check in &amp; out</option>
                <option value="in">Check in only</option>
                <option value="out">Check out only</option>
              </Select>
            </Label>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">Register reader</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        <StatCard label="Readers" value={readers.length} />
        <StatCard label="Online" value={onlineCount} />
        <StatCard label="Offline" value={readers.length - onlineCount} tone="warn" />
        <StatCard label="Taps today" value={tapsToday} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-medium">Assign RFID card</h2>
          <form className="grid gap-4" onSubmit={assignCard}>
            <Label>
              Employee
              <Select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
              >
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.first_name} {e.last_name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Card UID *
              <Input
                value={cardUid}
                onChange={(e) => setCardUid(e.target.value.toUpperCase())}
                placeholder="A1B2C3D4"
                required
              />
            </Label>
            <Label>
              Label
              <Input
                value={cardLabel}
                onChange={(e) => setCardLabel(e.target.value)}
                placeholder="Main badge"
              />
            </Label>
            <Button type="submit" disabled={!selectedEmployeeId}>
              Assign card
            </Button>
          </form>
          {employeeCards.length > 0 && (
            <div className="mt-4 border-t border-slate-800 pt-4">
              <p className="mb-2 text-sm text-slate-400">Cards for selected employee</p>
              <ul className="space-y-2 text-sm">
                {employeeCards.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span>
                      <code>{c.uid}</code>
                      {c.label && <span className="ml-2 text-slate-400">({c.label})</span>}
                      {!c.is_active && (
                        <Badge tone="warn" className="ml-2">
                          Revoked
                        </Badge>
                      )}
                    </span>
                    {c.is_active && (
                      <Button variant="ghost" onClick={() => revokeCard(c.id)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-medium">Simulate tap</h2>
          <form className="grid gap-4" onSubmit={simulateTap}>
            <Label>
              Reader
              <Select
                value={simulateReaderId}
                onChange={(e) => setSimulateReaderId(e.target.value)}
                required
              >
                <option value="">Select reader</option>
                {readers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label>
              Card UID
              <Input
                value={simulateUid}
                onChange={(e) => setSimulateUid(e.target.value.toUpperCase())}
                placeholder="A1B2C3D4"
                required
              />
            </Label>
            <Button type="submit">Simulate tap</Button>
          </form>
          {tapResult && (
            <p className="mt-4 text-sm">
              {tapResult.matched ? (
                <>
                  Matched{' '}
                  <strong>
                    {tapResult.employee?.first_name} {tapResult.employee?.last_name}
                  </strong>
                  {' · '}
                  action: {tapResult.attendance_action ?? 'none'}
                </>
              ) : (
                <>Not matched ({tapResult.reason ?? 'unknown'})</>
              )}
            </p>
          )}
        </Card>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Readers</h2>
        <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Location</Th>
          <Th>Direction</Th>
          <Th>Online</Th>
          <Th>Taps today</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {readers.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-slate-400">
                No RFID readers registered yet
              </Td>
            </tr>
          ) : (
            readers.map((r) => (
              <tr key={r.id}>
                <Td>{r.name}</Td>
                <Td>{r.location?.name ?? '—'}</Td>
                <Td>{r.direction}</Td>
                <Td>
                  <Badge tone={r.online ? 'ok' : 'warn'}>{r.online ? 'Online' : 'Offline'}</Badge>
                </Td>
                <Td>{r.taps_today ?? 0}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => regenerateToken(r.id)}>
                    New token
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
      </div>

      <h2 className="mb-3 text-lg font-medium">Recent tap events</h2>
      <TableShell>
        <TableHead>
          <Th>Time</Th>
          <Th>UID</Th>
          <Th>Employee</Th>
          <Th>Reader</Th>
          <Th>Result</Th>
        </TableHead>
        <TableBody>
          {events.length === 0 ? (
            <tr>
              <Td colSpan={5} className="text-slate-400">
                No tap events yet
              </Td>
            </tr>
          ) : (
            events.map((e) => (
              <tr key={e.id}>
                <Td>{new Date(e.tapped_at).toLocaleString()}</Td>
                <Td>
                  <code className="text-xs">{e.uid}</code>
                </Td>
                <Td>
                  {e.employee
                    ? `${e.employee.first_name} ${e.employee.last_name}`
                    : '—'}
                </Td>
                <Td>{e.reader?.name ?? '—'}</Td>
                <Td>
                  <Badge tone={e.result === 'matched' ? 'ok' : e.result === 'unknown' ? 'danger' : 'warn'}>
                    {e.result}
                  </Badge>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
