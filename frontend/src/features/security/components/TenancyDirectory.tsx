import { useMemo, useState } from 'react'
import { useAppSelector } from '@/store/hooks'
import { selectOrgId } from '@/features/tenant/tenantSlice'
import { useAuth } from '@/features/auth/AuthProvider'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Combobox } from '@/shared/ui/Combobox'
import { DataTable } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
import { confirmDialog } from '@/shared/ui/dialogs'
import { cn } from '@/shared/lib/cn'
import type { Branch, Department, Organization } from '@/features/security/types'
import {
  useBranches,
  useCreateBranch,
  useCreateDepartment,
  useCreateOrganization,
  useDeleteBranch,
  useDeleteDepartment,
  useDeleteOrganization,
  useDepartments,
  useOrganizations,
  useUpdateBranch,
  useUpdateDepartment,
  useUpdateOrganization,
} from '@/features/security/api/queries'

const FORM_ID = 'tenancy-entity-form'
const PAGE_SIZE = 8

type EntityTab = 'organizations' | 'branches' | 'departments'

interface PanelState {
  entity: EntityTab
  record: Organization | Branch | Department | null
}

const ENTITY_LABEL: Record<EntityTab, string> = {
  organizations: 'organization',
  branches: 'branch',
  departments: 'department',
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'ok' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge>
}

function ActiveField({
  checked,
  onChange,
  entity,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  entity: string
}) {
  return (
    <div className="pt-1">
      <Checkbox
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        label="Active"
        description={`Inactive ${entity}s are kept for history but hidden from day-to-day workflows.`}
      />
    </div>
  )
}

/** Read-only context line shown on edit forms (the parent org cannot be changed). */
function OrgContextRow({ name }: { name: string }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5">
      <span className="text-xs uppercase tracking-wide text-slate-500">Organization</span>
      <span className="text-sm font-medium text-slate-200">{name}</span>
    </div>
  )
}

// ── Forms ────────────────────────────────────────────────────────────────────

function OrganizationForm({
  record,
  onSubmit,
}: {
  record: Organization | null
  onSubmit: (values: { name: string; code: string; timezone: string; is_active?: boolean }) => void
}) {
  const [name, setName] = useState(record?.name ?? '')
  const [code, setCode] = useState(record?.code ?? '')
  const [timezone, setTimezone] = useState(record?.timezone ?? 'UTC')
  const [active, setActive] = useState(record?.is_active ?? true)

  return (
    <form
      id={FORM_ID}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(
          record
            ? { name, code, timezone, is_active: active }
            : { name, code, timezone }
        )
      }}
    >
      <Label>
        Name
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
      </Label>
      <Label>
        Code
        <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="ACME" />
      </Label>
      <Label>
        Timezone
        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
      </Label>
      {record && <ActiveField checked={active} onChange={setActive} entity="organization" />}
    </form>
  )
}

function BranchForm({
  record,
  organizations,
  showOrgPicker,
  defaultOrgId,
  orgPinned,
  onSubmit,
}: {
  record: Branch | null
  organizations: Organization[]
  showOrgPicker: boolean
  defaultOrgId: string
  orgPinned: boolean
  onSubmit: (values: {
    name: string
    code: string
    address: string | null
    timezone: string
    organization_id?: number
    is_active?: boolean
  }) => void
}) {
  const [orgId, setOrgId] = useState(defaultOrgId)
  const [name, setName] = useState(record?.name ?? '')
  const [code, setCode] = useState(record?.code ?? '')
  const [address, setAddress] = useState(record?.address ?? '')
  const [timezone, setTimezone] = useState(record?.timezone ?? 'UTC')
  const [active, setActive] = useState(record?.is_active ?? true)
  const orgName = organizations.find((o) => o.id === record?.organization_id)?.name

  return (
    <form
      id={FORM_ID}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          name,
          code,
          address: address.trim() || null,
          timezone,
          ...(record
            ? { is_active: active }
            : orgId
              ? { organization_id: Number(orgId) }
              : {}),
        })
      }}
    >
      {record ? (
        <OrgContextRow name={orgName ?? `Organization #${record.organization_id}`} />
      ) : (
        showOrgPicker && (
          <Label>
            Organization
            <Combobox
              value={orgId}
              onChange={setOrgId}
              required
              disabled={orgPinned}
              placeholder="Select organization…"
              options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
            />
          </Label>
        )
      )}
      <Label>
        Name
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Headquarters" />
      </Label>
      <Label>
        Code
        <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="HQ" />
      </Label>
      <Label>
        Address <span className="text-xs text-slate-500">(optional)</span>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="1 Main Street" />
      </Label>
      <Label>
        Timezone
        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
      </Label>
      {record && <ActiveField checked={active} onChange={setActive} entity="branch" />}
    </form>
  )
}

function DepartmentForm({
  record,
  organizations,
  branches,
  showOrgPicker,
  defaultOrgId,
  orgPinned,
  onSubmit,
}: {
  record: Department | null
  organizations: Organization[]
  branches: Branch[]
  showOrgPicker: boolean
  defaultOrgId: string
  orgPinned: boolean
  onSubmit: (values: {
    name: string
    code: string
    branch_id: number | null
    organization_id?: number
    is_active?: boolean
  }) => void
}) {
  const [orgId, setOrgId] = useState(record ? String(record.organization_id) : defaultOrgId)
  const [branchId, setBranchId] = useState(record?.branch_id ? String(record.branch_id) : '')
  const [name, setName] = useState(record?.name ?? '')
  const [code, setCode] = useState(record?.code ?? '')
  const [active, setActive] = useState(record?.is_active ?? true)
  const orgName = organizations.find((o) => o.id === record?.organization_id)?.name

  // Only branches of the target organization are valid parents. When no picker
  // is shown the list is already tenant-scoped by the API.
  const branchOptions = useMemo(() => {
    const scoped = orgId ? branches.filter((b) => b.organization_id === Number(orgId)) : branches
    return [
      { value: '', label: 'No branch' },
      ...scoped.map((b) => ({ value: String(b.id), label: b.name })),
    ]
  }, [branches, orgId])

  return (
    <form
      id={FORM_ID}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({
          name,
          code,
          branch_id: branchId ? Number(branchId) : null,
          ...(record
            ? { is_active: active }
            : orgId
              ? { organization_id: Number(orgId) }
              : {}),
        })
      }}
    >
      {record ? (
        <OrgContextRow name={orgName ?? `Organization #${record.organization_id}`} />
      ) : (
        showOrgPicker && (
          <Label>
            Organization
            <Combobox
              value={orgId}
              onChange={(v) => {
                setOrgId(v)
                setBranchId('')
              }}
              required
              disabled={orgPinned}
              placeholder="Select organization…"
              options={organizations.map((o) => ({ value: String(o.id), label: o.name }))}
            />
          </Label>
        )
      )}
      <Label>
        Name
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
      </Label>
      <Label>
        Code
        <Input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="ENG" />
      </Label>
      <Label>
        Branch <span className="text-xs text-slate-500">(optional)</span>
        <Combobox value={branchId} onChange={setBranchId} options={branchOptions} />
      </Label>
      {record && <ActiveField checked={active} onChange={setActive} entity="department" />}
    </form>
  )
}

// ── Directory ────────────────────────────────────────────────────────────────

/**
 * Tabbed tenancy directory: organizations, branches, and departments with
 * search, inline edit / delete, and side-panel create / edit forms.
 */
export function TenancyDirectory() {
  const { isSuperAdmin, hasPermission } = useAuth()
  const tenantHeaderOrg = useAppSelector(selectOrgId)

  const { data: organizations, isPending: orgsLoading } = useOrganizations()
  const { data: branches, isPending: branchesLoading } = useBranches()
  const { data: departments, isPending: departmentsLoading } = useDepartments()
  const orgs = organizations ?? []
  const branchList = branches ?? []
  const deptList = departments ?? []

  const [tab, setTab] = useState<EntityTab>('organizations')
  const [search, setSearch] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  // `panel` keeps the last opened record mounted while the panel animates out.
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const createOrg = useCreateOrganization()
  const updateOrg = useUpdateOrganization()
  const deleteOrg = useDeleteOrganization()
  const createBranch = useCreateBranch()
  const updateBranch = useUpdateBranch()
  const deleteBranch = useDeleteBranch()
  const createDept = useCreateDepartment()
  const updateDept = useUpdateDepartment()
  const deleteDept = useDeleteDepartment()

  const canManage: Record<EntityTab, boolean> = {
    organizations: hasPermission('organizations.manage'),
    branches: hasPermission('branches.manage'),
    departments: hasPermission('departments.manage'),
  }
  // Creating / deleting whole tenants is reserved for super admins (API-enforced).
  const canCreateOrg = isSuperAdmin()

  const orgNames = useMemo(
    () => new Map((organizations ?? []).map((o) => [o.id, o.name])),
    [organizations]
  )

  const query = search.trim().toLowerCase()
  const matches = (name: string, code: string) =>
    !query || name.toLowerCase().includes(query) || code.toLowerCase().includes(query)
  const inOrgFilter = (organizationId: number) =>
    !orgFilter || organizationId === Number(orgFilter)

  const filteredOrgs = orgs.filter((o) => matches(o.name, o.code))
  const filteredBranches = branchList.filter((b) => matches(b.name, b.code) && inOrgFilter(b.organization_id))
  const filteredDepts = deptList.filter((d) => matches(d.name, d.code) && inOrgFilter(d.organization_id))

  const tabs: { id: EntityTab; label: string; count: number }[] = [
    { id: 'organizations', label: 'Organizations', count: orgs.length },
    { id: 'branches', label: 'Branches', count: branchList.length },
    { id: 'departments', label: 'Departments', count: deptList.length },
  ]

  const openPanel = (entity: EntityTab, record: PanelState['record']) => {
    setPanel({ entity, record })
    setPanelOpen(true)
  }
  const closePanel = () => setPanelOpen(false)

  const removeOrganization = async (org: Organization) => {
    const ok = await confirmDialog({
      title: 'Delete organization',
      message: `"${org.name}" and all of its branches and departments will be permanently removed. Organizations with employees cannot be deleted.`,
      confirmLabel: 'Delete organization',
    })
    if (ok) deleteOrg.mutate(org.id, { onSuccess: closePanel })
  }

  const removeBranch = async (branch: Branch) => {
    const ok = await confirmDialog({
      title: 'Delete branch',
      message: `"${branch.name}" will be permanently removed. Departments under it are kept and detached. Branches with employees cannot be deleted.`,
      confirmLabel: 'Delete branch',
    })
    if (ok) deleteBranch.mutate(branch.id, { onSuccess: closePanel })
  }

  const removeDepartment = async (dept: Department) => {
    const ok = await confirmDialog({
      title: 'Delete department',
      message: `"${dept.name}" will be permanently removed. Departments with employees cannot be deleted.`,
      confirmLabel: 'Delete department',
    })
    if (ok) deleteDept.mutate(dept.id, { onSuccess: closePanel })
  }

  const deleting = deleteOrg.isPending || deleteBranch.isPending || deleteDept.isPending
  const saving =
    createOrg.isPending ||
    updateOrg.isPending ||
    createBranch.isPending ||
    updateBranch.isPending ||
    createDept.isPending ||
    updateDept.isPending

  const rowActions = (
    entity: EntityTab,
    record: Organization | Branch | Department,
    onDelete: () => void,
    allowDelete: boolean
  ) => {
    if (!canManage[entity]) return null
    return (
      // Inline actions must not also trigger the row click.
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="sm" onClick={() => openPanel(entity, record)}>
          Edit
        </Button>
        {allowDelete && (
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            className="border-red-900/60 text-red-400 hover:border-red-700 hover:bg-red-500/10 hover:text-red-300"
            onClick={onDelete}
          >
            Delete
          </Button>
        )}
      </div>
    )
  }

  const showOrgFilter = tab !== 'organizations' && orgs.length > 1
  const newLabel = `New ${ENTITY_LABEL[tab]}`
  const canCreateCurrent = tab === 'organizations' ? canCreateOrg : canManage[tab]
  // Super admins pick the target org in the form unless a tenant context is pinned.
  const showOrgPicker = isSuperAdmin() && orgs.length > 0
  const defaultOrgId = tenantHeaderOrg ?? orgFilter
  const orgPinned = !!tenantHeaderOrg

  const panelTitle = panel
    ? `${panel.record ? 'Edit' : 'New'} ${ENTITY_LABEL[panel.entity]}`
    : ''

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3 pb-4">
        <div
          className="inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-0.5"
          role="group"
          aria-label="Directory section"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                tab === t.id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {t.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-px font-mono text-[10px]',
                  tab === t.id ? 'bg-slate-600 text-slate-200' : 'bg-slate-800 text-slate-500'
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search by name or code…"
          className="w-64"
        />

        {showOrgFilter && (
          <Combobox
            value={orgFilter}
            onChange={setOrgFilter}
            className="w-56"
            aria-label="Filter by organization"
            options={[
              { value: '', label: 'All organizations' },
              ...orgs.map((o) => ({ value: String(o.id), label: o.name })),
            ]}
          />
        )}

        {canCreateCurrent && (
          <Button
            className="ml-auto"
            onClick={() => openPanel(tab, null)}
            leftIcon={
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            {newLabel}
          </Button>
        )}
      </div>

      {tab === 'organizations' && (
        <DataTable
          data={filteredOrgs}
          rowKey={(o) => o.id}
          loading={orgsLoading}
          pageSize={PAGE_SIZE}
          onRowClick={canManage.organizations ? (o) => openPanel('organizations', o) : undefined}
          empty={query ? 'No organizations match your search' : 'No organizations yet'}
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortable: true,
              cell: (o) => <span className="font-medium text-slate-100">{o.name}</span>,
            },
            {
              key: 'code',
              header: 'Code',
              width: '7rem',
              className: 'font-mono text-xs text-slate-300',
              sortable: true,
            },
            { key: 'timezone', header: 'Timezone', width: '9rem', className: 'text-slate-400' },
            { key: 'branches_count', header: 'Branches', width: '6.5rem', align: 'right', sortable: true, cell: (o) => o.branches_count ?? 0 },
            { key: 'departments_count', header: 'Departments', width: '7.5rem', align: 'right', sortable: true, cell: (o) => o.departments_count ?? 0 },
            { key: 'employees_count', header: 'Employees', width: '7rem', align: 'right', sortable: true, cell: (o) => o.employees_count ?? 0 },
            { key: 'status', header: 'Status', width: '6.5rem', cell: (o) => <StatusBadge active={o.is_active} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (o) => rowActions('organizations', o, () => removeOrganization(o), canCreateOrg),
            },
          ]}
        />
      )}

      {tab === 'branches' && (
        <DataTable
          data={filteredBranches}
          rowKey={(b) => b.id}
          loading={branchesLoading}
          pageSize={PAGE_SIZE}
          onRowClick={canManage.branches ? (b) => openPanel('branches', b) : undefined}
          empty={query || orgFilter ? 'No branches match your filters' : 'No branches yet'}
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortable: true,
              cell: (b) => <span className="font-medium text-slate-100">{b.name}</span>,
            },
            {
              key: 'code',
              header: 'Code',
              width: '7rem',
              className: 'font-mono text-xs text-slate-300',
              sortable: true,
            },
            {
              key: 'organization',
              header: 'Organization',
              sortable: true,
              sortValue: (b) => orgNames.get(b.organization_id) ?? '',
              cell: (b) => orgNames.get(b.organization_id) ?? `#${b.organization_id}`,
            },
            {
              key: 'address',
              header: 'Address',
              className: 'max-w-[16rem]',
              cell: (b) => (
                <span className="block truncate text-slate-400">{b.address || '—'}</span>
              ),
            },
            { key: 'timezone', header: 'Timezone', width: '9rem', className: 'text-slate-400' },
            { key: 'status', header: 'Status', width: '6.5rem', cell: (b) => <StatusBadge active={b.is_active} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (b) => rowActions('branches', b, () => removeBranch(b), true),
            },
          ]}
        />
      )}

      {tab === 'departments' && (
        <DataTable
          data={filteredDepts}
          rowKey={(d) => d.id}
          loading={departmentsLoading}
          pageSize={PAGE_SIZE}
          onRowClick={canManage.departments ? (d) => openPanel('departments', d) : undefined}
          empty={query || orgFilter ? 'No departments match your filters' : 'No departments yet'}
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortable: true,
              cell: (d) => <span className="font-medium text-slate-100">{d.name}</span>,
            },
            {
              key: 'code',
              header: 'Code',
              width: '7rem',
              className: 'font-mono text-xs text-slate-300',
              sortable: true,
            },
            {
              key: 'organization',
              header: 'Organization',
              sortable: true,
              sortValue: (d) => orgNames.get(d.organization_id) ?? '',
              cell: (d) => orgNames.get(d.organization_id) ?? `#${d.organization_id}`,
            },
            {
              key: 'branch',
              header: 'Branch',
              sortable: true,
              sortValue: (d) => d.branch?.name ?? '',
              cell: (d) => d.branch?.name ?? <span className="text-slate-600">—</span>,
            },
            { key: 'status', header: 'Status', width: '6.5rem', cell: (d) => <StatusBadge active={d.is_active} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (d) => rowActions('departments', d, () => removeDepartment(d), true),
            },
          ]}
        />
      )}

      <SidePanel
        open={panelOpen}
        title={panelTitle}
        description={
          panel?.record
            ? `Update details for this ${ENTITY_LABEL[panel.entity]}.`
            : panel
              ? `Add a ${ENTITY_LABEL[panel.entity]} to the tenant directory.`
              : undefined
        }
        onClose={closePanel}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={closePanel}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} isLoading={saving}>
              {panel?.record ? 'Save changes' : 'Create'}
            </Button>
          </>
        }
      >
        {panel?.entity === 'organizations' && (
          <OrganizationForm
            key={(panel.record as Organization | null)?.id ?? 'new'}
            record={panel.record as Organization | null}
            onSubmit={(values) => {
              const record = panel.record as Organization | null
              if (record) updateOrg.mutate({ id: record.id, ...values }, { onSuccess: closePanel })
              else createOrg.mutate(values, { onSuccess: closePanel })
            }}
          />
        )}
        {panel?.entity === 'branches' && (
          <BranchForm
            key={(panel.record as Branch | null)?.id ?? 'new'}
            record={panel.record as Branch | null}
            organizations={orgs}
            showOrgPicker={showOrgPicker}
            defaultOrgId={defaultOrgId}
            orgPinned={orgPinned}
            onSubmit={(values) => {
              const record = panel.record as Branch | null
              if (record) updateBranch.mutate({ id: record.id, ...values }, { onSuccess: closePanel })
              else createBranch.mutate(values, { onSuccess: closePanel })
            }}
          />
        )}
        {panel?.entity === 'departments' && (
          <DepartmentForm
            key={(panel.record as Department | null)?.id ?? 'new'}
            record={panel.record as Department | null}
            organizations={orgs}
            branches={branchList}
            showOrgPicker={showOrgPicker}
            defaultOrgId={defaultOrgId}
            orgPinned={orgPinned}
            onSubmit={(values) => {
              const record = panel.record as Department | null
              if (record) updateDept.mutate({ id: record.id, ...values }, { onSuccess: closePanel })
              else createDept.mutate(values, { onSuccess: closePanel })
            }}
          />
        )}
      </SidePanel>
    </section>
  )
}
