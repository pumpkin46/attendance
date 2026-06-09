import { forwardRef } from 'react'
import { cn } from '@/shared/lib/cn'

interface SearchBoxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: string
  onChange: (value: string) => void
  /** Called when the user presses Enter. */
  onSearch?: (value: string) => void
  /** Show the clear (×) button when there is text. Defaults to true. */
  clearable?: boolean
}

export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { value, onChange, onSearch, clearable = true, placeholder = 'Search…', className, ...props },
  ref
) {
  return (
    <div className={cn('relative', className)}>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <input
        ref={ref}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSearch?.(value)
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          }
        }}
        className={cn(
          'w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-9 text-sm text-slate-100',
          'placeholder:text-slate-500 transition-colors',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          '[&::-webkit-search-cancel-button]:appearance-none',
          clearable && value ? 'pr-9' : 'pr-3'
        )}
        {...props}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
})
