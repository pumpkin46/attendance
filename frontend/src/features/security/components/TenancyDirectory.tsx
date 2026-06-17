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
import type { Location, Organization } from '@/features/security/types'
import {
  useCreateLocation,
  useCreateOrganization,
  useDeleteLocation,
  useDeleteOrganization,
  useLocations,
  useOrganizations,
  useOrgTree,
  useUpdateLocation,
  useUpdateOrganization,
} from '@/features/security/api/queries'
import { flattenTree } from '@/features/security/lib/tree'
import { OrgTreeView } from '@/features/security/components/OrgTreeView'

const FORM_ID = 'tenancy-entity-form'
const PAGE_SIZE = 8

type EntityTab = 'organizations' | 'units' | 'locations'

interface PanelState {
  entity: 'organizations' | 'locations'
  record: Organization | Location | null
}

const ENTITY_LABEL: Record<'organizations' | 'locations', string> = {
  organizations: 'organization',
  locations: 'location',
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
  allowDeactivate,
  onSubmit,
}: {
  record: Organization | null
  /** Hidden for the lone organization — deactivating it would break the whole tenant context. */
  allowDeactivate: boolean
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
      {record && allowDeactivate && (
        <ActiveField checked={active} onChange={setActive} entity="organization" />
      )}
    </form>
  )
}

function LocationForm({
  record,
  organizations,
  showOrgPicker,
  defaultOrgId,
  orgPinned,
  onSubmit,
}: {
  record: Location | null
  organizations: Organization[]
  showOrgPicker: boolean
  defaultOrgId: string
  orgPinned: boolean
  onSubmit: (values: {
    name: string
    address: string | null
    timezone: string
    organization_id?: number
    is_active?: boolean
  }) => void
}) {
  const [orgId, setOrgId] = useState(record ? String(record.organization_id) : defaultOrgId)
  const [name, setName] = useState(record?.name ?? '')
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
        <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Head Office" />
      </Label>
      <Label>
        Address <span className="text-xs text-slate-500">(optional)</span>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="100 Main Street" />
      </Label>
      <Label>
        Timezone
        <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" />
      </Label>
      {record && <ActiveField checked={active} onChange={setActive} entity="location" />}
    </form>
  )
}

// ── Directory ────────────────────────────────────────────────────────────────

/**
 * Tabbed tenancy directory: organizations (company roots), the recursive org
 * unit tree, and locations — with search, inline edit / delete, and
 * side-panel create / edit forms.
 */
export function TenancyDirectory() {
  const { isSuperAdmin, hasPermission } = useAuth()
  const tenantHeaderOrg = useAppSelector(selectOrgId)

  const { data: organizations, isPending: orgsLoading } = useOrganizations()
  const { data: tree, isPending: treeLoading } = useOrgTree()
  const { data: locations, isPending: locationsLoading } = useLocations()
  const orgs = organizations ?? []
  const treeRoots = tree ?? []
  const locationList = locations ?? []

  const allNodes = useMemo(() => flattenTree(treeRoots), [treeRoots])
  // Non-root units only — company roots are managed from the Organizations tab.
  const unitCount = allNodes.filter((n) => n.parent_id !== null).length

  const [tab, setTab] = useState<EntityTab>('organizations')
  const [search, setSearch] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  // `panel` keeps the last opened record mounted while the panel animates out.
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const createOrg = useCreateOrganization()
  const updateOrg = useUpdateOrganization()
  const deleteOrg = useDeleteOrganization()
  const createLocation = useCreateLocation()
  const updateLocation = useUpdateLocation()
  const deleteLocation = useDeleteLocation()

  const canManageOrgs = hasPermission('organizations.manage')
  const canManageNodes = hasPermission('org_nodes.manage')
  // Locations are facility management, same scope as org units.
  const canManageLocations = canManageNodes

  // Single-organization deployment: the directory converges to exactly one
  // org. Creating is only offered when none exists (broken-state recovery)
  // and deleting only while there is more than one (pruning back to one) —
  // day to day, the lone organization is just renamed via Edit.
  const canCreateOrg = isSuperAdmin() && orgs.length === 0
  const canDeleteOrg = isSuperAdmin() && orgs.length > 1

  const query = search.trim().toLowerCase()
  const matches = (name: string, code: string) =>
    !query || name.toLowerCase().includes(query) || code.toLowerCase().includes(query)
  const inOrgFilter = (organizationId: number) =>
    !orgFilter || organizationId === Number(orgFilter)

  const filteredOrgs = orgs.filter((o) => matches(o.name, o.code))
  const filteredLocations = locationList.filter(
    (l) => matches(l.name, l.address ?? '') && inOrgFilter(l.organization_id)
  )

  const tabs: { id: EntityTab; label: string; count: number }[] = [
    { id: 'organizations', label: 'Organizations', count: orgs.length },
    { id: 'units', label: 'Org units', count: unitCount },
    { id: 'locations', label: 'Locations', count: locationList.length },
  ]

  const openPanel = (entity: PanelState['entity'], record: PanelState['record']) => {
    setPanel({ entity, record })
    setPanelOpen(true)
  }
  const closePanel = () => setPanelOpen(false)

  const removeOrganization = async (org: Organization) => {
    const ok = await confirmDialog({
      title: 'Delete organization',
      message: `"${org.name}" and all of its org units will be permanently removed. Organizations with employees cannot be deleted.`,
      confirmLabel: 'Delete organization',
    })
    if (ok) deleteOrg.mutate(org.id, { onSuccess: closePanel })
  }

  const removeLocation = async (loc: Location) => {
    const ok = await confirmDialog({
      title: 'Delete location',
      message: `"${loc.name}" will be permanently removed. Locations with cameras, RFID readers, or employees assigned cannot be deleted — move those first.`,
      confirmLabel: 'Delete location',
    })
    if (ok) deleteLocation.mutate(loc.id, { onSuccess: closePanel })
  }

  const deleting = deleteOrg.isPending || deleteLocation.isPending
  const saving =
    createOrg.isPending ||
    updateOrg.isPending ||
    createLocation.isPending ||
    updateLocation.isPending

  const canManage: Record<'organizations' | 'locations', boolean> = {
    organizations: canManageOrgs,
    locations: canManageLocations,
  }

  const rowActions = (
    entity: 'organizations' | 'locations',
    record: Organization | Location,
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

  const showOrgFilter = tab === 'locations' && orgs.length > 1
  const canCreateCurrent = tab === 'organizations' ? canCreateOrg : tab === 'locations' && canManageLocations
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

        {tab !== 'units' && (
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search by name or code…"
            className="w-64"
          />
        )}

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
            onClick={() => openPanel(tab === 'organizations' ? 'organizations' : 'locations', null)}
            leftIcon={
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            New {tab === 'organizations' ? 'organization' : 'location'}
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
            { key: 'nodes_count', header: 'Org units', width: '7rem', align: 'right', sortable: true, cell: (o) => o.nodes_count ?? 0 },
            { key: 'employees_count', header: 'Employees', width: '7rem', align: 'right', sortable: true, cell: (o) => o.employees_count ?? 0 },
            { key: 'status', header: 'Status', width: '6.5rem', cell: (o) => <StatusBadge active={o.is_active} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (o) => rowActions('organizations', o, () => removeOrganization(o), canDeleteOrg),
            },
          ]}
        />
      )}

      {tab === 'units' && (
        <OrgTreeView tree={treeRoots} loading={treeLoading} canManage={canManageNodes} />
      )}

      {tab === 'locations' && (
        <DataTable
          data={filteredLocations}
          rowKey={(l) => l.id}
          loading={locationsLoading}
          pageSize={PAGE_SIZE}
          onRowClick={canManage.locations ? (l) => openPanel('locations', l) : undefined}
          empty={query || orgFilter ? 'No locations match your filters' : 'No locations yet'}
          columns={[
            {
              key: 'name',
              header: 'Name',
              sortable: true,
              cell: (l) => <span className="font-medium text-slate-100">{l.name}</span>,
            },
            {
              key: 'address',
              header: 'Address',
              className: 'max-w-[16rem]',
              cell: (l) => (
                <span className="block truncate text-slate-400">{l.address || '—'}</span>
              ),
            },
            { key: 'timezone', header: 'Timezone', width: '9rem', className: 'text-slate-400' },
            { key: 'status', header: 'Status', width: '6.5rem', cell: (l) => <StatusBadge active={l.is_active} /> },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (l) => rowActions('locations', l, () => removeLocation(l), true),
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
            allowDeactivate={orgs.length > 1}
            onSubmit={(values) => {
              const record = panel.record as Organization | null
              if (record) updateOrg.mutate({ id: record.id, ...values }, { onSuccess: closePanel })
              else createOrg.mutate(values, { onSuccess: closePanel })
            }}
          />
        )}
        {panel?.entity === 'locations' && (
          <LocationForm
            key={(panel.record as Location | null)?.id ?? 'new'}
            record={panel.record as Location | null}
            organizations={orgs}
            showOrgPicker={showOrgPicker}
            defaultOrgId={defaultOrgId}
            orgPinned={orgPinned}
            onSubmit={(values) => {
              const record = panel.record as Location | null
              if (record)
                updateLocation.mutate({ id: record.id, ...values }, { onSuccess: closePanel })
              else createLocation.mutate(values, { onSuccess: closePanel })
            }}
          />
        )}
      </SidePanel>
    </section>
  )
}
