import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { VisitorDetailPanel } from '../components/VisitorDetailPanel'
import { AllVisitorsTab } from './visitors/AllVisitorsTab'
import { ApprovalsTab } from './visitors/ApprovalsTab'
import { BlacklistTab } from './visitors/BlacklistTab'
import { OnSiteTab } from './visitors/OnSiteTab'
import { useInvalidateVisitors } from './visitors/queries'
import { VisitorDashboardTab } from './visitors/VisitorDashboardTab'
import { VisitorRegisterTab } from './visitors/VisitorRegisterTab'
import type { VisitorTab } from './visitors/types'

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
