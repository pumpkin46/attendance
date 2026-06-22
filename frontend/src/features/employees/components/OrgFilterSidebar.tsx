import { useMemo } from 'react'
import { Card } from '@/shared/ui/Card'
import { TreeView } from '@/shared/ui/TreeView'
import { cn } from '@/shared/lib/cn'
import type { OrgNode } from '@/features/security/types'

/**
 * Left-hand directory filter for the Employees page: the company org tree
 * (file-explorer style) with a per-unit headcount that rolls up across each
 * node's sub-tree. Selecting a unit filters the employee list to that unit +
 * everything beneath it; "All employees" clears the filter.
 */
export function OrgFilterSidebar({
  tree,
  counts,
  selectedId,
  onSelect,
  loading = false,
  className,
}: {
  tree: OrgNode[]
  /** Direct employee count per node id (string-keyed JSON object from the API). */
  counts: Record<string, number>
  /** Selected node id, or null for "All employees". */
  selectedId: number | null
  onSelect: (id: number | null) => void
  loading?: boolean
  className?: string
}) {
  // Roll the per-node direct counts up into sub-tree totals so a parent shows
  // everyone beneath it, matching what selecting it filters to.
  const subtreeCounts = useMemo(() => {
    const totals = new Map<number, number>()
    const visit = (node: OrgNode): number => {
      let sum = counts[String(node.id)] ?? 0
      for (const child of node.children ?? []) sum += visit(child)
      totals.set(node.id, sum)
      return sum
    }
    tree.forEach(visit)
    return totals
  }, [tree, counts])

  const total = useMemo(() => Object.values(counts).reduce((acc, n) => acc + n, 0), [counts])

  const countPill = (n: number, selected: boolean) => (
    <span
      className={cn(
        'rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums',
        selected ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-500'
      )}
    >
      {n}
    </span>
  )

  return (
    <Card padding={false} className={cn('overflow-hidden', className)}>
      <div className="border-b border-slate-800 px-3 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Organization
        </h2>
      </div>

      <div className="p-1">
        <button
          type="button"
          aria-pressed={selectedId === null}
          onClick={() => onSelect(null)}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md py-1.5 pl-2 pr-2 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/70',
            selectedId === null
              ? 'bg-blue-600 font-medium text-white'
              : 'text-slate-300 hover:bg-slate-700/40 hover:text-slate-100'
          )}
        >
          <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('h-4 w-4', selectedId === null ? 'text-white' : 'text-slate-400')}
            >
              <circle cx="9" cy="8" r="3" />
              <path d="M3 19c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5M16 5.2a3 3 0 0 1 0 5.6M21 19c0-2.2-1.4-3.6-3.5-4.2" />
            </svg>
          </span>
          <span className="min-w-0 flex-1 truncate text-left">All employees</span>
          {countPill(total, selectedId === null)}
        </button>
      </div>

      <TreeView
        nodes={tree}
        getId={(n) => n.id}
        getChildren={(n) => n.children}
        getLabel={(n) => n.name}
        selectedId={selectedId}
        onSelect={(n) => onSelect(n.id)}
        loading={loading}
        loadingRows={5}
        empty="No org units"
        ariaLabel="Filter employees by organization unit"
        maxHeight="60vh"
        className="pb-1"
        renderLabel={(n, { selected }) => (
          <span className={cn(!n.is_active && !selected && 'text-slate-500')}>{n.name}</span>
        )}
        renderTrailing={(n, { selected }) => countPill(subtreeCounts.get(n.id) ?? 0, selected)}
      />
    </Card>
  )
}
