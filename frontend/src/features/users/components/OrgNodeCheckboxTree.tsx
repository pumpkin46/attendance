import { useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Skeleton } from '@/shared/ui/Skeleton'
import { typeStyle } from '@/features/security/lib/nodeType'
import type { OrgNode } from '@/features/security/types'

/* ------------------------------------------------------------------ *
 * OrgNodeCheckboxTree — a modern, connector-railed multi-select of the
 * org tree (company -> sub-units) for granting a user org access.
 *
 * Granting a node grants its whole sub-tree on the server, so this UI
 * makes that explicit: a node directly granted reads "Granted"; every
 * descendant beneath it reads "Inherited" (and its toggle is disabled —
 * it is already covered). A node with a granted descendant but no grant of
 * its own shows a partial state. Rows carry per-type icons + indent rails.
 * ------------------------------------------------------------------ */

const INDENT = 20 // px per depth level
const RAIL_OFFSET = 8 // px from a row's left edge to a chevron's centre

type RowState = 'granted' | 'inherited' | 'partial' | 'none'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-3.5 w-3.5 transition-transform', open ? 'rotate-90' : '')}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

/** Round grant indicator on the right of each row. */
function GrantDot({ state }: { state: RowState }) {
  if (state === 'granted') {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-500 text-white shadow-sm shadow-blue-900/40">
        {CheckIcon}
      </span>
    )
  }
  if (state === 'inherited') {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-slate-600 bg-slate-700/40 text-slate-400">
        {CheckIcon}
      </span>
    )
  }
  if (state === 'partial') {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-blue-500/60 text-blue-400">
        <span className="h-0.5 w-2 rounded-full bg-current" />
      </span>
    )
  }
  return (
    <span className="h-5 w-5 shrink-0 rounded-full border border-slate-600 transition-colors group-hover/row:border-slate-500" />
  )
}

interface FlatRow {
  node: OrgNode
  depth: number
  hasChildren: boolean
}

export function OrgNodeCheckboxTree({
  tree,
  selectedIds,
  onToggle,
  loading = false,
  query = '',
  className,
}: {
  tree: OrgNode[]
  /** Currently-granted node ids (the checked set). */
  selectedIds: number[]
  /** Toggle a single node's grant. */
  onToggle: (id: number) => void
  loading?: boolean
  /** Filter text — prunes the tree to matches (+ ancestors) and auto-expands. */
  query?: string
  className?: string
}) {
  // Track COLLAPSED ids so freshly-loaded trees default to fully expanded.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  // Node ids with at least one selected descendant → partial state.
  const hasSelectedDescendant = useMemo(() => {
    const set = new Set<number>()
    const visit = (n: OrgNode): boolean => {
      let any = false
      for (const child of n.children ?? []) {
        const childCarries = visit(child) || selected.has(child.id)
        any = any || childCarries
      }
      if (any) set.add(n.id)
      return any
    }
    tree.forEach(visit)
    return set
  }, [tree, selected])

  // Node ids whose grant comes from an ancestor (their toggle is redundant).
  const coveredByAncestor = useMemo(() => {
    const set = new Set<number>()
    const walk = (nodes: OrgNode[], ancestorGranted: boolean) => {
      for (const n of nodes) {
        if (ancestorGranted) set.add(n.id)
        walk(n.children ?? [], ancestorGranted || selected.has(n.id))
      }
    }
    walk(tree, false)
    return set
  }, [tree, selected])

  const q = query.trim().toLowerCase()
  // Prune to matching nodes: a match keeps its whole sub-tree; a non-match is
  // kept only if it has a kept descendant (so ancestors stay as context).
  const displayTree = useMemo(() => {
    if (!q) return tree
    const prune = (nodes: OrgNode[]): OrgNode[] => {
      const out: OrgNode[] = []
      for (const n of nodes) {
        const selfMatch = n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q)
        if (selfMatch) {
          out.push(n)
          continue
        }
        const kids = prune(n.children ?? [])
        if (kids.length) out.push({ ...n, children: kids })
      }
      return out
    }
    return prune(tree)
  }, [tree, q])

  // Flatten visible rows respecting collapse state. While filtering, force-expand
  // so every surviving match is visible regardless of collapse state.
  const rows = useMemo(() => {
    const out: FlatRow[] = []
    const forceExpand = q.length > 0
    const walk = (nodes: OrgNode[], depth: number) => {
      for (const node of nodes) {
        const kids = node.children ?? []
        out.push({ node, depth, hasChildren: kids.length > 0 })
        if (kids.length > 0 && (forceExpand || !collapsed.has(node.id))) walk(kids, depth + 1)
      }
    }
    walk(displayTree, 0)
    return out
  }, [displayTree, collapsed, q])

  const toggleCollapse = (id: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const rowState = (id: number): RowState => {
    if (selected.has(id)) return 'granted'
    if (coveredByAncestor.has(id)) return 'inherited'
    if (hasSelectedDescendant.has(id)) return 'partial'
    return 'none'
  }

  if (loading) {
    return (
      <div className={cn('space-y-1 rounded-xl border border-slate-700/80 bg-slate-950/40 p-3', className)}>
        {Array.from({ length: 5 }).map((_, r) => (
          <div key={r} className="flex items-center gap-2 py-1.5" style={{ marginLeft: (r % 3) * INDENT }}>
            <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
            <Skeleton className="h-3.5" style={{ width: `${55 - r * 5}%` }} />
          </div>
        ))}
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <div className={cn('rounded-xl border border-slate-700/80 bg-slate-950/40 p-4', className)}>
        <p className="text-sm text-slate-500">No organizations yet.</p>
      </div>
    )
  }

  return (
    <div
      role="tree"
      aria-label="Organization access"
      className={cn(
        'scrollbar-styled max-h-80 overflow-auto rounded-xl border border-slate-700/80 bg-slate-950/40 p-1.5',
        className
      )}
    >
      {rows.length === 0 && (
        <p className="px-2 py-8 text-center text-sm text-slate-500">No units match your filter.</p>
      )}
      {rows.map(({ node, depth, hasChildren }) => {
        const state = rowState(node.id)
        const granted = state === 'granted'
        const inherited = state === 'inherited'
        const expanded = q.length > 0 ? true : !collapsed.has(node.id)
        const { icon, tile } = typeStyle(node.node_type, node.parent_id === null)
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-selected={granted}
            aria-expanded={hasChildren ? expanded : undefined}
            className={cn(
              'group/row relative flex items-center rounded-md pr-2 transition-colors',
              granted ? 'bg-blue-500/10' : inherited ? 'opacity-70' : 'hover:bg-slate-800/50'
            )}
          >
            {/* Indent connector rails. */}
            {Array.from({ length: depth }).map((_, k) => (
              <span
                key={k}
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-slate-700/60"
                style={{ left: RAIL_OFFSET + k * INDENT }}
              />
            ))}
            {/* Accent bar for a directly-granted node. */}
            {granted && (
              <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-blue-400" />
            )}

            <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1" style={{ paddingLeft: depth * INDENT }}>
              {hasChildren ? (
                <button
                  type="button"
                  disabled={q.length > 0}
                  aria-label={q.length > 0 ? 'Expanded' : expanded ? 'Collapse' : 'Expand'}
                  onClick={() => toggleCollapse(node.id)}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-500 transition-colors hover:text-slate-200 disabled:cursor-default disabled:hover:text-slate-500"
                >
                  <Chevron open={expanded} />
                </button>
              ) : (
                <span aria-hidden className="h-4 w-4 shrink-0" />
              )}

              <button
                type="button"
                disabled={inherited}
                aria-pressed={granted}
                aria-label={
                  inherited
                    ? `${node.name} — granted via a parent`
                    : `${granted ? 'Revoke' : 'Grant'} access to ${node.name}`
                }
                onClick={() => onToggle(node.id)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded text-left',
                  inherited ? 'cursor-default' : 'cursor-pointer'
                )}
              >
                <span
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ring-inset ring-white/5 [&_svg]:h-4 [&_svg]:w-4',
                    tile
                  )}
                >
                  {icon}
                </span>
                <span
                  title={node.name}
                  className={cn(
                    'min-w-0 truncate text-sm',
                    granted ? 'font-semibold' : 'font-medium',
                    // Single text-* utility (plain cn has no merge) so the
                    // inactive dim never competes with the granted color.
                    !node.is_active ? 'text-slate-500' : granted ? 'text-slate-50' : 'text-slate-200'
                  )}
                >
                  {node.name}
                </span>
                {!node.is_active && (
                  <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px text-[10px] font-medium text-slate-400">
                    Inactive
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
                  {inherited && (
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      Inherited
                    </span>
                  )}
                  <GrantDot state={state} />
                </span>
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
