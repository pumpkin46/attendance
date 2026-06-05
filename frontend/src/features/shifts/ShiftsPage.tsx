import { PageHeader } from '@/shared/ui/PageHeader'
import { TableBody, TableHead, TableShell, Td, Th } from '@/shared/ui/DataTable'
import type { Shift } from '@/shared/types'
import { useAttendanceConfig, useShifts } from '@/features/shifts/api/queries'
import { SHIFT_TYPE_FALLBACK } from '@/features/shifts/types'

export default function ShiftsPage() {
  const { data: shiftsData, isPending, isError } = useShifts()
  const { data: config } = useAttendanceConfig()

  const shifts = shiftsData ?? []
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
          {isPending ? (
            <tr>
              <Td colSpan={5} className="text-slate-400">
                Loading…
              </Td>
            </tr>
          ) : isError ? (
            <tr>
              <Td colSpan={5} className="text-red-400">
                Failed to load shifts.
              </Td>
            </tr>
          ) : (
            shifts.map((s) => (
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
            ))
          )}
        </TableBody>
      </TableShell>
    </div>
  )
}
