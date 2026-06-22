import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Spinner } from '@/shared/ui/Loading'
import { Avatar } from '@/features/chat/components/Avatar'
import { useContacts } from '@/features/chat/api/queries'

/** Searchable, checkable list of company users for building groups / adding members. */
export function ContactMultiSelect({
  selected,
  onToggle,
  excludeIds = [],
  presence,
}: {
  selected: number[]
  onToggle: (id: number) => void
  excludeIds?: number[]
  presence?: Set<number>
}) {
  const [search, setSearch] = useState('')
  const { data: contacts, isLoading } = useContacts(search)
  const exclude = new Set(excludeIds)
  const selectedSet = new Set(selected)
  const list = (contacts ?? []).filter((c) => !exclude.has(c.id))

  return (
    <div className="flex flex-col">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search people"
        className="mb-2 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <div className="scrollbar-styled max-h-64 overflow-y-auto rounded-lg border border-slate-700">
        {isLoading ? (
          <div className="grid h-24 place-items-center">
            <Spinner size="sm" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">No people found</p>
        ) : (
          list.map((c) => {
            const checked = selectedSet.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-slate-800/60"
              >
                <Avatar name={c.name} seed={c.id} size="sm" online={presence?.has(c.id)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{c.name}</div>
                  {c.email && <div className="truncate text-xs text-slate-500">{c.email}</div>}
                </div>
                <span
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded-[5px] border',
                    checked ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-600',
                  )}
                >
                  {checked && (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
