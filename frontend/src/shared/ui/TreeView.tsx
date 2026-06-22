import { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Skeleton } from '@/shared/ui/Skeleton'

/* ------------------------------------------------------------------ *
 * TreeView — an accessible, single-select navigation tree styled like a
 * file explorer: per-row +/- expander, folder (has children) / document
 * (leaf) icons, a full-width selection bar, and the selected node's
 * ancestors shown in bold. Rendered as an ARIA `tree` of `treeitem`s with:
 *   ↑/↓        move between visible rows
 *   →          expand a collapsed row, else step to its first child
 *   ←          collapse an expanded row, else step to its parent
 *   Home/End   first / last visible row
 *   Enter/Space select the focused row
 *   a-z/0-9    type-ahead to the next matching row
 * Roving tabindex is built in; callers supply the tree and (optionally)
 * row-state-aware label / trailing / icon renderers.
 * ------------------------------------------------------------------ */

export interface TreeNodeState {
  selected: boolean
  expanded: boolean
  hasChildren: boolean
  depth: number
  /** This node is on the path from a root down to the selected node. */
  ancestorOfSelected: boolean
}

export interface TreeViewProps<T> {
  nodes: T[]
  getId: (node: T) => React.Key
  getChildren: (node: T) => T[] | null | undefined
  /** Plain-text label — used for type-ahead and as the default rendered label. */
  getLabel: (node: T) => string
  /** Currently-selected node id (controlled). */
  selectedId?: React.Key | null
  onSelect?: (node: T) => void
  /** Custom label content; defaults to the plain `getLabel` text. */
  renderLabel?: (node: T, state: TreeNodeState) => React.ReactNode
  /** Trailing content pinned to the row's right edge (e.g. a count badge). */
  renderTrailing?: (node: T, state: TreeNodeState) => React.ReactNode
  /** Override the leading folder/document icon. */
  renderIcon?: (node: T, state: TreeNodeState) => React.ReactNode
  /** Accessible name for the tree. */
  ariaLabel?: string
  loading?: boolean
  loadingRows?: number
  /** Empty-state content (default: "Nothing here"). */
  empty?: React.ReactNode
  /** Constrain the scroll area. */
  maxHeight?: number | string
  className?: string
}

const INDENT = 16 // px per depth level
const SLOT = 16 // px square for the expander / icon slots (h-4 w-4)

interface FlatRow<T> {
  node: T
  id: React.Key
  depth: number
  hasChildren: boolean
  expanded: boolean
  setsize: number
  posinset: number
}

function ExpandIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3"
    >
      <path d="M5 12h14" />
      {!open && <path d="M12 5v14" />}
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2H19.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h5" />
    </svg>
  )
}

export function TreeView<T>({
  nodes,
  getId,
  getChildren,
  getLabel,
  selectedId,
  onSelect,
  renderLabel,
  renderTrailing,
  renderIcon,
  ariaLabel,
  loading = false,
  loadingRows = 6,
  empty = 'Nothing here',
  maxHeight,
  className,
}: TreeViewProps<T>) {
  // Track COLLAPSED ids (inverse of expanded) so freshly-added nodes default
  // to open and data changes never need the state re-seeded.
  const [collapsed, setCollapsed] = useState<Set<React.Key>>(() => new Set())
  const [focusedId, setFocusedId] = useState<React.Key | null>(null)
  const rowRefs = useRef(new Map<React.Key, HTMLDivElement>())
  const typeAhead = useRef({ buffer: '', at: 0 })

  const rows = useMemo(() => {
    const out: FlatRow<T>[] = []
    const walk = (list: T[], depth: number) => {
      list.forEach((node, i) => {
        const id = getId(node)
        const kids = getChildren(node) ?? []
        const hasChildren = kids.length > 0
        const expanded = !collapsed.has(id)
        out.push({ node, id, depth, hasChildren, expanded, setsize: list.length, posinset: i + 1 })
        if (hasChildren && expanded) walk(kids, depth + 1)
      })
    }
    walk(nodes, 0)
    return out
  }, [nodes, collapsed, getId, getChildren])

  // Ids on the path from a root down to the selected (visible) node — bolded.
  const ancestorIds = useMemo(() => {
    const set = new Set<React.Key>()
    if (selectedId == null) return set
    const idx = rows.findIndex((r) => r.id === selectedId)
    if (idx < 0) return set
    let depth = rows[idx].depth
    for (let j = idx - 1; j >= 0 && depth > 0; j--) {
      if (rows[j].depth < depth) {
        set.add(rows[j].id)
        depth = rows[j].depth
      }
    }
    return set
  }, [rows, selectedId])

  const toggle = useCallback((id: React.Key) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const focusRow = useCallback((id: React.Key) => {
    setFocusedId(id)
    rowRefs.current.get(id)?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, idx: number) => {
    const row = rows[idx]
    if (!row) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (idx < rows.length - 1) focusRow(rows[idx + 1].id)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (idx > 0) focusRow(rows[idx - 1].id)
        break
      case 'ArrowRight':
        e.preventDefault()
        if (row.hasChildren && !row.expanded) toggle(row.id)
        else if (row.hasChildren && idx < rows.length - 1) focusRow(rows[idx + 1].id)
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (row.hasChildren && row.expanded) {
          toggle(row.id)
        } else {
          for (let j = idx - 1; j >= 0; j--) {
            if (rows[j].depth < row.depth) {
              focusRow(rows[j].id)
              break
            }
          }
        }
        break
      case 'Home':
        e.preventDefault()
        if (rows.length) focusRow(rows[0].id)
        break
      case 'End':
        e.preventDefault()
        if (rows.length) focusRow(rows[rows.length - 1].id)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        onSelect?.(row.node)
        break
      default: {
        // Type-ahead: jump to the next row whose label starts with the buffer.
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) break
        e.preventDefault()
        // eslint-disable-next-line react-hooks/purity -- runs in a keydown handler, not during render
        const now = Date.now()
        const ta = typeAhead.current
        ta.buffer = now - ta.at > 600 ? e.key : ta.buffer + e.key
        ta.at = now
        const q = ta.buffer.toLowerCase()
        for (let n = 1; n <= rows.length; n++) {
          const r = rows[(idx + n) % rows.length]
          if (getLabel(r.node).trim().toLowerCase().startsWith(q)) {
            focusRow(r.id)
            break
          }
        }
      }
    }
  }

  // Roving tabindex always has exactly one target: the selected row (else the
  // first row), promoted to whatever the user last focused.
  const focusValid = focusedId != null && rows.some((r) => r.id === focusedId)
  const selectedValid = selectedId != null && rows.some((r) => r.id === selectedId)
  const activeId = focusValid ? focusedId : selectedValid ? selectedId : rows[0]?.id

  const toLen = (v: number | string | undefined) =>
    v == null ? undefined : typeof v === 'number' ? `${v}px` : v

  return (
    <div
      className={cn('scrollbar-styled overflow-auto', className)}
      style={{ maxHeight: toLen(maxHeight) }}
    >
      {loading ? (
        <div className="space-y-0.5 p-1">
          {Array.from({ length: loadingRows }).map((_, r) => (
            <div key={`sk-${r}`} className="flex items-center gap-1.5 px-2 py-1.5" style={{ marginLeft: (r % 3) * INDENT }}>
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <Skeleton className="h-3.5" style={{ width: `${60 - r * 6}%` }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-10 text-center text-sm text-slate-500">{empty}</div>
      ) : (
        <div role="tree" aria-label={ariaLabel} className="p-1">
          {rows.map((row, idx) => {
            const selected = row.id === selectedId
            const ancestorOfSelected = ancestorIds.has(row.id)
            const state: TreeNodeState = {
              selected,
              expanded: row.expanded,
              hasChildren: row.hasChildren,
              depth: row.depth,
              ancestorOfSelected,
            }
            const icon = renderIcon
              ? renderIcon(row.node, state)
              : row.hasChildren
                ? <FolderIcon />
                : <FileIcon />
            return (
              <div
                key={row.id}
                ref={(el) => {
                  const map = rowRefs.current
                  if (el) map.set(row.id, el)
                  else map.delete(row.id)
                }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-setsize={row.setsize}
                aria-posinset={row.posinset}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-selected={selected}
                tabIndex={row.id === activeId ? 0 : -1}
                onFocus={(e) => {
                  if (e.target === e.currentTarget) setFocusedId(row.id)
                }}
                onKeyDown={(e) => onKeyDown(e, idx)}
                onClick={() => {
                  setFocusedId(row.id)
                  onSelect?.(row.node)
                }}
                className={cn(
                  'group flex cursor-pointer select-none items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm outline-none transition-colors',
                  selected
                    ? 'bg-blue-600 font-medium text-white'
                    : ancestorOfSelected
                      ? 'font-medium text-slate-100 hover:bg-slate-700/40'
                      : 'text-slate-300 hover:bg-slate-700/40 hover:text-slate-100',
                  'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/70'
                )}
                style={{ paddingLeft: 8 + row.depth * INDENT }}
              >
                {row.hasChildren ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={row.expanded ? 'Collapse' : 'Expand'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setFocusedId(row.id)
                      toggle(row.id)
                    }}
                    className={cn(
                      'grid shrink-0 place-items-center rounded transition-colors',
                      selected ? 'text-blue-100 hover:text-white' : 'text-slate-500 hover:text-slate-200'
                    )}
                    style={{ height: SLOT, width: SLOT }}
                  >
                    <ExpandIcon open={row.expanded} />
                  </button>
                ) : (
                  <span aria-hidden className="shrink-0" style={{ height: SLOT, width: SLOT }} />
                )}

                <span className={cn('shrink-0', !selected && 'text-slate-400')}>{icon}</span>

                <span className="min-w-0 flex-1 truncate">
                  {renderLabel ? renderLabel(row.node, state) : getLabel(row.node)}
                </span>

                {renderTrailing && <span className="shrink-0">{renderTrailing(row.node, state)}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
