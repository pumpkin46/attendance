import { forwardRef } from 'react'
import { useMaskedDigits } from '@/shared/hooks/useMaskedDigits'
import { cn } from '@/shared/lib/cn'
import { formatPhone } from '@/shared/lib/format'
import { inputClass } from '@/shared/lib/inputClass'

const PhoneIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" />
  </svg>
)

interface PhoneInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Formatted value, e.g. "555-123-4567" (or a partial prefix while typing). */
  value: string
  onChange: (value: string) => void
}

/**
 * Phone number input that formats as `xxx-xxx-xxxx` while typing.
 *
 * - Accepts messy paste ("(555) 123 4567" → "555-123-4567"); caps at 10 digits.
 * - Preserves the caret across reformatting, so editing mid-value behaves.
 * - Backspacing over a dash deletes the digit before it (no stuck dash).
 * - With `required`, native validation enforces the complete format.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, className, ...props },
  ref
) {
  const { innerRef, handleChange } = useMaskedDigits(value, onChange, formatPhone)

  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref).current = node
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
        {PhoneIcon}
      </span>
      <input
        ref={setRefs}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="555-123-4567"
        pattern="[0-9]{3}-[0-9]{3}-[0-9]{4}"
        title="Format: 555-123-4567"
        value={value}
        onChange={handleChange}
        className={cn(inputClass(className), 'pl-9')}
        {...props}
      />
    </div>
  )
})
