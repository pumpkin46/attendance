import { forwardRef, useRef, type MutableRefObject } from 'react'
import { cn } from '@/shared/lib/cn'
import { inputClass } from '@/shared/lib/inputClass'

/** Hide the inconsistent native number spinners; we render our own. */
const HIDE_NATIVE_SPINNERS =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

function ChevronUp() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 15 12 9 18 15" />
    </svg>
  )
}
function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * Themed number input with custom step buttons. Native spinners are hidden and
 * replaced by a pair of chevron controls that drive the input via stepUp/Down,
 * dispatching an input event so controlled `onChange` handlers fire normally.
 */
const NumberInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function NumberInput({ className, disabled, ...props }, ref) {
    const innerRef = useRef<HTMLInputElement | null>(null)

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = node
    }

    const nudge = (dir: 1 | -1) => {
      const el = innerRef.current
      if (!el || el.disabled || el.readOnly) return
      // stepUp/Down respect min/max/step natively. They mutate the value without
      // going through React's tracked setter, so dispatching 'input' lets React
      // detect the change and call onChange with the new value.
      if (dir === 1) el.stepUp()
      else el.stepDown()
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.focus()
    }

    return (
      <div className="relative">
        <input
          ref={setRefs}
          type="number"
          disabled={disabled}
          className={cn(inputClass(className), HIDE_NATIVE_SPINNERS, 'pr-9')}
          {...props}
        />
        {!disabled && (
          <div className="absolute inset-y-px right-px flex w-7 flex-col divide-y divide-slate-600 overflow-hidden rounded-r-lg border-l border-slate-600">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Increase"
              onClick={() => nudge(1)}
              className="flex flex-1 items-center justify-center text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100 active:bg-slate-600"
            >
              <ChevronUp />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Decrease"
              onClick={() => nudge(-1)}
              className="flex flex-1 items-center justify-center text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100 active:bg-slate-600"
            >
              <ChevronDown />
            </button>
          </div>
        )}
      </div>
    )
  }
)

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    if (props.type === 'number') {
      return <NumberInput ref={ref} className={className} {...props} />
    }
    return <input ref={ref} className={inputClass(className)} {...props} />
  }
)

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={inputClass(className)} {...props} />
  }
)
