import { useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { clearOrg, selectOrgId, setOrg } from '@/features/tenant/tenantSlice'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Card } from '@/shared/ui/Card'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Input'
import { Button } from '@/shared/ui/Button'
import { Label } from '@/shared/ui/Label'
import {
  useBranches,
  useCreateOrganization,
  useDepartments,
  useOrganizations,
  useSecurityConfig,
} from '@/features/security/api/queries'

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

  return (
    <div>
      <PageHeader
        title="Security & Multi-Tenancy"
        description="Authentication methods, RBAC roles, encryption posture, and tenant isolation (§16–§17)."
      />

      {isSuperAdmin() && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-200">Super Admin — tenant context</h2>
          <p className="mb-3 text-xs text-slate-400">
            Set <code className="text-slate-300">X-Organization-Id</code> for scoped API calls across
            organizations.
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
              Apply & reload
            </Button>
          </div>
        </Card>
      )}

      {security && (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Authentication</h2>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>JWT (Sanctum Bearer): {security.authentication?.jwt?.enabled ? 'enabled' : 'off'}</li>
              <li>
                OAuth2: {security.authentication?.oauth2?.enabled ? 'enabled' : 'off'} (
                {(security.authentication?.oauth2?.providers ?? []).join(', ')})
              </li>
              <li>SAML: {security.authentication?.saml?.enabled ? 'enabled' : 'off'}</li>
              <li>LDAP / AD: {security.authentication?.ldap?.enabled ? 'enabled' : 'off'}</li>
            </ul>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Encryption & secrets</h2>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>In transit: TLS {security.encryption?.in_transit?.protocol ?? '—'}</li>
              <li>At rest: {security.encryption?.at_rest?.cipher ?? '—'}</li>
              <li>
                Secrets driver: {security.encryption?.secrets?.driver ?? '—'}
                {security.encryption?.secrets?.vault_configured && ' · Vault'}
                {security.encryption?.secrets?.kms_configured && ' · KMS'}
              </li>
              <li>
                Tenant isolation:{' '}
                {security.tenancy?.isolation_enabled ? 'mandatory' : 'disabled'}
              </li>
            </ul>
          </Card>
          <Card className="md:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">RBAC roles</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(security.authorization?.roles ?? {}).map(([key, label]) => (
                <span key={key} className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                  {label}
                </span>
              ))}
            </div>
          </Card>
        </div>
      )}

      {isSuperAdmin() && (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold">Create organization</h2>
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Name"
              value={newOrg.name}
              onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
            />
            <Input
              placeholder="Code"
              value={newOrg.code}
              onChange={(e) => setNewOrg({ ...newOrg, code: e.target.value })}
            />
            <Button
              type="button"
              onClick={handleCreateOrganization}
              disabled={!newOrg.name || !newOrg.code || createOrganization.isPending}
            >
              Create
            </Button>
          </div>
        </Card>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Organizations</h2>
      <DataTable
        className="mb-8"
        data={organizations ?? []}
        rowKey={(o) => o.id}
        columns={[
          { key: 'name', header: 'Name', cell: (o) => o.name },
          { key: 'code', header: 'Code', cell: (o) => o.code },
          { key: 'branches', header: 'Branches', cell: (o) => o.branches_count ?? '—' },
          { key: 'departments', header: 'Departments', cell: (o) => o.departments_count ?? '—' },
          { key: 'employees', header: 'Employees', cell: (o) => o.employees_count ?? '—' },
        ]}
      />

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Branches</h2>
      <DataTable
        className="mb-8"
        data={branches ?? []}
        rowKey={(b) => b.id}
        columns={[
          { key: 'name', header: 'Name', cell: (b) => b.name },
          { key: 'code', header: 'Code', cell: (b) => b.code },
          { key: 'org', header: 'Org ID', cell: (b) => b.organization_id },
        ]}
      />

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Departments</h2>
      <DataTable
        data={departments ?? []}
        rowKey={(d) => d.id}
        columns={[
          { key: 'name', header: 'Name', cell: (d) => d.name },
          { key: 'code', header: 'Code', cell: (d) => d.code },
          { key: 'branch', header: 'Branch', cell: (d) => d.branch?.name ?? '—' },
        ]}
      />
    </div>
  )
}
