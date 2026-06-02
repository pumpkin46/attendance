import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { TableBody, TableHead, TableShell, Td, Th } from '../components/ui/DataTable'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Label } from '../components/ui/Label'

interface SecurityConfig {
  authentication: {
    jwt: { enabled: boolean; token_type: string }
    oauth2: { enabled: boolean; providers: string[] }
    saml: { enabled: boolean }
    ldap: { enabled: boolean }
  }
  authorization: { model: string; roles: Record<string, string> }
  encryption: {
    in_transit: { protocol: string; force_https: boolean }
    at_rest: { cipher: string }
    secrets: { driver: string; vault_configured: boolean; kms_configured: boolean }
  }
  tenancy: {
    isolation_enabled: boolean
    supports: Record<string, boolean>
  }
}

interface Organization {
  id: number
  name: string
  code: string
  branches_count?: number
  departments_count?: number
  employees_count?: number
}

interface Branch {
  id: number
  name: string
  code: string
  organization_id: number
}

interface Department {
  id: number
  name: string
  code: string
  branch?: { name: string }
}

export default function SecurityTenancyPage() {
  const { isSuperAdmin, hasPermission } = useAuth()
  const [security, setSecurity] = useState<SecurityConfig | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [tenantOrgId, setTenantOrgId] = useState(
    () => localStorage.getItem('tenant_organization_id') ?? ''
  )
  const [newOrg, setNewOrg] = useState({ name: '', code: '', timezone: 'UTC' })

  useEffect(() => {
    if (hasPermission('security.view')) {
      api.get<SecurityConfig>('/security/config').then((r) => setSecurity(r.data)).catch(() => {})
    }
    api.get<Organization[]>('/organizations').then((r) => setOrganizations(r.data))
    api.get<Branch[]>('/branches').then((r) => setBranches(r.data))
    api.get<Department[]>('/departments').then((r) => setDepartments(r.data))
  }, [hasPermission])

  const applyTenantHeader = () => {
    if (tenantOrgId) {
      localStorage.setItem('tenant_organization_id', tenantOrgId)
    } else {
      localStorage.removeItem('tenant_organization_id')
    }
    window.location.reload()
  }

  const createOrganization = async () => {
    await api.post('/organizations', newOrg)
    setNewOrg({ name: '', code: '', timezone: 'UTC' })
    const { data } = await api.get<Organization[]>('/organizations')
    setOrganizations(data)
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
              <li>JWT (Sanctum Bearer): {security.authentication.jwt.enabled ? 'enabled' : 'off'}</li>
              <li>
                OAuth2: {security.authentication.oauth2.enabled ? 'enabled' : 'off'} (
                {security.authentication.oauth2.providers.join(', ')})
              </li>
              <li>SAML: {security.authentication.saml.enabled ? 'enabled' : 'off'}</li>
              <li>LDAP / AD: {security.authentication.ldap.enabled ? 'enabled' : 'off'}</li>
            </ul>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Encryption & secrets</h2>
            <ul className="space-y-1 text-xs text-slate-400">
              <li>In transit: TLS {security.encryption.in_transit.protocol}</li>
              <li>At rest: {security.encryption.at_rest.cipher}</li>
              <li>
                Secrets driver: {security.encryption.secrets.driver}
                {security.encryption.secrets.vault_configured && ' · Vault'}
                {security.encryption.secrets.kms_configured && ' · KMS'}
              </li>
              <li>
                Tenant isolation:{' '}
                {security.tenancy.isolation_enabled ? 'mandatory' : 'disabled'}
              </li>
            </ul>
          </Card>
          <Card className="md:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">RBAC roles</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(security.authorization.roles).map(([key, label]) => (
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
            <Button type="button" onClick={createOrganization} disabled={!newOrg.name || !newOrg.code}>
              Create
            </Button>
          </div>
        </Card>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Organizations</h2>
      <TableShell className="mb-8">
        <TableHead>
          <Th>Name</Th>
          <Th>Code</Th>
          <Th>Branches</Th>
          <Th>Departments</Th>
          <Th>Employees</Th>
        </TableHead>
        <TableBody>
          {organizations.map((o) => (
            <tr key={o.id}>
              <Td>{o.name}</Td>
              <Td>{o.code}</Td>
              <Td>{o.branches_count ?? '—'}</Td>
              <Td>{o.departments_count ?? '—'}</Td>
              <Td>{o.employees_count ?? '—'}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Branches</h2>
      <TableShell className="mb-8">
        <TableHead>
          <Th>Name</Th>
          <Th>Code</Th>
          <Th>Org ID</Th>
        </TableHead>
        <TableBody>
          {branches.map((b) => (
            <tr key={b.id}>
              <Td>{b.name}</Td>
              <Td>{b.code}</Td>
              <Td>{b.organization_id}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>

      <h2 className="mb-2 text-sm font-semibold text-slate-200">Departments</h2>
      <TableShell>
        <TableHead>
          <Th>Name</Th>
          <Th>Code</Th>
          <Th>Branch</Th>
        </TableHead>
        <TableBody>
          {departments.map((d) => (
            <tr key={d.id}>
              <Td>{d.name}</Td>
              <Td>{d.code}</Td>
              <Td>{d.branch?.name ?? '—'}</Td>
            </tr>
          ))}
        </TableBody>
      </TableShell>
    </div>
  )
}
