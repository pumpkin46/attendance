import { forwardRef, type MutableRefObject } from 'react'
import { useMaskedDigits } from '@/shared/hooks/useMaskedDigits'
import { cn } from '@/shared/lib/cn'
import { formatIdNumber } from '@/shared/lib/format'
import { inputClass } from '@/shared/lib/inputClass'

const IdCardIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <circle cx="8" cy="11" r="2" />
    <path d="M5.5 16c.4-1.3 1.4-2 2.5-2s2.1.7 2.5 2M14 9h5M14 12.5h5M14 16h3" />
  </svg>
)

interface IdNumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Formatted value, e.g. "12 345678" or "123 4567890" (or a partial prefix while typing). */
  value: string
  onChange: (value: string) => void
}

/**
 * ID number input that formats while typing: `xx xxxxxx` for 8-digit IDs,
 * reflowing to `xxx xxxxxxx` once a 9th digit arrives (10 digits max).
 *
 * - Accepts messy paste ("12-345678" → "12 345678"); strips non-digits.
 * - Preserves the caret across reformatting, so editing mid-value behaves.
 * - Backspacing over the space deletes the digit before it (no stuck gap).
 * - With `required`, native validation enforces one of the two complete formats.
 *
 * Keep this component for every ID-number field: blacklist screening matches
 * on the exact stored string, so all entry points must format identically.
 */
export const IdNumberInput = forwardRef<HTMLInputElement, IdNumberInputProps>(
  function IdNumberInput({ value, onChange, className, ...props }, ref) {
    const { innerRef, handleChange } = useMaskedDigits(value, onChange, formatIdNumber)

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = node
    }

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
          {IdCardIcon}
        </span>
        <input
          ref={setRefs}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="12 345678"
          pattern="([0-9]{2} [0-9]{6}|[0-9]{3} [0-9]{7})"
          title="Format: 12 345678 or 123 4567890"
          value={value}
          onChange={handleChange}
          className={cn(inputClass(className), 'pl-9')}
          {...props}
        />
      </div>
    )
  }
)
