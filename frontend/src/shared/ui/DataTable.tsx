import { useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Card } from '@/shared/ui/Card'
import { Pagination } from '@/shared/ui/Pagination'
import { Skeleton } from '@/shared/ui/Skeleton'

/* ------------------------------------------------------------------ *
 * Low-level primitives — kept for ad-hoc / composed tables.
 * Prefer the declarative <DataTable /> below for standard tables.
 * ------------------------------------------------------------------ */

export function TableShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card padding={false} className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">{children}</table>
    </Card>
  )
}

export function TableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400">
      <tr>{children}</tr>
    </thead>
  )
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-4 py-3 font-medium', className)}>{children}</th>
}

export function Td({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={cn('border-b border-slate-800 px-4 py-3', className)}>
      {children}
    </td>
  )
}

export function TableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>
}

/* ------------------------------------------------------------------ *
 * Declarative DataTable
 * ------------------------------------------------------------------ */

export type Align = 'left' | 'right' | 'center'

export interface Column<T> {
  /** Stable id; also the default accessor for `cell`/`sortValue`. */
  key: string
  header: React.ReactNode
  /** Cell renderer. Defaults to `String(row[key])`. */
  cell?: (row: T, index: number) => React.ReactNode
  align?: Align
  /** Extra classes for the body `<td>`. */
  className?: string
  /** Extra classes for the header `<th>`. */
  headerClassName?: string
  /** Fixed column width, e.g. `'12rem'` or `'120px'`. */
  width?: string
  /** Enable client-side sorting for this column. */
  sortable?: boolean
  /** Value used when sorting; defaults to `row[key]`. */
  sortValue?: (row: T) => string | number | boolean | null | undefined
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  /** Unique key per row. */
  rowKey: (row: T, index: number) => React.Key
  loading?: boolean
  /** When set, an error row is shown instead of the data. */
  error?: React.ReactNode
  /** Empty-state content (default: "No records found"). */
  empty?: React.ReactNode
  onRowClick?: (row: T, index: number) => void
  rowClassName?: (row: T, index: number) => string | undefined
  /** Keep the header visible while the body scrolls. Defaults to true when `maxHeight` is set. */
  stickyHeader?: boolean
  /** Tighter row padding. */
  dense?: boolean
  /** Placeholder rows shown while loading (default 5). */
  loadingRows?: number
  /** Max rows per page. When set, the table paginates and shows pagination controls. */
  pageSize?: number
  /** Constrain the scroll area height (number = px). Body scrolls; header can stay sticky. */
  minHeight?: number | string
  maxHeight?: number | string
  className?: string
}

const alignClass: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

const accessor = <T,>(row: T, key: string): unknown => (row as Record<string, unknown>)[key]

/** Stringify a cell/sort value safely (objects have no meaningful default text). */
function toText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return ''
}

function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <span className="inline-flex flex-col leading-[0]">
      <svg viewBox="0 0 24 24" className={cn('h-2.5 w-2.5', dir === 'asc' ? 'text-blue-400' : 'text-slate-600')} fill="currentColor">
        <path d="M12 6l6 8H6z" />
      </svg>
      <svg viewBox="0 0 24 24" className={cn('-mt-0.5 h-2.5 w-2.5', dir === 'desc' ? 'text-blue-400' : 'text-slate-600')} fill="currentColor">
        <path d="M12 18l-6-8h12z" />
      </svg>
    </span>
  )
}

/**
 * Professional, declarative data table. Handles loading skeletons, error and
 * empty states, sticky headers, row hover, alignment, and optional
 * client-side sorting — so feature pages only describe columns and data.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  error,
  empty = 'No records found',
  onRowClick,
  rowClassName,
  stickyHeader,
  dense = false,
  loadingRows = 5,
  pageSize,
  minHeight,
  maxHeight,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [page, setPage] = useState(1)

  const sorted = useMemo(() => {
    if (!sort) return data
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return data
    const getVal = (row: T) => (col.sortValue ? col.sortValue(row) : accessor(row, col.key))
    const copy = [...data]
    copy.sort((a, b) => {
      const av = getVal(a)
      const bv = getVal(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      let cmp: number
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
      else cmp = toText(av).localeCompare(toText(bv), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [data, sort, columns])

  const cellPad = dense ? 'px-3 py-2' : 'px-4 py-3'

  // Pagination (client-side). Active only when pageSize is set.
  const pageCount = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  // Clamp during render (no effect) so the view stays valid when data shrinks.
  const safePage = Math.min(page, pageCount)
  const paged = pageSize ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize) : sorted

  const toggleSort = (key: string) => {
    setPage(1)
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === 'asc'
          ? { key, dir: 'desc' }
          : null
        : { key, dir: 'asc' }
    )
  }

  const colCount = columns.length
  const sticky = stickyHeader ?? maxHeight != null
  const toLen = (v: number | string | undefined) =>
    v == null ? undefined : typeof v === 'number' ? `${v}px` : v
  const showPagination = pageSize != null && !loading && !error && sorted.length > 0

  return (
    <Card padding={false} className={cn(className)}>
      <div
        className="scrollbar-styled overflow-auto"
        style={{ minHeight: toLen(minHeight), maxHeight: toLen(maxHeight) }}
      >
        <table className="w-full text-sm">
          <thead
            className={cn(
              'border-b border-slate-700 text-left text-xs uppercase tracking-wide text-slate-400',
              sticky && 'sticky top-0 z-10 bg-slate-900/95 backdrop-blur'
            )}
          >
          <tr>
            {columns.map((col) => {
              const align = col.align ?? 'left'
              const active = sort?.key === col.key
              return (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'px-4 py-3 font-medium',
                    alignClass[align],
                    col.sortable && 'cursor-pointer select-none hover:text-slate-200',
                    col.headerClassName
                  )}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5',
                      align === 'right' && 'flex-row-reverse'
                    )}
                  >
                    {col.header}
                    {col.sortable && <SortIcon dir={active ? sort.dir : null} />}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, r) => (
              <tr key={`sk-${r}`} className="border-b border-slate-800">
                {columns.map((col) => (
                  <td key={col.key} className={cellPad}>
                    <Skeleton className="h-4" style={{ width: `${40 + ((r + col.key.length) % 5) * 12}%` }} />
                  </td>
                ))}
              </tr>
            ))
          ) : error ? (
            <tr>
              <td colSpan={colCount} className={cn(cellPad, 'text-center text-rose-400')}>
                {error}
              </td>
            </tr>
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={colCount} className={cn(cellPad, 'py-10 text-center text-slate-500')}>
                {empty}
              </td>
            </tr>
          ) : (
            paged.map((row, i) => {
              // Index into the (sorted) full data set, so paginated cells/handlers stay correct.
              const index = pageSize ? (safePage - 1) * pageSize + i : i
              return (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                  className={cn(
                    'border-b border-slate-800 transition-colors last:border-0',
                    onRowClick ? 'cursor-pointer hover:bg-slate-800/60' : 'hover:bg-slate-800/30',
                    rowClassName?.(row, index)
                  )}
                >
                  {columns.map((col) => {
                    const align = col.align ?? 'left'
                    return (
                      <td key={col.key} className={cn(cellPad, alignClass[align], col.className)}>
                        {col.cell ? col.cell(row, index) : toText(accessor(row, col.key))}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
        </table>
      </div>
      {showPagination && (
        <div className="border-t border-slate-700 px-4 py-3">
          <Pagination
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
            totalItems={sorted.length}
            pageSize={pageSize}
          />
        </div>
      )}
    </Card>
  )
}
