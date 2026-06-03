import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { PageHeader } from '../components/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'

interface Shift {
  id: number
  name: string
  type: string
  rotation_slot?: string
  start_time: string
  end_time: string
  segments?: { start: string; end: string }[]
  grace_minutes: number
  is_active: boolean
}

interface AttendanceConfig {
  shift_types?: Record<string, { label: string; example?: string; description?: string; slots?: string[] }>
}

const SHIFT_TYPE_FALLBACK: NonNullable<AttendanceConfig['shift_types']> = {
  fixed: { label: 'Fixed Shift', example: '09:00–18:00' },
  rotational: { label: 'Rotational Shift', slots: ['morning', 'evening', 'night'] },
  flexible: { label: 'Flexible Shift', description: 'Employee defines start time' },
  split: { label: 'Split Shift', example: '08:00–12:00, 14:00–18:00' },
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [config, setConfig] = useState<AttendanceConfig | null>(null)

  useEffect(() => {
    api.get<Shift[]>('/shifts').then((r) => setShifts(r.data))
    api.get<AttendanceConfig>('/attendance/config').then((r) => setConfig(r.data))
  }, [])

  const shiftTypes = config?.shift_types ?? SHIFT_TYPE_FALLBACK

  const formatSchedule = (s: Shift) => {
    if (s.type === 'split' && s.segments?.length) {
      return s.segments.map((seg) => `${seg.start}–${seg.end}`).join(', ')
    }
    return `${s.start_time}–${s.end_time}`
  }

  return (
    <div>
      <PageHeader
        title="Shift Management"
        description="Fixed, rotational, flexible, and split shift schedules with policy-linked grace and work-hour rules."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {Object.entries(shiftTypes).map(([key, meta]) => (
          <span
            key={key}
            className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300"
            title={meta.example ?? meta.description}
          >
            {meta.label}
          </span>
        ))}
      </div>

      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Schedule</Th>
          <Th>Grace (min)</Th>
          <Th>Status</Th>
        </TableHead>
        <TableBody>
          {shifts.map((s) => (
            <tr key={s.id}>
              <Td>{s.name}</Td>
              <Td className="capitalize">
                {s.type.replace(/_/g, ' ')}
                {s.rotation_slot ? ` (${s.rotation_slot})` : ''}
              </Td>
              <Td>{formatSchedule(s)}</Td>
              <Td>{s.grace_minutes}</Td>
              <Td>{s.is_active ? 'Active' : 'Inactive'}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
