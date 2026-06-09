import { Children, isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Popover } from '@/shared/ui/Popover'

export interface ComboboxOption {
  value: string
  label: string
  disabled?: boolean
}

interface ComboboxProps {
  value: string | undefined
  onChange: (value: string) => void
  /** Options as data. Alternatively pass `<option>` children. */
  options?: ComboboxOption[]
  /** `<option>` elements — supported so existing `<Select>` markup migrates cleanly. */
  children?: React.ReactNode
  placeholder?: string
  /** Force the search box on/off. Defaults to on when there are more than 7 options. */
  searchable?: boolean
  disabled?: boolean
  required?: boolean
  name?: string
  id?: string
  className?: string
  'aria-label'?: string
}

/** Flatten an option's children into plain label text (handles `Text {expr}` mixes). */
function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  return ''
}

/** Read `<option>` children into the option model. */
function optionsFromChildren(children: React.ReactNode): ComboboxOption[] {
  const out: ComboboxOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean }
    const value = props.value == null ? '' : String(props.value)
    const label = nodeText(props.children).trim() || value
    out.push({ value, label, disabled: props.disabled })
  })
  return out
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

/**
 * Professional, searchable dropdown that replaces a native `<select>`.
 * Keyboard accessible (arrows / Enter / Escape / type-to-search) and rendered
 * in a portal so it is never clipped.
 */
export function Combobox({
  value,
  onChange,
  options,
  children,
  placeholder = 'Select…',
  searchable,
  disabled,
  required,
  name,
  id,
  className,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const allOptions = useMemo(
    () => options ?? optionsFromChildren(children),
    [options, children]
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const showSearch = searchable ?? allOptions.length > 7
  const selected = allOptions.find((o) => o.value === value)

  const filtered = useMemo(() => {
    if (!query.trim()) return allOptions
    const q = query.toLowerCase()
    return allOptions.filter((o) => o.label.toLowerCase().includes(q))
  }, [allOptions, query])

  // Keep the highlighted row in view as it moves.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const openMenu = () => {
    if (disabled) return
    const idx = filtered.findIndex((o) => o.value === value)
    setActiveIndex(idx >= 0 ? idx : 0)
    setOpen(true)
    if (showSearch) requestAnimationFrame(() => searchRef.current?.focus())
  }

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const commit = (opt: ComboboxOption) => {
    if (opt.disabled) return
    onChange(opt.value)
    close()
    triggerRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[activeIndex]
      if (opt) commit(opt)
    } else if (e.key === 'Tab') {
      close()
    }
  }

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-left text-sm',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          open && 'border-blue-500 ring-1 ring-blue-500',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span className={cn('truncate', selected ? 'text-slate-100' : 'text-slate-500')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronIcon open={open} />
      </button>

      {/* Mirror value into a hidden field so HTML5 `required` validation works. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value ?? ''}
          name={name}
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
          className="pointer-events-none absolute bottom-0 left-3 h-0 w-0 opacity-0"
        />
      )}

      <Popover anchorRef={triggerRef} open={open} onClose={close}>
        {showSearch && (
          <div className="border-b border-slate-700 p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}
        <div
          ref={listRef}
          role="listbox"
          className="scrollbar-styled max-h-60 overflow-y-auto p-1"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-slate-500">No matches</div>
          ) : (
            filtered.map((opt, i) => {
              const isSelected = opt.value === value
              const isActive = i === activeIndex
              return (
                <div
                  key={`${opt.value}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(opt)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm',
                    opt.disabled && 'cursor-not-allowed opacity-50',
                    isActive ? 'bg-blue-600 text-white' : 'text-slate-200',
                    isSelected && !isActive && 'text-blue-400'
                  )}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 shrink-0"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              )
            })
          )}
        </div>
      </Popover>
    </div>
  )
}
