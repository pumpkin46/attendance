import { useState } from 'react'
import { getApiErrorMessage } from '../api/client'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { PageHeader } from '../components/ui/PageHeader'
import { SnapshotImage } from '../components/SnapshotImage'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import { useApiQuery } from '../hooks/useApiQuery'
import type { Paginated, RecognitionEvent } from '../types'

export default function UnknownFacesPage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))

  const { data, isPending, isError, error } = useApiQuery<Paginated<RecognitionEvent>>(
    ['unknown-faces', 'list', { dateFrom, dateTo }],
    '/reports/unknown-persons',
    { date_from: dateFrom, date_to: dateTo, per_page: 50 }
  )
  const events = data?.data ?? []

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
        {isPending ? (
          <TableBody>
            <tr>
              <Td colSpan={6} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          </TableBody>
        ) : isError ? (
          <TableBody>
            <tr>
              <Td colSpan={6} className="text-rose-400">
                {getApiErrorMessage(error, 'Failed to load unknown face events')}
              </Td>
            </tr>
          </TableBody>
        ) : (
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
        )}
      </TableShell>
    </div>
  )
}
