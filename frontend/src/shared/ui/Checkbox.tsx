import { forwardRef } from 'react'
import { cn } from '@/shared/lib/cn'

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Optional inline label rendered to the right of the box. */
  label?: React.ReactNode
  /** Secondary muted text shown beneath the label. */
  description?: React.ReactNode
}

/**
 * Accessible, professionally styled checkbox. Uses a native checkbox under the
 * hood (so `checked`/`onChange`/keyboard/forms all work) with a custom check
 * mark drawn on top.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, label, description, disabled, ...props },
  ref
) {
  const box = (
    <span className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className={cn(
          'peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border border-slate-600 bg-slate-800 transition-colors',
          'hover:border-slate-500',
          'checked:border-blue-600 checked:bg-blue-600 checked:hover:bg-blue-500',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute h-3 w-3 scale-0 text-white transition-transform duration-100 peer-checked:scale-100"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  )

  if (label === undefined && description === undefined) return box

  return (
    <label
      className={cn(
        'inline-flex select-none items-start gap-2.5 text-sm text-slate-300',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
    >
      {box}
      <span className="flex flex-col gap-0.5 leading-tight">
        {label !== undefined && <span>{label}</span>}
        {description !== undefined && <span className="text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  )
})
