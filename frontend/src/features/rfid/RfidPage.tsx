import { useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Combobox } from '@/shared/ui/Combobox'
import { Label } from '@/shared/ui/Label'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
import { StatCard } from '@/shared/ui/StatCard'
import { Tabs } from '@/shared/ui/Tabs'
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
import { relativeTime } from '@/shared/lib/format'

type Tab = 'readers' | 'cards' | 'events'

const DIRECTION_LABEL: Record<ReaderForm['direction'], string> = {
  both: 'In & out',
  in: 'Check in',
  out: 'Check out',
}

const resultTone = (r: string) => (r === 'matched' ? 'ok' : r === 'unknown' ? 'danger' : 'warn')

export default function RfidPage() {
  const [tab, setTab] = useState<Tab>('readers')
  const [readerPanel, setReaderPanel] = useState(false)
  const [simPanel, setSimPanel] = useState(false)

  const [readerForm, setReaderForm] = useState(emptyReaderForm)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [cardUid, setCardUid] = useState('')
  const [cardLabel, setCardLabel] = useState('')
  const [simulateReaderId, setSimulateReaderId] = useState('')
  const [simulateUid, setSimulateUid] = useState('')
  const [tapResult, setTapResult] = useState<TapResult | null>(null)
  const [eventSearch, setEventSearch] = useState('')
  const [resultFilter, setResultFilter] = useState('')

  const { data: readers = [], isPending: readersLoading } = useReaders()
  const { data: eventsResp, isPending: eventsLoading } = useRfidEvents()
  const events = useMemo(() => eventsResp?.data ?? [], [eventsResp])
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
        setReaderPanel(false)
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

  const resultOptions = useMemo(() => {
    const set = new Set(events.map((e) => e.result).filter(Boolean))
    return [
      { value: '', label: 'All results' },
      ...Array.from(set, (r) => ({ value: r, label: r })),
    ]
  }, [events])

  const filteredEvents = useMemo(() => {
    const q = eventSearch.trim().toLowerCase()
    return events.filter((e) => {
      if (resultFilter && e.result !== resultFilter) return false
      if (q) {
        const hay = [
          e.uid,
          e.employee ? `${e.employee.first_name} ${e.employee.last_name}` : '',
          e.reader?.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, eventSearch, resultFilter])

  return (
    <div>
      <PageHeader
        title="RFID Integration"
        description="Register readers, assign cards to employees, and process tap events for attendance."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSimPanel(true)}>
              Simulate tap
            </Button>
            <Button onClick={() => setReaderPanel(true)}>Register reader</Button>
          </div>
        }
      />

      {newToken && (
        <Card className="mb-6 border-amber-700/50 bg-amber-950/30">
          <p className="text-sm font-medium text-amber-200">Reader API token — shown once</p>
          <code className="mt-2 block break-all rounded bg-slate-950 px-3 py-2 text-xs text-slate-200">
            {newToken}
          </code>
          <p className="mt-2 text-xs text-slate-400">
            Configure the reader to POST to <code>/api/v1/rfid/tap</code> with{' '}
            <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setNewToken(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Readers" value={readers.length} />
        <StatCard label="Online" value={onlineCount} tone={onlineCount ? 'ok' : undefined} />
        <StatCard
          label="Offline"
          value={readers.length - onlineCount}
          tone={readers.length - onlineCount ? 'warn' : undefined}
        />
        <StatCard label="Taps today" value={tapsToday} />
      </div>

      <Tabs
        tabs={[
          { id: 'readers', label: 'Readers' },
          { id: 'cards', label: 'Cards' },
          { id: 'events', label: 'Tap events' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'readers' && (
        <DataTable
          data={readers}
          rowKey={(r) => r.id}
          pageSize={10}
          loading={readersLoading}
          empty="No RFID readers registered yet"
          columns={[
            {
              key: 'name',
              header: 'Reader',
              cell: (r) => (
                <div>
                  <div className="font-medium text-slate-100">{r.name}</div>
                  <div className="font-mono text-xs text-slate-500">{r.device_id}</div>
                </div>
              ),
            },
            { key: 'location', header: 'Location', cell: (r) => r.location?.name ?? '—' },
            {
              key: 'direction',
              header: 'Direction',
              cell: (r) => <Badge tone="neutral">{DIRECTION_LABEL[r.direction]}</Badge>,
            },
            {
              key: 'online',
              header: 'Status',
              cell: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      r.online ? 'bg-emerald-400' : 'bg-slate-500'
                    )}
                  />
                  <span className={r.online ? 'text-emerald-400' : 'text-slate-400'}>
                    {r.online ? 'Online' : 'Offline'}
                  </span>
                </span>
              ),
            },
            { key: 'taps', header: 'Taps today', cell: (r) => r.taps_today ?? 0 },
            {
              key: 'seen',
              header: 'Last seen',
              className: 'text-xs text-slate-400',
              cell: (r) => relativeTime(r.last_heartbeat_at),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (r) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => regenerateToken(r.id)}>
                    New token
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
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
      )}

      {tab === 'cards' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-slate-200">Assign RFID card</h2>
            <form className="grid gap-4" onSubmit={assignCard}>
              <Label>
                Employee
                <Combobox value={selectedEmployeeId} onChange={setSelectedEmployeeId}>
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
              <Button
                type="submit"
                isLoading={assignCardMutation.isPending}
                disabled={!selectedEmployeeId}
              >
                Assign card
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-semibold text-slate-200">
              {selectedEmployeeId ? 'Assigned cards' : 'Assigned cards'}
            </h2>
            {!selectedEmployeeId ? (
              <p className="text-sm text-slate-500">Select an employee to view their cards.</p>
            ) : employeeCards.length === 0 ? (
              <p className="text-sm text-slate-500">No cards assigned to this employee.</p>
            ) : (
              <ul className="space-y-2">
                {employeeCards.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <code className="text-sm text-slate-200">{c.uid}</code>
                      {c.label && <span className="ml-2 text-xs text-slate-400">{c.label}</span>}
                      {!c.is_active && (
                        <Badge tone="warn" className="ml-2">
                          Revoked
                        </Badge>
                      )}
                    </div>
                    {c.is_active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => revokeCard(c.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'events' && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox
                className="w-64"
                placeholder="Search UID, employee, reader…"
                value={eventSearch}
                onChange={setEventSearch}
              />
              <Combobox
                className="w-44"
                value={resultFilter}
                onChange={setResultFilter}
                options={resultOptions}
              />
            </div>
            <span className="text-xs text-slate-500">
              {filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}
            </span>
          </div>

          <DataTable
            data={filteredEvents}
            rowKey={(e) => e.id}
            pageSize={10}
            loading={eventsLoading}
            empty="No tap events match these filters"
            columns={[
              {
                key: 'time',
                header: 'Time',
                cell: (e) => {
                  const d = new Date(e.tapped_at)
                  return (
                    <div>
                      <div className="text-slate-200">{d.toLocaleDateString()}</div>
                      <div className="text-xs text-slate-500">
                        {d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  )
                },
              },
              {
                key: 'uid',
                header: 'Card UID',
                className: 'font-mono text-xs text-slate-300',
                cell: (e) => e.uid,
              },
              {
                key: 'employee',
                header: 'Employee',
                cell: (e) =>
                  e.employee ? `${e.employee.first_name} ${e.employee.last_name}` : '—',
              },
              { key: 'reader', header: 'Reader', cell: (e) => e.reader?.name ?? '—' },
              {
                key: 'action',
                header: 'Action',
                className: 'capitalize text-slate-400',
                cell: (e) => e.metadata?.attendance_action?.replace(/_/g, ' ') ?? '—',
              },
              {
                key: 'result',
                header: 'Result',
                cell: (e) => <Badge tone={resultTone(e.result)}>{e.result}</Badge>,
              },
            ]}
          />
        </>
      )}

      {readerPanel && (
        <SidePanel
          title="Register RFID reader"
          description="Add a physical reader and issue its API token"
          onClose={() => setReaderPanel(false)}
          footer={
            <>
              <Button type="submit" form="reader-form" isLoading={createReader.isPending}>
                Register reader
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReaderPanel(false)}>
                Cancel
              </Button>
            </>
          }
        >
          <form id="reader-form" className="grid gap-4" onSubmit={saveReader}>
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
          </form>
        </SidePanel>
      )}

      {simPanel && (
        <SidePanel
          title="Simulate tap"
          description="Send a test tap to verify reader and card mapping"
          onClose={() => {
            setSimPanel(false)
            setTapResult(null)
          }}
          footer={
            <>
              <Button type="submit" form="sim-form" isLoading={simulate.isPending}>
                Simulate tap
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSimPanel(false)
                  setTapResult(null)
                }}
              >
                Close
              </Button>
            </>
          }
        >
          <form id="sim-form" className="grid gap-4" onSubmit={simulateTap}>
            <Label>
              Reader
              <Combobox value={simulateReaderId} onChange={setSimulateReaderId} required>
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
          </form>

          {tapResult && (
            <div
              className={cn(
                'mt-5 rounded-lg border p-4 text-sm',
                tapResult.matched
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/30 bg-red-500/10 text-red-200'
              )}
            >
              {tapResult.matched ? (
                <>
                  <p className="font-medium">
                    Matched {tapResult.employee?.first_name} {tapResult.employee?.last_name}
                  </p>
                  <p className="mt-1 text-xs opacity-80">
                    Action: {tapResult.attendance_action?.replace(/_/g, ' ') ?? 'none'}
                  </p>
                </>
              ) : (
                <p className="font-medium">Not matched — {tapResult.reason ?? 'unknown'}</p>
              )}
            </div>
          )}
        </SidePanel>
      )}
    </div>
  )
}
