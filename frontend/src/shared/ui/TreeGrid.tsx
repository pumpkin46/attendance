import { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Card } from '@/shared/ui/Card'
import { Skeleton } from '@/shared/ui/Skeleton'

/* ------------------------------------------------------------------ *
 * TreeGrid — a hierarchical, accessible data grid.
 *
 * Renders nested data as an ARIA `treegrid`: a real table whose first
 * (tree) column carries expand/collapse + indentation. Full keyboard model:
 *   ↑/↓        move between rows
 *   →          expand a collapsed row, else step into the row's controls
 *   ←          step back through controls to the row, collapse, else parent
 *   Home/End   first / last row
 *   Enter/Space activate the row (when not on an inner control)
 *   *          expand every sibling at the focused depth
 *   a-z/0-9    type-ahead to the next matching row
 * Roving tabindex, indent guides, sticky header and an expand/collapse-all
 * toolbar are built in; feature pages only describe columns + supply the tree.
 * ------------------------------------------------------------------ */

export type TreeAlign = 'left' | 'right' | 'center'

export interface TreeColumn<T> {
  /** Stable id (used as React key). */
  key: string
  header: React.ReactNode
  /** Cell renderer. */
  cell: (node: T) => React.ReactNode
  /** Exactly one column should set this — it gets the caret + indentation. */
  tree?: boolean
  align?: TreeAlign
  width?: string
  headerClassName?: string
  className?: string
}

export interface TreeGridProps<T> {
  nodes: T[]
  columns: TreeColumn<T>[]
  getId: (node: T) => React.Key
  getChildren: (node: T) => T[] | null | undefined
  /** Accessible name for the grid. */
  ariaLabel?: string
  /** Text used for type-ahead; defaults to the rendered row text. */
  getLabel?: (node: T) => string
  loading?: boolean
  /** Empty-state content (default: "No items"). */
  empty?: React.ReactNode
  /** Fired on Enter/Space or double-click of a row. */
  onActivate?: (node: T) => void
  rowClassName?: (node: T) => string | undefined
  /** Show the expand-all / collapse-all toolbar (default: auto when nestable). */
  toolbar?: boolean
  /** Constrain the scroll area; the header stays sticky. */
  maxHeight?: number | string
  loadingRows?: number
  className?: string
}

const INDENT = 22 // px per depth level
const TOGGLE = 20 // px toggle box (w-5); its centerline drives guide alignment
const RAIL_X = 16 + TOGGLE / 2 // tree cell px-4 (16) + half the toggle box

const FOCUSABLE = 'button:not([tabindex="-1"]):not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

const alignClass: Record<TreeAlign, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

interface FlatRow<T> {
  node: T
  id: React.Key
  depth: number
  hasChildren: boolean
  expanded: boolean
  setsize: number
  posinset: number
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-3.5 w-3.5 transition-transform duration-150 ease-out', open && 'rotate-90')}
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

export function TreeGrid<T>({
  nodes,
  columns,
  getId,
  getChildren,
  ariaLabel,
  getLabel,
  loading = false,
  empty = 'No items',
  onActivate,
  rowClassName,
  toolbar,
  maxHeight,
  loadingRows = 5,
  className,
}: TreeGridProps<T>) {
  // Track COLLAPSED ids (inverse of expanded) so freshly-added nodes default
  // to open and data changes never need the state re-seeded.
  const [collapsed, setCollapsed] = useState<Set<React.Key>>(() => new Set())
  const [focusedId, setFocusedId] = useState<React.Key | null>(null)
  const rowRefs = useRef(new Map<React.Key, HTMLTableRowElement>())
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

  const anyNestable = useMemo(
    () => rows.some((r) => r.hasChildren) || collapsed.size > 0,
    [rows, collapsed]
  )

  const treeColIndex = Math.max(0, columns.findIndex((c) => c.tree))

  const toggle = useCallback((id: React.Key) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const collapseAll = () => {
    const all = new Set<React.Key>()
    const walk = (list: T[]) =>
      list.forEach((n) => {
        const kids = getChildren(n) ?? []
        if (kids.length) {
          all.add(getId(n))
          walk(kids)
        }
      })
    walk(nodes)
    setCollapsed(all)
  }
  const expandAll = () => setCollapsed(new Set())

  const focusRow = useCallback((id: React.Key) => {
    setFocusedId(id)
    rowRefs.current.get(id)?.focus()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, idx: number) => {
    const row = rows[idx]
    if (!row) return
    const rowEl = e.currentTarget
    const onRow = e.target === rowEl
    const focusables = onRow ? [] : Array.from(rowEl.querySelectorAll<HTMLElement>(FOCUSABLE))
    const widgetIdx = onRow ? -1 : focusables.indexOf(e.target as HTMLElement)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (idx < rows.length - 1) focusRow(rows[idx + 1].id)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (idx > 0) focusRow(rows[idx - 1].id)
        break
      case 'ArrowRight': {
        e.preventDefault()
        if (onRow) {
          if (row.hasChildren && !row.expanded) toggle(row.id)
          else {
            const f = Array.from(rowEl.querySelectorAll<HTMLElement>(FOCUSABLE))
            f[0]?.focus()
          }
        } else if (widgetIdx >= 0 && widgetIdx < focusables.length - 1) {
          focusables[widgetIdx + 1].focus()
        }
        break
      }
      case 'ArrowLeft':
        e.preventDefault()
        if (!onRow) {
          if (widgetIdx > 0) focusables[widgetIdx - 1].focus()
          else rowEl.focus()
        } else if (row.hasChildren && row.expanded) {
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
        if (!onRow) return // let the focused control handle it
        e.preventDefault()
        if (onActivate) onActivate(row.node)
        else if (row.hasChildren) toggle(row.id)
        break
      case '*':
        if (!onRow) return
        e.preventDefault()
        setCollapsed((prev) => {
          const next = new Set(prev)
          rows.forEach((r) => {
            if (r.depth === row.depth && r.hasChildren) next.delete(r.id)
          })
          return next
        })
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
        const labelOf = (r: FlatRow<T>) =>
          (getLabel ? getLabel(r.node) : rowRefs.current.get(r.id)?.textContent ?? '')
            .trim()
            .toLowerCase()
        for (let n = 1; n <= rows.length; n++) {
          const r = rows[(idx + n) % rows.length]
          if (labelOf(r).startsWith(q)) {
            focusRow(r.id)
            break
          }
        }
      }
    }
  }

  // Roving tabindex always has exactly one target; before any interaction it is
  // the first row (tabbable), but the "current row" treatment only shows once
  // the user has actually focused a row.
  const focusValid = focusedId != null && rows.some((r) => r.id === focusedId)
  const activeId = focusValid ? focusedId : rows[0]?.id
  const currentId = focusValid ? focusedId : null

  const showToolbar = (toolbar ?? anyNestable) && !loading && rows.length > 0
  const toLen = (v: number | string | undefined) =>
    v == null ? undefined : typeof v === 'number' ? `${v}px` : v

  const toolbarBtn =
    'rounded px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200'

  return (
    <Card padding={false} className={className}>
      {showToolbar && (
        <div className="flex items-center justify-end gap-1 border-b border-slate-800 px-3 py-2">
          <button type="button" onClick={expandAll} className={toolbarBtn}>
            Expand all
          </button>
          <button type="button" onClick={collapseAll} className={toolbarBtn}>
            Collapse all
          </button>
        </div>
      )}

      <div className="scrollbar-styled overflow-auto" style={{ maxHeight: toLen(maxHeight) }}>
        <table
          role="treegrid"
          aria-label={ariaLabel}
          aria-multiselectable={false}
          className="w-full table-fixed text-sm"
        >
          <thead className="sticky top-0 z-10 border-b border-slate-700 bg-slate-900/95 text-left text-xs uppercase tracking-wide text-slate-400 shadow-sm shadow-black/20 backdrop-blur">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  role="columnheader"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn('px-4 py-3 font-medium', alignClass[col.align ?? 'left'], col.headerClassName)}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: loadingRows }).map((_, r) => (
                <tr key={`sk-${r}`} className="border-b border-slate-800">
                  {columns.map((col, ci) =>
                    ci === treeColIndex ? (
                      <td key={col.key} className="px-4 py-3">
                        <div className="flex items-center gap-2" style={{ marginLeft: (r % 3) * INDENT }}>
                          <Skeleton className="h-4 w-4 shrink-0 rounded" />
                          <Skeleton className="h-4" style={{ width: `${48 - r * 5}%` }} />
                        </div>
                      </td>
                    ) : (
                      <td key={col.key} className="px-4 py-3">
                        <Skeleton className="h-4 w-2/3" />
                      </td>
                    )
                  )}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-14 text-center text-sm text-slate-500">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={row.id}
                  ref={(el) => {
                    // eslint-disable-next-line react-hooks/refs -- ref callback runs at commit, not during render
                    const map = rowRefs.current
                    if (el) map.set(row.id, el)
                    else map.delete(row.id)
                  }}
                  role="row"
                  aria-level={row.depth + 1}
                  aria-setsize={row.setsize}
                  aria-posinset={row.posinset}
                  aria-expanded={row.hasChildren ? row.expanded : undefined}
                  aria-selected={row.id === currentId ? true : undefined}
                  tabIndex={row.id === activeId ? 0 : -1}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget) setFocusedId(row.id)
                  }}
                  onKeyDown={(e) => onKeyDown(e, idx)}
                  onDoubleClick={() => onActivate?.(row.node)}
                  className={cn(
                    'group border-b border-slate-800 outline-none transition-colors last:border-0',
                    row.id === currentId
                      ? 'bg-blue-500/10 shadow-[inset_2px_0_0_0] shadow-blue-500'
                      : 'hover:bg-slate-800/40',
                    'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500/60',
                    rowClassName?.(row.node)
                  )}
                >
                  {columns.map((col) => {
                    const align = col.align ?? 'left'
                    if (col.tree) {
                      return (
                        <td key={col.key} role="gridcell" className={cn('p-0', col.className)}>
                          <div className="relative flex items-center px-4 py-2.5">
                            {/* Continuous indent rails — one per ancestor level. */}
                            {Array.from({ length: row.depth }).map((_, k) => (
                              <span
                                key={k}
                                aria-hidden
                                className="absolute top-0 bottom-0 w-px bg-slate-800 transition-colors group-hover:bg-slate-700"
                                style={{ left: RAIL_X + k * INDENT }}
                              />
                            ))}
                            <div className="flex min-w-0 items-center gap-1" style={{ marginLeft: row.depth * INDENT }}>
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
                                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-500 transition-colors group-hover:text-slate-300 hover:!bg-slate-700 hover:!text-slate-100"
                                >
                                  <Chevron open={row.expanded} />
                                </button>
                              ) : (
                                <span aria-hidden className="h-5 w-5 shrink-0" />
                              )}
                              <div className="min-w-0">{col.cell(row.node)}</div>
                            </div>
                          </div>
                        </td>
                      )
                    }
                    return (
                      <td
                        key={col.key}
                        role="gridcell"
                        className={cn('px-4 py-2.5', alignClass[align], col.className)}
                      >
                        {col.cell(row.node)}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
