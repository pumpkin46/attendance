import { cn } from '@/shared/lib/cn'

interface PaginationProps {
  /** Current page, 1-based. */
  page: number
  /** Total number of pages. */
  pageCount: number
  onPageChange: (page: number) => void
  /** Total item count — enables the "Showing X–Y of Z" summary. */
  totalItems?: number
  /** Rows per page — used together with `totalItems` for the summary. */
  pageSize?: number
  className?: string
}

/** Build the page list with ellipses: 1 … 4 5 [6] 7 8 … 20 */
function pageItems(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const items: (number | 'gap')[] = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)
  if (start > 2) items.push('gap')
  for (let i = start; i <= end; i++) items.push(i)
  if (end < pageCount - 1) items.push('gap')
  items.push(pageCount)
  return items
}

const Arrow = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
  >
    <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
  </svg>
)

const btn =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'

/** Professional pagination control. Pairs with `DataTable`'s `pageSize`. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  totalItems,
  pageSize,
  className,
}: PaginationProps) {
  const go = (p: number) => onPageChange(Math.min(pageCount, Math.max(1, p)))

  const summary =
    totalItems != null && pageSize != null && totalItems > 0
      ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalItems)} of ${totalItems}`
      : totalItems != null
        ? `${totalItems} total`
        : null

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      {summary && <span className="text-xs text-slate-500">{summary}</span>}
      <nav className="ml-auto flex items-center gap-1" aria-label="Pagination">
        <button
          type="button"
          className={cn(btn, 'text-slate-300 hover:bg-slate-800 hover:text-slate-100')}
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <Arrow dir="left" />
        </button>

        {pageItems(page, pageCount).map((item, i) =>
          item === 'gap' ? (
            <span key={`gap-${i}`} className="px-1 text-slate-600">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => go(item)}
              aria-current={item === page ? 'page' : undefined}
              className={cn(
                btn,
                item === page
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
              )}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          className={cn(btn, 'text-slate-300 hover:bg-slate-800 hover:text-slate-100')}
          onClick={() => go(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          <Arrow dir="right" />
        </button>
      </nav>
    </div>
  )
}
