import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input, Select } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import { useActiveEmployees } from '@/features/employees/api/queries'
import {
  useAssignCard,
  useCreateReader,
  useDeleteReader,
  useEmployeeCards,
  useReaders,
  useRegenerateToken,
  useRevokeCard,
  useRfidEvents,
  useRfidLocations,
  useSimulateTap,
} from '@/features/rfid/api/queries'
import { emptyReaderForm, type ReaderForm, type TapResult } from '@/features/rfid/types'

export default function RfidPage() {
  const [showReaderForm, setShowReaderForm] = useState(false)
  const [readerForm, setReaderForm] = useState(emptyReaderForm)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [cardUid, setCardUid] = useState('')
  const [cardLabel, setCardLabel] = useState('')
  const [simulateReaderId, setSimulateReaderId] = useState('')
  const [simulateUid, setSimulateUid] = useState('')
  const [tapResult, setTapResult] = useState<TapResult | null>(null)

  const { data: readers = [] } = useReaders()
  const { data: eventsResp } = useRfidEvents()
  const events = eventsResp?.data ?? []
  const { data: locations = [] } = useRfidLocations()
  const { data: employeesResp } = useActiveEmployees()
  const employees = employeesResp?.data ?? []
  const { data: employeeCards = [] } = useEmployeeCards(selectedEmployeeId)

  const createReader = useCreateReader()
  const regenerate = useRegenerateToken()
  const deleteReader = useDeleteReader()
  const assignCardMutation = useAssignCard()
  const revokeCardMutation = useRevokeCard()
  const simulate = useSimulateTap()

  const saveReader = (e: React.FormEvent) => {
    e.preventDefault()
    createReader.mutate(readerForm, {
      onSuccess: (data) => {
        if (data.api_token_plain) setNewToken(data.api_token_plain)
        setShowReaderForm(false)
        setReaderForm(emptyReaderForm)
      },
    })
  }
  const regenerateToken = (readerId: number) =>
    regenerate.mutate(readerId, { onSuccess: (data) => setNewToken(data.api_token_plain) })
  const assignCard = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmployeeId) return
    assignCardMutation.mutate(
      { employeeId: selectedEmployeeId, uid: cardUid, label: cardLabel },
      {
        onSuccess: () => {
          setCardUid('')
          setCardLabel('')
        },
      }
    )
  }
  const revokeCard = (cardId: number) => revokeCardMutation.mutate(cardId)
  const simulateTap = (e: React.FormEvent) => {
    e.preventDefault()
    setTapResult(null)
    simulate.mutate(
      { readerId: simulateReaderId, uid: simulateUid },
      {
        onSuccess: (data) => setTapResult(data),
        onError: (err: unknown) => {
          const axiosErr = err as { response?: { data?: TapResult } }
          setTapResult(axiosErr.response?.data ?? { matched: false, reason: 'request_failed' })
        },
      }
    )
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
                  setReaderForm({ ...readerForm, direction: e.target.value as ReaderForm['direction'] })
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
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => regenerateToken(r.id)}>
                      New token
                    </Button>
                    <Button
                      variant="danger"
                      disabled={deleteReader.isPending}
                      onClick={() => {
                        if (window.confirm(`Deactivate reader "${r.name}"?`)) deleteReader.mutate(r.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
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
