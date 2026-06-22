import { useState } from 'react'
import { OrgNodeCheckboxTree } from '@/features/users/components/OrgNodeCheckboxTree'
import type { OrgNode } from '@/features/security/types'

const s = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const SitemapIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...s}>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-2h12v2" />
  </svg>
)
const SearchIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-500" {...s}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)
const XIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" {...s}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const InfoIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" {...s}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
)

/**
 * Premium organization-access picker for the user editor: a header with the live
 * selected count + clear, a filter box, and the checkbox tree — or an
 * "unrestricted" banner when the user holds a super-admin role.
 */
export function OrgAccessField({
  tree,
  selectedIds,
  onToggle,
  onClear,
  loading,
  unrestricted = false,
}: {
  tree: OrgNode[]
  selectedIds: number[]
  onToggle: (id: number) => void
  onClear: () => void
  loading?: boolean
  /** The user has full access (super admin) — org grants don't apply. */
  unrestricted?: boolean
}) {
  const [query, setQuery] = useState('')
  const count = selectedIds.length

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-300">
            {SitemapIcon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Organization access</h3>
            <p className="text-xs text-slate-500">Grant a unit and everything beneath it.</p>
          </div>
        </div>
        {!unrestricted && (
          <div className="flex shrink-0 items-center gap-2">
            {count > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="cursor-pointer rounded px-1.5 py-0.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                Clear
              </button>
            )}
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
              {count} selected
            </span>
          </div>
        )}
      </header>

      {unrestricted ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-200/90">
          <span className="text-amber-300">{InfoIcon}</span>
          <p className="text-sm">
            This user has <span className="font-semibold">Super Admin</span> — they can access every
            organization, so individual grants aren&apos;t needed.
          </p>
        </div>
      ) : (
        <>
          {!loading && tree.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/60 px-2.5 py-1.5 transition-colors focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/40">
              {SearchIcon}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter units…"
                aria-label="Filter organization units"
                className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear filter"
                  className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
                >
                  {XIcon}
                </button>
              )}
            </div>
          )}
          <OrgNodeCheckboxTree
            tree={tree}
            selectedIds={selectedIds}
            onToggle={onToggle}
            loading={loading}
            query={query}
          />
        </>
      )}
    </section>
  )
}
