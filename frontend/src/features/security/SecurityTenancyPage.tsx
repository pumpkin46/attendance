import { useState, type ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { clearOrg, selectOrgId, setOrg } from '@/features/tenant/tenantSlice'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Card } from '@/shared/ui/Card'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Input'
import { Button } from '@/shared/ui/Button'
import { Label } from '@/shared/ui/Label'
import { cn } from '@/shared/lib/cn'
import {
  useBranches,
  useCreateOrganization,
  useDepartments,
  useOrganizations,
  useSecurityConfig,
} from '@/features/security/api/queries'

const LockIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const KeyIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.5 12.5 8-8M16 5l3 3M14 7l2 2" />
  </svg>
)
const UsersIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M16 5a3.5 3.5 0 0 1 0 7M21 20c0-3-1.8-4.6-4-4.9" />
  </svg>
)

function OnOffPill({ on, onText = 'Enabled', offText = 'Off' }: { on: boolean; onText?: string; offText?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        on ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-emerald-400' : 'bg-slate-500')} />
      {on ? onText : offText}
    </span>
  )
}

function ConfigRow({ label, on, value }: { label: string; on?: boolean; value?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      {value !== undefined ? (
        <span className="text-sm font-medium text-slate-200">{value}</span>
      ) : (
        <OnOffPill on={!!on} />
      )}
    </div>
  )
}

function SectionCard({
  icon,
  title,
  children,
  className,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <div className="mb-3 flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-blue-400">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      </div>
      {children}
    </Card>
  )
}

function TableSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <Card padding={false} className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-400">
          {count}
        </span>
      </div>
      {children}
    </Card>
  )
}

export default function SecurityTenancyPage() {
  const { isSuperAdmin, hasPermission } = useAuth()
  const dispatch = useAppDispatch()
  const currentOrgId = useAppSelector(selectOrgId)
  const { data: security } = useSecurityConfig(hasPermission('security.view'))
  const { data: organizations } = useOrganizations()
  const { data: branches } = useBranches()
  const { data: departments } = useDepartments()
  const createOrganization = useCreateOrganization()

  const [tenantOrgId, setTenantOrgId] = useState(() => currentOrgId ?? '')
  const [newOrg, setNewOrg] = useState({ name: '', code: '', timezone: 'UTC' })

  const applyTenantHeader = () => {
    if (tenantOrgId) {
      dispatch(setOrg(tenantOrgId))
    } else {
      dispatch(clearOrg())
    }
    // Reload so all cached queries refetch under the new tenant scope.
    window.location.reload()
  }

  const handleCreateOrganization = () => {
    createOrganization.mutate(newOrg, {
      onSuccess: () => setNewOrg({ name: '', code: '', timezone: 'UTC' }),
    })
  }

  const orgs = organizations ?? []
  const branchList = branches ?? []
  const deptList = departments ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & Multi-Tenancy"
        description="Authentication methods, RBAC roles, encryption posture, and tenant isolation (§16–§17)."
      />

      {isSuperAdmin() && (
        <Card className="border-blue-800/40 bg-blue-500/[0.03]">
          <div className="mb-3 flex items-center gap-2">
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
              Super Admin
            </span>
            <h2 className="text-sm font-semibold text-slate-200">Tenant context</h2>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            Set <code className="rounded bg-slate-800 px-1 text-slate-300">X-Organization-Id</code> for
            scoped API calls across organizations.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Label className="flex-1 min-w-[200px]">
              Organization ID
              <Input
                value={tenantOrgId}
                onChange={(e) => setTenantOrgId(e.target.value)}
                placeholder="e.g. 1"
              />
            </Label>
            <Button type="button" onClick={applyTenantHeader}>
              Apply &amp; reload
            </Button>
          </div>
        </Card>
      )}

      {security && (
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard icon={KeyIcon} title="Authentication">
            <div className="-mt-1">
              <ConfigRow label="JWT (Sanctum Bearer)" on={security.authentication?.jwt?.enabled} />
              <ConfigRow
                label={`OAuth2${
                  security.authentication?.oauth2?.providers?.length
                    ? ` · ${security.authentication.oauth2.providers.join(', ')}`
                    : ''
                }`}
                on={security.authentication?.oauth2?.enabled}
              />
              <ConfigRow label="SAML" on={security.authentication?.saml?.enabled} />
              <ConfigRow label="LDAP / Active Directory" on={security.authentication?.ldap?.enabled} />
            </div>
          </SectionCard>

          <SectionCard icon={LockIcon} title="Encryption & secrets">
            <div className="-mt-1">
              <ConfigRow label="In transit" value={`TLS ${security.encryption?.in_transit?.protocol ?? '—'}`} />
              <ConfigRow label="At rest" value={security.encryption?.at_rest?.cipher ?? '—'} />
              <ConfigRow
                label="Secrets driver"
                value={
                  <span className="flex items-center gap-1.5">
                    {security.encryption?.secrets?.driver ?? '—'}
                    {security.encryption?.secrets?.vault_configured && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">Vault</span>
                    )}
                    {security.encryption?.secrets?.kms_configured && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">KMS</span>
                    )}
                  </span>
                }
              />
              <ConfigRow
                label="Tenant isolation"
                value={
                  <OnOffPill
                    on={!!security.tenancy?.isolation_enabled}
                    onText="Mandatory"
                    offText="Disabled"
                  />
                }
              />
            </div>
          </SectionCard>

          <SectionCard icon={UsersIcon} title="RBAC roles" className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              {Object.entries(security.authorization?.roles ?? {}).map(([key, label]) => (
                <span
                  key={key}
                  className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300"
                >
                  {label}
                </span>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {isSuperAdmin() && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Create organization</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Label className="min-w-[180px] flex-1">
              Name
              <Input
                placeholder="Acme Corp"
                value={newOrg.name}
                onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
              />
            </Label>
            <Label className="min-w-[140px]">
              Code
              <Input
                placeholder="ACME"
                value={newOrg.code}
                onChange={(e) => setNewOrg({ ...newOrg, code: e.target.value })}
              />
            </Label>
            <Button
              type="button"
              onClick={handleCreateOrganization}
              disabled={!newOrg.name || !newOrg.code}
              isLoading={createOrganization.isPending}
            >
              Create
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-6">
        <TableSection title="Organizations" count={orgs.length}>
          <DataTable
            data={orgs}
            rowKey={(o) => o.id}
            empty="No organizations"
            columns={[
              { key: 'name', header: 'Name', cell: (o) => <span className="font-medium text-slate-100">{o.name}</span> },
              { key: 'code', header: 'Code', className: 'font-mono text-xs', cell: (o) => o.code },
              { key: 'branches', header: 'Branches', cell: (o) => o.branches_count ?? '—' },
              { key: 'departments', header: 'Departments', cell: (o) => o.departments_count ?? '—' },
              { key: 'employees', header: 'Employees', cell: (o) => o.employees_count ?? '—' },
            ]}
          />
        </TableSection>

        <TableSection title="Branches" count={branchList.length}>
          <DataTable
            data={branchList}
            rowKey={(b) => b.id}
            empty="No branches"
            columns={[
              { key: 'name', header: 'Name', cell: (b) => <span className="font-medium text-slate-100">{b.name}</span> },
              { key: 'code', header: 'Code', className: 'font-mono text-xs', cell: (b) => b.code },
              { key: 'org', header: 'Org ID', cell: (b) => b.organization_id },
            ]}
          />
        </TableSection>

        <TableSection title="Departments" count={deptList.length}>
          <DataTable
            data={deptList}
            rowKey={(d) => d.id}
            empty="No departments"
            columns={[
              { key: 'name', header: 'Name', cell: (d) => <span className="font-medium text-slate-100">{d.name}</span> },
              { key: 'code', header: 'Code', className: 'font-mono text-xs', cell: (d) => d.code },
              { key: 'branch', header: 'Branch', cell: (d) => d.branch?.name ?? '—' },
            ]}
          />
        </TableSection>
      </div>
    </div>
  )
}
