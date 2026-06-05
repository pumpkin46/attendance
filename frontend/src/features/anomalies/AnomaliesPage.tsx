import { useState } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Select } from '@/shared/ui/Input'
import { PageHeader } from '@/shared/ui/PageHeader'
import { StatCard } from '@/shared/ui/StatCard'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import {
  useAnomalies,
  useAnomalySummary,
  useRunDetection,
  useUpdateAnomalyStatus,
} from '@/features/anomalies/api/queries'
import { SEVERITY_TONE, TYPE_LABELS, type AnomalyDecision } from '@/features/anomalies/types'

export default function AnomaliesPage() {
  const [statusFilter, setStatusFilter] = useState('open')
  const [severityFilter, setSeverityFilter] = useState('')
  const [detectResult, setDetectResult] = useState<string | null>(null)

  const { data: summary } = useAnomalySummary()
  const { data: list, isPending: loading } = useAnomalies(statusFilter, severityFilter)
  const anomalies = list?.data ?? []

  const detection = useRunDetection()
  const statusMutation = useUpdateAnomalyStatus()

  const detecting = detection.isPending
  const runDetection = () => {
    setDetectResult(null)
    detection.mutate(undefined, {
      onSuccess: (data) =>
        setDetectResult(
          `Analyzed ${data.records_analyzed} records — ${data.anomalies_found} anomalies found (${data.processing_ms}ms)`
        ),
    })
  }
  const updateStatus = (id: number, status: AnomalyDecision) =>
    statusMutation.mutate({ id, status })

  return (
    <div>
      <PageHeader
        title="Attendance Anomalies"
        description="AI-powered detection of unusual patterns — rules plus Isolation Forest ML"
        actions={
          <Button onClick={runDetection} disabled={detecting}>
            {detecting ? 'Analyzing…' : 'Run detection'}
          </Button>
        }
      />

      {detectResult && (
        <Card className="mb-6">
          <p className="text-sm text-slate-300">{detectResult}</p>
        </Card>
      )}

      {summary && (
        <div className="mb-6 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          <StatCard label="Open" value={summary.open_total} tone="warn" />
          <StatCard label="Critical" value={summary.critical} tone="danger" />
          <StatCard label="High" value={summary.high} tone="danger" />
          <StatCard label="Medium" value={summary.medium} tone="warn" />
          <StatCard label="Low" value={summary.low} />
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap gap-4">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-w-40"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False positive</option>
          </Select>
          <Select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="min-w-40"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>
      </Card>

      <TableShell>
        <TableHead>
          <Th>Detected</Th>
          <Th>Employee</Th>
          <Th>Type</Th>
          <Th>Severity</Th>
          <Th>Score</Th>
          <Th>Description</Th>
          <Th>Status</Th>
          <Th>Actions</Th>
        </TableHead>
        <TableBody>
          {loading ? (
            <tr>
              <Td colSpan={8} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : anomalies.length === 0 ? (
            <tr>
              <Td colSpan={8} className="text-slate-400">
                No anomalies found — run detection to scan recent attendance
              </Td>
            </tr>
          ) : (
            anomalies.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-xs">
                  {new Date(a.detected_at).toLocaleString()}
                </Td>
                <Td>
                  {a.employee
                    ? `${a.employee.first_name} ${a.employee.last_name}`
                    : `#${a.employee_id}`}
                </Td>
                <Td>{TYPE_LABELS[a.anomaly_type] ?? a.anomaly_type}</Td>
                <Td>
                  <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{a.severity}</Badge>
                </Td>
                <Td>{(a.score * 100).toFixed(0)}%</Td>
                <Td className="max-w-xs text-xs text-slate-400">{a.description}</Td>
                <Td>
                  <Badge tone={a.status === 'open' ? 'warn' : 'ok'}>{a.status}</Badge>
                </Td>
                <Td>
                  <div className="flex gap-1">
                    {a.status === 'open' && (
                      <Button variant="ghost" onClick={() => updateStatus(a.id, 'acknowledged')}>
                        Ack
                      </Button>
                    )}
                    {a.status !== 'resolved' && a.status !== 'false_positive' && (
                      <>
                        <Button variant="ghost" onClick={() => updateStatus(a.id, 'resolved')}>
                          Resolve
                        </Button>
                        <Button variant="ghost" onClick={() => updateStatus(a.id, 'false_positive')}>
                          Dismiss
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
