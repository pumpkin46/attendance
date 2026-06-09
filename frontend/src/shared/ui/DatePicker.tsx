import { useMemo, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Popover } from '@/shared/ui/Popover'

interface DatePickerProps {
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when `withTime` is set. Empty/undefined = unset. */
  value: string | undefined
  onChange: (value: string) => void
  /** Add a time field and emit `datetime-local` style values. */
  withTime?: boolean
  placeholder?: string
  disabled?: boolean
  required?: boolean
  /** Inclusive bounds as `YYYY-MM-DD`. */
  min?: string
  max?: string
  name?: string
  id?: string
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

/** Split a stored value into its date part (`YYYY-MM-DD`) and time part (`HH:mm`). */
function splitValue(value: string) {
  const [date = '', time = ''] = value.split('T')
  return { date, time }
}

/** Parse `YYYY-MM-DD` into numeric parts without timezone drift. */
function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) }
}

function formatDisplay(value: string, withTime: boolean): string {
  const { date, time } = splitValue(value)
  const parts = parseDate(date)
  if (!parts) return ''
  let out = `${MONTHS[parts.m].slice(0, 3)} ${parts.d}, ${parts.y}`
  if (withTime && time) out += ` · ${time}`
  return out
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

/**
 * Professional date (and optional time) picker with a calendar popover.
 * Replaces native `type="date"` / `type="datetime-local"` inputs.
 */
export function DatePicker({
  value,
  onChange,
  withTime = false,
  placeholder = withTime ? 'Pick date & time' : 'Pick a date',
  disabled,
  required,
  min,
  max,
  name,
  id,
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = value ?? ''
  const { date: datePart, time: timePart } = splitValue(current)

  // Month currently shown in the grid; tracks the selected value or today.
  const selected = parseDate(datePart)
  const today = useMemo(() => {
    const now = new Date()
    return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
  }, [])
  const [view, setView] = useState(() => ({
    y: selected?.y ?? today.y,
    m: selected?.m ?? today.m,
  }))

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay()
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const list: (number | null)[] = []
    for (let i = 0; i < first; i++) list.push(null)
    for (let d = 1; d <= daysInMonth; d++) list.push(d)
    return list
  }, [view])

  const outOfRange = (d: number) => {
    const iso = ymd(view.y, view.m, d)
    if (min && iso < min) return true
    if (max && iso > max) return true
    return false
  }

  const pick = (d: number) => {
    if (outOfRange(d)) return
    const date = ymd(view.y, view.m, d)
    if (withTime) {
      onChange(`${date}T${timePart || '09:00'}`)
    } else {
      onChange(date)
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const setTime = (time: string) => {
    const base = datePart || ymd(today.y, today.m, today.d)
    onChange(`${base}T${time || '00:00'}`)
  }

  const stepMonth = (delta: number) => {
    setView((v) => {
      const total = v.y * 12 + v.m + delta
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 }
    })
  }

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-left text-sm',
          'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
          open && 'border-blue-500 ring-1 ring-blue-500',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span className={cn('truncate', current ? 'text-slate-100' : 'text-slate-500')}>
          {current ? formatDisplay(current, withTime) : placeholder}
        </span>
        <CalendarIcon />
      </button>

      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={current}
          name={name}
          onChange={() => {}}
          onFocus={() => triggerRef.current?.focus()}
          className="pointer-events-none absolute bottom-0 left-3 h-0 w-0 opacity-0"
        />
      )}

      <Popover anchorRef={triggerRef} open={open} onClose={() => setOpen(false)} matchWidth={false}>
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

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d === null) return <div key={`b-${i}`} />
              const isSelected =
                selected && selected.y === view.y && selected.m === view.m && selected.d === d
              const isToday = today.y === view.y && today.m === view.m && today.d === d
              const disabledDay = outOfRange(d)
              return (
                <button
                  key={d}
                  type="button"
                  disabled={disabledDay}
                  onClick={() => pick(d)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors',
                    isSelected
                      ? 'bg-blue-600 font-semibold text-white'
                      : 'text-slate-200 hover:bg-slate-800',
                    !isSelected && isToday && 'ring-1 ring-inset ring-blue-500/60',
                    disabledDay && 'cursor-not-allowed opacity-30 hover:bg-transparent'
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>

          {withTime && (
            <div className="mt-3 flex items-center gap-2 border-t border-slate-700 pt-3">
              <span className="text-xs font-medium text-slate-400">Time</span>
              <input
                type="time"
                value={timePart}
                onChange={(e) => setTime(e.target.value)}
                className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 focus:border-blue-500 focus:outline-none [color-scheme:dark]"
              />
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-slate-700 pt-2">
            <button
              type="button"
              onClick={() => {
                const t = ymd(today.y, today.m, today.d)
                onChange(withTime ? `${t}T${timePart || '09:00'}` : t)
                setView({ y: today.y, m: today.m })
                if (!withTime) setOpen(false)
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-blue-400 hover:bg-slate-800"
            >
              Today
            </button>
            {current && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}
