import { useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Popover } from '@/shared/ui/Popover'

export interface DateRange {
  /** `YYYY-MM-DD`; empty string = unset bound. */
  from: string
  to: string
}

interface DateRangePickerProps {
  from: string | undefined
  to: string | undefined
  /** Both bounds emit together — picking a start clears the previous end. */
  onChange: (range: DateRange) => void
  placeholder?: string
  disabled?: boolean
  /** Inclusive bounds as `YYYY-MM-DD`. */
  min?: string
  max?: string
  className?: string
  'aria-label'?: string
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const isoOf = (d: Date) => ymd(d.getFullYear(), d.getMonth(), d.getDate())

/** Parse `YYYY-MM-DD` into numeric parts without timezone drift. */
function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

function fmtShort(iso: string, withYear: boolean): string {
  const p = parseDate(iso)
  if (!p) return ''
  return `${MONTHS[p.m].slice(0, 3)} ${p.d}${withYear ? `, ${p.y}` : ''}`
}

/** "Mar 3 – Mar 12, 2026" (year shown once when both bounds share it). */
function formatRange(from: string, to: string): string {
  if (from && to) {
    if (from === to) return fmtShort(from, true)
    const sameYear = from.slice(0, 4) === to.slice(0, 4)
    return `${fmtShort(from, !sameYear)} – ${fmtShort(to, true)}`
  }
  if (from) return `From ${fmtShort(from, true)}`
  if (to) return `Until ${fmtShort(to, true)}`
  return ''
}

const CalendarIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4 shrink-0 text-slate-400"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

const NavArrow = ({ dir }: { dir: 'left' | 'right' }) => (
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

function presets(): { label: string; range: DateRange }[] {
  const now = new Date()
  const today = isoOf(now)
  const daysAgo = (n: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - n)
    return isoOf(d)
  }
  const monthStart = ymd(now.getFullYear(), now.getMonth(), 1)
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  return [
    { label: 'Today', range: { from: today, to: today } },
    { label: 'Last 7 days', range: { from: daysAgo(6), to: today } },
    { label: 'Last 30 days', range: { from: daysAgo(29), to: today } },
    { label: 'This month', range: { from: monthStart, to: today } },
    {
      label: 'Last month',
      range: { from: isoOf(prevMonthStart), to: isoOf(prevMonthEnd) },
    },
  ]
}

/**
 * Range companion to {@link DatePicker}: one trigger, one calendar, two-click
 * selection (start, then end — clicking before the start swaps) plus
 * quick-range presets. Emits only committed ranges: the in-progress start is
 * internal state until the second click. Closing mid-selection commits an
 * open-ended `{from, to: ''}` range.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Date range',
  disabled,
  min,
  max,
  className,
  'aria-label': ariaLabel,
}: DateRangePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  // First click of an in-progress selection; not emitted until committed.
  const [pendingStart, setPendingStart] = useState<string | null>(null)
  // Day under the cursor while picking the end — previews the prospective range.
  const [hovered, setHovered] = useState<string | null>(null)

  const start = from ?? ''
  const end = to ?? ''
  const selectingEnd = pendingStart !== null

  const today = useMemo(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
  }, [])
  const anchor = parseDate(start) ?? today
  const [view, setView] = useState(() => ({ y: anchor.y, m: anchor.m }))

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay()
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const list: (number | null)[] = []
    for (let i = 0; i < first; i++) list.push(null)
    for (let d = 1; d <= daysInMonth; d++) list.push(d)
    return list
  }, [view])

  const outOfRange = (iso: string) => Boolean((min && iso < min) || (max && iso > max))

  const dismiss = () => {
    setOpen(false)
    setPendingStart(null)
    setHovered(null)
  }

  /** Close the popover; an in-progress start commits as an open-ended range. */
  const close = () => {
    if (pendingStart !== null) onChange({ from: pendingStart, to: '' })
    dismiss()
  }

  const openPopover = () => {
    if (disabled) return
    if (open) {
      close()
      return
    }
    const a = parseDate(start) ?? today
    setView({ y: a.y, m: a.m })
    setPendingStart(null)
    setHovered(null)
    setOpen(true)
  }

  const pick = (d: number) => {
    const iso = ymd(view.y, view.m, d)
    if (outOfRange(iso)) return
    if (pendingStart === null) {
      // Start a new selection (also when both bounds were already set).
      setPendingStart(iso)
      return
    }
    // Second click completes the range; clicking before the start swaps.
    onChange(
      iso < pendingStart ? { from: iso, to: pendingStart } : { from: pendingStart, to: iso }
    )
    dismiss()
    triggerRef.current?.focus()
  }

  const applyPreset = (range: DateRange) => {
    onChange(range)
    dismiss()
    triggerRef.current?.focus()
  }

  const clear = () => {
    onChange({ from: '', to: '' })
    dismiss()
  }

  const stepMonth = (delta: number) => {
    setView((v) => {
      const total = v.y * 12 + v.m + delta
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }
    })
  }

  // Effective highlight band: the committed range, or pending-start→hover while picking.
  const bandFrom = pendingStart ?? start
  const bandTo = pendingStart !== null
    ? hovered && hovered > pendingStart
      ? hovered
      : ''
    : end

  const display = formatRange(start, end)
  // Cheap enough to compute every render; keeps "today" honest across midnight.
  const presetList = presets()

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={openPopover}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-left text-sm',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          open && 'border-blue-500 ring-1 ring-blue-500',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span className={cn('truncate', display ? 'text-slate-100' : 'text-slate-500')}>
          {display || placeholder}
        </span>
        <CalendarIcon />
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={close} matchWidth={false}>
        <div className="flex">
          <div className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-slate-700 p-2">
            {presetList.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.range)}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                  start === p.range.from && end === p.range.to
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="w-[17rem] p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => stepMonth(-1)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Previous month"
              >
                <NavArrow dir="left" />
              </button>
              <div className="text-sm font-semibold text-slate-100">
                {MONTHS[view.m]} {view.y}
              </div>
              <button
                type="button"
                onClick={() => stepMonth(1)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                aria-label="Next month"
              >
                <NavArrow dir="right" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1 text-center text-xs font-medium text-slate-500">
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHovered(null)}>
              {cells.map((d, i) => {
                if (d === null) return <div key={`b-${i}`} />
                const iso = ymd(view.y, view.m, d)
                const isStart = iso === bandFrom
                const isEnd = Boolean(bandTo) && iso === bandTo
                const inBand =
                  Boolean(bandFrom && bandTo) && iso > bandFrom && iso < bandTo
                const isToday = today.y === view.y && today.m === view.m && today.d === d
                const disabledDay = outOfRange(iso)
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={disabledDay}
                    onClick={() => pick(d)}
                    onMouseEnter={() => selectingEnd && setHovered(iso)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors',
                      isStart || isEnd
                        ? 'bg-blue-600 font-semibold text-white'
                        : inBand
                          ? 'bg-blue-500/15 text-slate-100 hover:bg-blue-500/25'
                          : 'text-slate-200 hover:bg-slate-800',
                      !isStart && !isEnd && isToday && 'ring-1 ring-inset ring-blue-500/60',
                      disabledDay && 'cursor-not-allowed opacity-30 hover:bg-transparent'
                    )}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-700 pt-2">
              <span className="text-xs text-slate-500">
                {selectingEnd ? 'Pick an end date' : 'Pick a start date'}
              </span>
              {(start || end) && (
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  )
}
