import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Tabs, type TabItem } from '@/shared/ui/Tabs'
import { VisitorDetailPanel } from '@/features/visitors/components/VisitorDetailPanel'
import { AllVisitorsTab } from '@/features/visitors/components/AllVisitorsTab'
import { ApprovalsTab } from '@/features/visitors/components/ApprovalsTab'
import { BlacklistTab } from '@/features/visitors/components/BlacklistTab'
import { OnSiteTab } from '@/features/visitors/components/OnSiteTab'
import { useInvalidateVisitors } from '@/features/visitors/api/queries'
import { VisitorDashboardTab } from '@/features/visitors/components/VisitorDashboardTab'
import { VisitorRegisterTab } from '@/features/visitors/components/VisitorRegisterTab'
import type { VisitorTab } from '@/features/visitors/types'

const TABS: TabItem<VisitorTab>[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'register', label: 'Register' },
  { id: 'visitors', label: 'All visitors' },
  { id: 'active', label: 'On site' },
  { id: 'blacklist', label: 'Blacklist' },
]

export default function VisitorsPage() {
  const [tab, setTab] = useState<VisitorTab>('dashboard')
  const [detailVisitorId, setDetailVisitorId] = useState<number | null>(null)
  const invalidate = useInvalidateVisitors()

  return (
    <div>
      <PageHeader
        title="Visitor Management"
        description="Register, verify, track, and manage visitors with face recognition and badge access."
        actions={
          tab !== 'register' && (
            <Button onClick={() => setTab('register')}>Register visitor</Button>
          )
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'dashboard' && <VisitorDashboardTab />}
        {tab === 'approvals' && <ApprovalsTab onSelect={setDetailVisitorId} />}
        {tab === 'register' && <VisitorRegisterTab onRegistered={() => setTab('visitors')} />}
        {tab === 'visitors' && <AllVisitorsTab onSelect={setDetailVisitorId} />}
        {tab === 'active' && <OnSiteTab />}
        {tab === 'blacklist' && <BlacklistTab />}
      </div>

      {detailVisitorId !== null && (
        <VisitorDetailPanel
          visitorId={detailVisitorId}
          onClose={() => setDetailVisitorId(null)}
          onUpdated={invalidate}
        />
      )}
    </div>
  )
}
