import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Checkbox } from '@/shared/ui/Checkbox'
import { confirmDialog } from '@/shared/ui/dialogs'
import { DataTable, type Column } from '@/shared/ui/DataTable'
import { Input } from '@/shared/ui/Input'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Pagination } from '@/shared/ui/Pagination'
import { SearchBox } from '@/shared/ui/SearchBox'
import { SidePanel } from '@/shared/ui/SidePanel'
import { Tabs } from '@/shared/ui/Tabs'
import { cn } from '@/shared/lib/cn'
import type { Permission, User } from '@/shared/types'
import {
  useAdminUsers,
  useDeleteRole,
  usePermissions,
  useRoles,
  useSaveRole,
  useSaveUser,
  type RoleWithUsage,
} from '@/features/users/api/queries'

const PER_PAGE = 25
const SUPER_ADMIN = 'super_admin'

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** "cameras.manage" → "Cameras"; used to group the permission matrix. */
function permissionGroup(name: string) {
  const head = name.split('.')[0] ?? name
  return head.charAt(0).toUpperCase() + head.slice(1)
}

// ── User editor panel ────────────────────────────────────────────────────────

interface UserDraft {
  name: string
  email: string
  password: string
  is_active: boolean
  role_ids: number[]
}

function draftFromUser(user: User | null): UserDraft {
  return {
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    is_active: user?.is_active ?? true,
    role_ids: user?.roles?.map((r) => r.id) ?? [],
  }
}

function UserEditorPanel({
  open,
  editing,
  roles,
  onClose,
}: {
  open: boolean
  /** null → create mode */
  editing: User | null
  roles: RoleWithUsage[]
  onClose: () => void
}) {
  const { user: me, isSuperAdmin } = useAuth()
  const save = useSaveUser()
  const [draft, setDraft] = useState<UserDraft>(() => draftFromUser(editing))

  // Re-initialize on each open (render-time state adjustment, not an effect) so
  // content stays stable during the slide-out animation when closing.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(draftFromUser(editing))
  }

  const isSelf = editing != null && editing.id === me?.id
  const canSubmit =
    draft.name.trim() !== '' && draft.email.trim() !== '' && (editing != null || draft.password.length >= 8)

  const toggleRole = (roleId: number, checked: boolean) => {
    setDraft((d) => ({
      ...d,
      role_ids: checked ? [...d.role_ids, roleId] : d.role_ids.filter((id) => id !== roleId),
    }))
  }

  const handleSave = async () => {
    const payload = {
      name: draft.name.trim(),
      email: draft.email.trim(),
      is_active: draft.is_active,
      role_ids: draft.role_ids,
      ...(draft.password ? { password: draft.password } : {}),
    }
    try {
      await save.mutateAsync({ id: editing?.id, payload })
      onClose()
    } catch {
      // Error already toasted by the mutation; keep the panel open for fixes.
    }
  }

  return (
    <SidePanel
      open={open}
      title={editing ? 'Edit user' : 'New user'}
      description={
        editing ? editing.email : 'Create an account and assign its roles directly.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} isLoading={save.isPending} disabled={!canSubmit}>
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Full name</label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Jane Doe"
            maxLength={255}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
          <Input
            type="email"
            value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder="you@company.com"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            {editing ? 'Reset password' : 'Password'}
          </label>
          <Input
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
            placeholder={editing ? 'Leave blank to keep current password' : 'At least 8 characters'}
            minLength={8}
          />
        </div>

        <Checkbox
          label="Active"
          description={
            isSelf
              ? 'You cannot deactivate your own account.'
              : 'Inactive accounts cannot sign in.'
          }
          checked={draft.is_active}
          disabled={isSelf}
          onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
        />

        <div>
          <p className="mb-2 text-sm font-medium text-slate-300">Roles</p>
          <div className="space-y-2.5 rounded-lg border border-slate-700/80 bg-slate-950/40 p-4">
            {roles.map((role) => {
              const lockedSuperAdmin = role.name === SUPER_ADMIN && !isSuperAdmin()
              return (
                <Checkbox
                  key={role.id}
                  label={role.label}
                  description={
                    role.name === SUPER_ADMIN
                      ? 'Full access — bypasses all permission checks.'
                      : `${role.permissions?.length ?? 0} permission(s)`
                  }
                  checked={draft.role_ids.includes(role.id)}
                  disabled={lockedSuperAdmin}
                  onChange={(e) => toggleRole(role.id, e.target.checked)}
                />
              )
            })}
            {roles.length === 0 && (
              <p className="text-sm text-slate-500">No roles defined yet.</p>
            )}
          </div>
        </div>
      </div>
    </SidePanel>
  )
}

// ── Users tab ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading, error } = useAdminUsers({
    search: debounced || undefined,
    page,
    per_page: PER_PAGE,
  })
  const { data: roles = [] } = useRoles()

  const openEditor = (user: User | null) => {
    setEditing(user)
    setPanelOpen(true)
  }

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'User',
      sortable: true,
      cell: (u) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-200">{u.name}</p>
          <p className="truncate text-xs text-slate-500">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (u) =>
        u.roles?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {u.roles.map((r) => (
              <Badge key={r.id} tone={r.name === SUPER_ADMIN ? 'warn' : 'neutral'}>
                {r.label}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-slate-600">No roles</span>
        ),
    },
    {
      key: 'is_active',
      header: 'Status',
      width: '7rem',
      sortable: true,
      sortValue: (u) => (u.is_active ? 1 : 0),
      cell: (u) => (
        <Badge tone={u.is_active ? 'ok' : 'danger'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      width: '9rem',
      sortable: true,
      cell: (u) => <span className="text-slate-400">{formatDate(u.created_at)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search by name or email…"
          className="w-72"
        />
        <Button onClick={() => openEditor(null)}>New user</Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        rowKey={(u) => u.id}
        loading={isLoading}
        error={error ? 'Failed to load users' : undefined}
        empty="No users match your search"
        onRowClick={(u) => openEditor(u)}
      />

      {data && data.last_page > 1 && (
        <Pagination
          page={data.current_page}
          pageCount={data.last_page}
          onPageChange={setPage}
          totalItems={data.total}
          pageSize={PER_PAGE}
        />
      )}

      <UserEditorPanel
        open={panelOpen}
        editing={editing}
        roles={roles}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  )
}

// ── Roles & permissions tab ──────────────────────────────────────────────────

function RoleEditor({
  role,
  permissions,
  onDeleted,
  onCreated,
}: {
  /** null → create mode */
  role: RoleWithUsage | null
  permissions: Permission[]
  onDeleted: () => void
  onCreated: (id: number) => void
}) {
  // The parent remounts this editor (via key) whenever the selected role
  // changes, so plain initializers are enough — no sync effect needed.
  const save = useSaveRole()
  const remove = useDeleteRole()
  const [name, setName] = useState('')
  const [label, setLabel] = useState(role?.label ?? '')
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(role?.permissions?.map((p) => p.id) ?? [])
  )

  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const perm of permissions) {
      const group = permissionGroup(perm.name)
      map.set(group, [...(map.get(group) ?? []), perm])
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [permissions])

  const isSuperAdminRole = role?.name === SUPER_ADMIN

  const dirty = useMemo(() => {
    if (!role) return label.trim() !== '' && name.trim() !== ''
    const original = new Set(role.permissions?.map((p) => p.id) ?? [])
    if (label.trim() !== role.label) return true
    if (original.size !== selected.size) return true
    return [...selected].some((id) => !original.has(id))
  }, [role, name, label, selected])

  const togglePermission = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleGroup = (perms: Permission[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const p of perms) {
        if (checked) next.add(p.id)
        else next.delete(p.id)
      }
      return next
    })
  }

  const handleSave = async () => {
    const payload = role
      ? { label: label.trim(), permission_ids: [...selected] }
      : { name: name.trim(), label: label.trim(), permission_ids: [...selected] }
    try {
      const { data } = await save.mutateAsync({ id: role?.id, payload })
      if (!role) onCreated(data.id)
    } catch {
      // Error already toasted by the mutation.
    }
  }

  const handleDelete = async () => {
    if (!role) return
    const confirmed = await confirmDialog({
      title: 'Delete role',
      message: `Delete the "${role.label}" role? Users keep their other roles; this cannot be undone.`,
      confirmLabel: 'Delete role',
    })
    if (!confirmed) return
    try {
      await remove.mutateAsync(role.id)
      onDeleted()
    } catch {
      // Error already toasted by the mutation.
    }
  }

  if (isSuperAdminRole) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/15 text-amber-400">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <p className="font-medium text-slate-200">Super Admin has full access</p>
        <p className="max-w-sm text-sm text-slate-400">
          This role bypasses all permission checks by design and cannot be edited or deleted.
        </p>
      </Card>
    )
  }

  return (
    <Card className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {!role && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Name (identifier)
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. auditor"
            />
            <p className="mt-1 text-xs text-slate-500">
              Lowercase identifier used by the API; cannot be changed later.
            </p>
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Display label</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Auditor"
          />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-300">
            Permissions{' '}
            <span className="font-normal text-slate-500">({selected.size} selected)</span>
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map(([group, perms]) => {
            const allChecked = perms.every((p) => selected.has(p.id))
            return (
              <div key={group} className="rounded-lg border border-slate-700/80 bg-slate-950/40 p-4">
                <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2">
                  <p className="text-sm font-semibold text-slate-200">{group}</p>
                  <button
                    type="button"
                    onClick={() => toggleGroup(perms, !allChecked)}
                    className="text-xs font-medium text-blue-400 transition-colors hover:text-blue-300"
                  >
                    {allChecked ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="space-y-2.5">
                  {perms.map((perm) => (
                    <Checkbox
                      key={perm.id}
                      label={perm.label}
                      description={perm.name}
                      checked={selected.has(perm.id)}
                      onChange={(e) => togglePermission(perm.id, e.target.checked)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        {role ? (
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={remove.isPending}
            disabled={role.user_count > 0}
            title={
              role.user_count > 0
                ? `Assigned to ${role.user_count} user(s) — reassign them first`
                : undefined
            }
          >
            Delete role
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={handleSave} isLoading={save.isPending} disabled={!dirty}>
          {role ? 'Save changes' : 'Create role'}
        </Button>
      </div>
    </Card>
  )
}

function RolesTab() {
  const { data: roles = [], isLoading: rolesLoading } = useRoles()
  const { data: permissions = [] } = usePermissions()
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)

  // Default to the first role once loaded; tolerate the selected role vanishing
  // after a delete by falling back during render.
  const selectedRole =
    selectedId === 'new' ? null : roles.find((r) => r.id === selectedId) ?? roles[0] ?? null

  if (rolesLoading) {
    return <Card className="py-16 text-center text-slate-500">Loading roles…</Card>
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {roles.map((role) => {
          const active = selectedId !== 'new' && role.id === selectedRole?.id
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={cn(
                'w-full rounded-lg border px-4 py-3 text-left transition-colors',
                active
                  ? 'border-blue-500/60 bg-blue-500/10'
                  : 'border-slate-700/80 bg-slate-900 hover:border-slate-600 hover:bg-slate-800/60'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={cn('truncate font-medium', active ? 'text-blue-300' : 'text-slate-200')}>
                  {role.label}
                </p>
                <Badge tone="neutral">{role.user_count}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {role.name === SUPER_ADMIN
                  ? 'Full access'
                  : `${role.permissions?.length ?? 0} permission(s)`}
              </p>
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setSelectedId('new')}
          className={cn(
            'w-full rounded-lg border border-dashed px-4 py-3 text-left text-sm font-medium transition-colors',
            selectedId === 'new'
              ? 'border-blue-500/60 bg-blue-500/10 text-blue-300'
              : 'border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-200'
          )}
        >
          + New role
        </button>
      </div>

      <RoleEditor
        key={selectedId === 'new' ? 'new' : selectedRole?.id ?? 'none'}
        role={selectedId === 'new' ? null : selectedRole}
        permissions={permissions}
        onDeleted={() => setSelectedId(null)}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

type TabId = 'users' | 'roles'

export default function UserManagementPage() {
  const { hasPermission, isSuperAdmin } = useAuth()
  const canManageRoles = isSuperAdmin() || hasPermission('roles.manage')
  const [tab, setTab] = useState<TabId>('users')

  const tabs: { id: TabId; label: string }[] = [
    { id: 'users', label: 'Users' },
    ...(canManageRoles ? [{ id: 'roles' as const, label: 'Roles & Permissions' }] : []),
  ]

  return (
    <div>
      <PageHeader
        title="Users & Permissions"
        description="Manage user accounts, roles, and permissions."
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  )
}
