import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { SnapshotImage } from '../components/SnapshotImage'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import type { Paginated, RecognitionEvent } from '../types'

export default function UnknownFacesPage() {
  const [events, setEvents] = useState<RecognitionEvent[]>([])
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    api
      .get<Paginated<RecognitionEvent>>('/reports/unknown-persons', {
        params: { date_from: dateFrom, date_to: dateTo, per_page: 50 },
      })
      .then((r) => setEvents(r.data.data))
  }, [dateFrom, dateTo])

  return (
    <div>
      <PageHeader
        title="Unknown Faces"
        description="FR-011: Flagged unrecognized persons with saved snapshots and admin alerts"
        actions={
          <>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-slate-500">to</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </>
        }
      />

      <TableShell>
        <TableHead>
          <Th>Snapshot</Th>
          <Th>Time</Th>
          <Th>Camera</Th>
          <Th>Confidence</Th>
          <Th>Alert sent</Th>
          <Th>Source</Th>
        </TableHead>
        <TableBody>
          {events.length === 0 ? (
            <tr>
              <Td colSpan={6} className="text-slate-400">
                No unknown face events in this period
              </Td>
            </tr>
          ) : (
            events.map((e) => (
              <tr key={e.id}>
                <Td>
                  {e.snapshot_path ? (
                    <SnapshotImage
                      eventId={e.id}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </Td>
                <Td>{new Date(e.recognized_at).toLocaleString()}</Td>
                <Td>{e.camera?.name ?? '—'}</Td>
                <Td>
                  {e.confidence != null ? `${(Number(e.confidence) * 100).toFixed(1)}%` : '—'}
                </Td>
                <Td>
                  <Badge tone={e.notified_at ? 'ok' : 'neutral'}>
                    {e.notified_at ? 'Yes' : 'No'}
                  </Badge>
                </Td>
                <Td>{e.metadata?.source ?? '—'}</Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
