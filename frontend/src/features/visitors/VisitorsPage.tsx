import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Tabs, type TabItem } from '@/shared/ui/Tabs'
import { VisitorDetailPanel } from '@/features/visitors/components/VisitorDetailPanel'
import { AllVisitorsTab } from '@/features/visitors/components/AllVisitorsTab'
import { ApprovalsTab } from '@/features/visitors/components/ApprovalsTab'
import { BlacklistTab } from '@/features/visitors/components/BlacklistTab'
import { OnSiteTab } from '@/features/visitors/components/OnSiteTab'
import { useInvalidateVisitors, useVisitorStats } from '@/features/visitors/api/queries'
import { VisitorDashboardTab } from '@/features/visitors/components/VisitorDashboardTab'
import { VisitorRegisterPanel } from '@/features/visitors/components/VisitorRegisterPanel'
import type { VisitorTab } from '@/features/visitors/types'

export default function VisitorsPage() {
  const [tab, setTab] = useState<VisitorTab>('dashboard')
  const [detailVisitorId, setDetailVisitorId] = useState<number | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const invalidate = useInvalidateVisitors()
  const { data: stats } = useVisitorStats()

  const withCount = (label: string, n?: number) => (n && n > 0 ? `${label} · ${n}` : label)
  const TABS: TabItem<VisitorTab>[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'approvals', label: withCount('Approvals', stats?.pending_approval) },
    { id: 'visitors', label: 'All visitors' },
    { id: 'active', label: withCount('On site', stats?.on_site) },
    { id: 'blacklist', label: 'Blacklist' },
  ]

  return (
    <div>
      <PageHeader
        title="Visitor Management"
        description="Register, verify, track, and manage visitors with face recognition and badge access."
        actions={<Button onClick={() => setShowRegister(true)}>+ Register visitor</Button>}
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'dashboard' && <VisitorDashboardTab />}
        {tab === 'approvals' && <ApprovalsTab onSelect={setDetailVisitorId} />}
        {tab === 'visitors' && <AllVisitorsTab onSelect={setDetailVisitorId} />}
        {tab === 'active' && <OnSiteTab />}
        {tab === 'blacklist' && <BlacklistTab />}
      </div>

      {showRegister && (
        <VisitorRegisterPanel
          onClose={() => setShowRegister(false)}
          onRegistered={() => {
            setShowRegister(false)
            setTab('visitors')
          }}
        />
      )}

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
