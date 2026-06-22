import { cn } from '@/shared/lib/cn'

/** Labeled form field: title (+ required mark) with an optional right-aligned hint. */
export function Field({
  label,
  hint,
  htmlFor,
  required,
  autoFocus,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  required?: boolean
  /** Marks this field so the host SidePanel focuses its control on open. */
  autoFocus?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5" data-autofocus={autoFocus || undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-200">
          {label}
          {required && <span className="text-blue-400"> *</span>}
        </label>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** Accessible on/off toggle switch. */
export function Switch({
  checked,
  onChange,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
        checked ? 'bg-blue-600' : 'bg-slate-700'
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

/** Setting-row wrapper: title + description on the left, control on the right. */
export function ToggleRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-200">{title}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
      {children}
    </div>
  )
}
