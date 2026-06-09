import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { DataTable } from '@/shared/ui/DataTable'
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
              <Combobox
                value={readerForm.location_id}
                onChange={(value) => setReaderForm({ ...readerForm, location_id: value })}
                required
              >
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Combobox>
            </Label>
            <Label>
              Direction
              <Combobox
                value={readerForm.direction}
                onChange={(value) =>
                  setReaderForm({ ...readerForm, direction: value as ReaderForm['direction'] })
                }
              >
                <option value="both">Check in &amp; out</option>
                <option value="in">Check in only</option>
                <option value="out">Check out only</option>
              </Combobox>
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
              <Combobox
                value={selectedEmployeeId}
                onChange={(value) => setSelectedEmployeeId(value)}
              >
                <option value="">Select employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employee_code} — {e.first_name} {e.last_name}
                  </option>
                ))}
              </Combobox>
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
              <Combobox
                value={simulateReaderId}
                onChange={(value) => setSimulateReaderId(value)}
                required
              >
                <option value="">Select reader</option>
                {readers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Combobox>
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
        <DataTable
          data={readers}
          rowKey={(r) => r.id}
          empty="No RFID readers registered yet"
          columns={[
            { key: 'name', header: 'Name', cell: (r) => r.name },
            { key: 'location', header: 'Location', cell: (r) => r.location?.name ?? '—' },
            { key: 'direction', header: 'Direction', cell: (r) => r.direction },
            {
              key: 'online',
              header: 'Online',
              cell: (r) => <Badge tone={r.online ? 'ok' : 'warn'}>{r.online ? 'Online' : 'Offline'}</Badge>,
            },
            { key: 'taps', header: 'Taps today', cell: (r) => r.taps_today ?? 0 },
            {
              key: 'actions',
              header: 'Actions',
              cell: (r) => (
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
              ),
            },
          ]}
        />
      </div>

      <h2 className="mb-3 text-lg font-medium">Recent tap events</h2>
      <DataTable
        data={events}
        rowKey={(e) => e.id}
        pageSize={10}
        empty="No tap events yet"
        columns={[
          { key: 'time', header: 'Time', cell: (e) => new Date(e.tapped_at).toLocaleString() },
          { key: 'uid', header: 'UID', cell: (e) => <code className="text-xs">{e.uid}</code> },
          {
            key: 'employee',
            header: 'Employee',
            cell: (e) => (e.employee ? `${e.employee.first_name} ${e.employee.last_name}` : '—'),
          },
          { key: 'reader', header: 'Reader', cell: (e) => e.reader?.name ?? '—' },
          {
            key: 'result',
            header: 'Result',
            cell: (e) => (
              <Badge tone={e.result === 'matched' ? 'ok' : e.result === 'unknown' ? 'danger' : 'warn'}>
                {e.result}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  )
}
