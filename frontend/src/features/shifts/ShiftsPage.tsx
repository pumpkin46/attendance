import { useState } from 'react'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Tabs, type TabItem } from '@/shared/ui/Tabs'
import { ShiftsTab } from '@/features/shifts/components/ShiftsTab'
import { PoliciesTab } from '@/features/shifts/components/PoliciesTab'
import { HolidaysTab } from '@/features/shifts/components/HolidaysTab'
import { LeaveTab } from '@/features/shifts/components/LeaveTab'

type TabId = 'shifts' | 'policies' | 'holidays' | 'leave'

const TABS: TabItem<TabId>[] = [
  { id: 'shifts', label: 'Shifts' },
  { id: 'policies', label: 'Attendance Policies' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'leave', label: 'Leave Requests' },
]

export default function ShiftsPage() {
  const [tab, setTab] = useState<TabId>('shifts')

  return (
    <div>
      <PageHeader
        title="Shift Management"
        description="Shift schedules, attendance policies, holidays, and leave approvals."
      />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'shifts' && <ShiftsTab />}
        {tab === 'policies' && <PoliciesTab />}
        {tab === 'holidays' && <HolidaysTab />}
        {tab === 'leave' && <LeaveTab />}
      </div>
    </div>
  )
}
