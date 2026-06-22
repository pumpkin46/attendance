import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/shared/ui/Button'
import { SidePanel } from '@/shared/ui/SidePanel'
import { Skeleton } from '@/shared/ui/Skeleton'
import { cn } from '@/shared/lib/cn'
import { useAdminUsers, useUpdateUserOrganizations, userAdminKeys } from '@/features/users/api/queries'
import type { OrgNode } from '@/features/security/types'
import type { Paginated, User } from '@/shared/types'

const PER_PAGE = 50

const SearchIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)
const XIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Assign existing users to an organization node from the org chart. Each toggle
 * adds/removes this node from a user's granted organizations (which grants the
 * whole sub-tree server-side). Saves immediately, per row.
 */
export function AssignUsersPanel({
  open,
  node,
  onClose,
}: {
  open: boolean
  node: OrgNode | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  // Per-row in-flight ids — a single shared mutation can't track concurrent rows.
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set())

  // Start fresh each time the panel opens (render-time adjustment, not an effect).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSearch('')
      setDebounced('')
      setPendingIds(new Set())
    }
  }

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading } = useAdminUsers(
    { search: debounced || undefined, page: 1, per_page: PER_PAGE },
    { enabled: open }
  )
  const update = useUpdateUserOrganizations()

  const users = data?.data ?? []
  const total = data?.total ?? 0
  const nodeId = node?.id ?? null

  const isGranted = (u: User) => nodeId != null && (u.organizations?.some((o) => o.id === nodeId) ?? false)

  const toggle = (u: User) => {
    if (nodeId == null || node == null) return
    const ids = u.organizations?.map((o) => o.id) ?? []
    const granted = ids.includes(nodeId)
    const nextIds = granted ? ids.filter((i) => i !== nodeId) : [...ids, nodeId]
    const nextOrgs = granted
      ? (u.organizations ?? []).filter((o) => o.id !== nodeId)
      : [...(u.organizations ?? []), { id: nodeId, name: node.name }]

    // Optimistically update every cached user list so the toggle flips instantly
    // and rapid re-toggles read the intended state (the mutation reconciles).
    qc.setQueriesData<Paginated<User>>({ queryKey: userAdminKeys.usersAll }, (old) =>
      old ? { ...old, data: old.data.map((x) => (x.id === u.id ? { ...x, organizations: nextOrgs } : x)) } : old
    )
    setPendingIds((prev) => new Set(prev).add(u.id))
    update.mutate(
      { id: u.id, organization_ids: nextIds },
      {
        onSettled: () =>
          setPendingIds((prev) => {
            const next = new Set(prev)
            next.delete(u.id)
            return next
          }),
      }
    )
  }

  const grantedCount = users.filter(isGranted).length

  return (
    <SidePanel
      open={open}
      title="Assign users"
      description={
        node
          ? `Grant users access to ${node.name} and everything beneath it.`
          : undefined
      }
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 transition-colors focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/40">
          {SearchIcon}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name or email…"
            aria-label="Search users"
            className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              {XIcon}
            </button>
          )}
        </div>

        {!isLoading && users.length > 0 && (
          <p className="px-0.5 text-xs text-slate-500">
            {grantedCount} of {users.length} shown assigned here
            {total > users.length ? ` · ${total} total — refine to see more` : ''}
          </p>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-800 px-3 py-2">
                <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="rounded-lg border border-slate-700/80 bg-slate-950/40 px-3 py-8 text-center text-sm text-slate-500">
            {debounced ? 'No users match your search.' : 'No users yet.'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {users.map((u) => {
              const granted = isGranted(u)
              const pending = pendingIds.has(u.id)
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={pending}
                    aria-pressed={granted}
                    onClick={() => toggle(u)}
                    className={cn(
                      'group/u flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                      pending && 'opacity-60',
                      granted
                        ? 'border-blue-500/40 bg-blue-500/[0.07]'
                        : 'cursor-pointer border-slate-700/70 bg-slate-900 hover:border-slate-600 hover:bg-slate-800/50'
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
                        granted ? 'bg-blue-500/20 text-blue-200' : 'bg-slate-800 text-slate-300'
                      )}
                    >
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-100">{u.name}</span>
                      <span className="block truncate text-xs text-slate-500">{u.email}</span>
                    </span>
                    {pending ? (
                      <Spinner />
                    ) : (
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors',
                          granted
                            ? 'border-blue-500 bg-blue-500 text-white'
                            : 'border-slate-600 text-transparent group-hover/u:border-slate-500'
                        )}
                      >
                        {CheckIcon}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SidePanel>
  )
}
