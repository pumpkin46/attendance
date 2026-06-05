import { cn } from '@/shared/lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: string
}

/** Accessible tablist (role=tab / aria-selected) with keyboard arrow support. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const dir = e.key === 'ArrowRight' ? 1 : -1
    const next = (index + dir + tabs.length) % tabs.length
    onChange(tabs[next].id)
  }

  return (
    <div
      role="tablist"
      className={cn('mb-6 flex flex-wrap gap-2 border-b border-slate-700 pb-3', className)}
    >
      {tabs.map((t, i) => {
        const selected = value === t.id
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            type="button"
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition',
              selected
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
