import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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

const TAB_IDS: VisitorTab[] = ['dashboard', 'approvals', 'visitors', 'active', 'blacklist']

export default function VisitorsPage() {
  // The active tab lives in the URL so the dashboard can deep-link to it
  // (e.g. /visitors?tab=active) and tabs stay shareable.
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab') as VisitorTab | null
  const tab: VisitorTab = rawTab && TAB_IDS.includes(rawTab) ? rawTab : 'dashboard'
  const setTab = (t: VisitorTab) =>
    setSearchParams(t === 'dashboard' ? {} : { tab: t }, { replace: true })
  const [detailVisitorId, setDetailVisitorId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const invalidate = useInvalidateVisitors()
  const { data: stats } = useVisitorStats()

  const openDetail = (id: number) => {
    setDetailVisitorId(id)
    setDetailOpen(true)
  }

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
        {tab === 'approvals' && <ApprovalsTab onSelect={openDetail} />}
        {tab === 'visitors' && <AllVisitorsTab onSelect={openDetail} />}
        {tab === 'active' && <OnSiteTab />}
        {tab === 'blacklist' && <BlacklistTab />}
      </div>

      <VisitorRegisterPanel
        open={showRegister}
        onClose={() => setShowRegister(false)}
        onRegistered={() => {
          setShowRegister(false)
          setTab('visitors')
        }}
      />

      {detailVisitorId !== null && (
        <VisitorDetailPanel
          key={detailVisitorId}
          open={detailOpen}
          visitorId={detailVisitorId}
          onClose={() => setDetailOpen(false)}
          onUpdated={invalidate}
        />
      )}
    </div>
  )
}
