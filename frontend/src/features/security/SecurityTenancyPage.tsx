import { useState, type ReactNode } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { clearOrg, selectOrgId, setOrg } from '@/features/tenant/tenantSlice'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Card } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Combobox } from '@/shared/ui/Combobox'
import { cn } from '@/shared/lib/cn'
import { TenancyDirectory } from '@/features/security/components/TenancyDirectory'
import {
  useBranches,
  useDepartments,
  useLocations,
  useOrganizations,
  useSecurityConfig,
} from '@/features/security/api/queries'

// ── Icons ────────────────────────────────────────────────────────────────────

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
const ShieldIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

// ── Building blocks ──────────────────────────────────────────────────────────

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
    <div className="flex items-center justify-between gap-4 border-b border-slate-800 py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      {value !== undefined ? (
        <span className="text-sm font-medium text-slate-200">{value}</span>
      ) : (
        <OnOffPill on={!!on} />
      )}
    </div>
  )
}

function PostureCard({
  icon,
  iconTone,
  title,
  badge,
  children,
}: {
  icon: ReactNode
  iconTone: string
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', iconTone)}>
          {icon}
        </span>
        <h2 className="flex-1 text-base font-semibold text-slate-100">{title}</h2>
        {badge}
      </div>
      {children}
    </Card>
  )
}

function StatTile({
  label,
  value,
  dot,
  accent,
}: {
  label: string
  value: number
  dot: string
  accent: string
}) {
  return (
    <div className={cn('rounded-xl border border-slate-700 border-l-4 bg-slate-900 p-4', accent)}>
      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        {label}
      </span>
      <span className="mt-2 block text-3xl font-semibold text-slate-100">{value}</span>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SecurityTenancyPage() {
  const { isSuperAdmin, hasPermission } = useAuth()
  const dispatch = useAppDispatch()
  const currentOrgId = useAppSelector(selectOrgId)
  const { data: security } = useSecurityConfig(hasPermission('security.view'))
  const { data: organizations } = useOrganizations()
  const { data: branches } = useBranches()
  const { data: departments } = useDepartments()
  const { data: locations } = useLocations()

  const [tenantOrgId, setTenantOrgId] = useState(() => currentOrgId ?? '')

  const orgs = organizations ?? []
  const employeesTotal = orgs.reduce((total, o) => total + (o.employees_count ?? 0), 0)
  const contextOrgName = currentOrgId
    ? orgs.find((o) => String(o.id) === currentOrgId)?.name ?? `Organization #${currentOrgId}`
    : null

  const applyTenantContext = () => {
    if (tenantOrgId) {
      dispatch(setOrg(tenantOrgId))
    } else {
      dispatch(clearOrg())
    }
    // Reload so all cached queries refetch under the new tenant scope.
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & Multi-Tenancy"
        description="Security posture, role-based access, and the organization directory."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Organizations" value={orgs.length} dot="bg-blue-400" accent="border-l-blue-500" />
        <StatTile label="Branches" value={(branches ?? []).length} dot="bg-violet-400" accent="border-l-violet-500" />
        <StatTile label="Departments" value={(departments ?? []).length} dot="bg-cyan-400" accent="border-l-cyan-500" />
        <StatTile label="Locations" value={(locations ?? []).length} dot="bg-amber-400" accent="border-l-amber-500" />
        <StatTile label="Employees" value={employeesTotal} dot="bg-emerald-400" accent="border-l-emerald-500" />
      </div>

      {isSuperAdmin() && (
        <Card className="border-blue-800/40 bg-blue-500/[0.03]">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[16rem] flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
                  Super Admin
                </span>
                <h2 className="text-sm font-semibold text-slate-200">Tenant context</h2>
                {contextOrgName ? (
                  <Badge tone="warn">Scoped to {contextOrgName}</Badge>
                ) : (
                  <Badge tone="neutral">All organizations</Badge>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Act inside a single organization — every API call carries{' '}
                <code className="rounded bg-slate-800 px-1 text-slate-300">X-Organization-Id</code>{' '}
                until the context is cleared.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Combobox
                value={tenantOrgId}
                onChange={setTenantOrgId}
                className="w-64"
                aria-label="Tenant context organization"
                options={[
                  { value: '', label: 'All organizations (no scope)' },
                  ...orgs.map((o) => ({ value: String(o.id), label: o.name })),
                ]}
              />
              <Button
                type="button"
                onClick={applyTenantContext}
                disabled={tenantOrgId === (currentOrgId ?? '')}
              >
                Apply &amp; reload
              </Button>
            </div>
          </div>
        </Card>
      )}

      {security && (
        <div className="grid gap-4 md:grid-cols-2">
          <PostureCard
            icon={KeyIcon}
            iconTone="bg-blue-500/15 text-blue-400"
            title="Authentication"
          >
            <div className="-mt-1">
              <ConfigRow label="JWT (Bearer tokens)" on={security.authentication?.jwt?.enabled} />
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
          </PostureCard>

          <PostureCard
            icon={LockIcon}
            iconTone="bg-emerald-500/15 text-emerald-400"
            title="Encryption & secrets"
          >
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
                label="Forced HTTPS"
                on={!!security.encryption?.in_transit?.force_https}
              />
            </div>
          </PostureCard>

          <PostureCard
            icon={UsersIcon}
            iconTone="bg-violet-500/15 text-violet-400"
            title="Access control"
            badge={<Badge tone="ok">{(security.authorization?.model ?? 'rbac').toUpperCase()}</Badge>}
          >
            <p className="mb-3 text-xs text-slate-500">
              Every route and API endpoint is gated by per-role permissions.
            </p>
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
          </PostureCard>

          <PostureCard
            icon={ShieldIcon}
            iconTone="bg-cyan-500/15 text-cyan-400"
            title="Tenant isolation"
            badge={
              <OnOffPill
                on={!!security.tenancy?.isolation_enabled}
                onText="Mandatory"
                offText="Disabled"
              />
            }
          >
            <p className="mb-1 text-xs text-slate-500">
              All tenant data is partitioned by organization; queries are scoped server-side.
            </p>
            <div className="-mt-1">
              <ConfigRow label="Unlimited organizations" on={!!security.tenancy?.supports?.unlimited_organizations} />
              <ConfigRow label="Unlimited branches" on={!!security.tenancy?.supports?.unlimited_branches} />
              <ConfigRow label="Unlimited departments" on={!!security.tenancy?.supports?.unlimited_departments} />
            </div>
          </PostureCard>
        </div>
      )}

      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Organization directory</h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Manage your organization&apos;s name, branches, departments, and locations.
          </p>
        </div>
        <TenancyDirectory />
      </div>
    </div>
  )
}
