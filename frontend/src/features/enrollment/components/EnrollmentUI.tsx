import { cn } from '@/shared/lib/cn'

/** Numbered step badge used in section headers. */
export function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600/15 text-xs font-semibold text-blue-400 ring-1 ring-inset ring-blue-500/30">
      {children}
    </span>
  )
}

/** Card with a titled header bar, optional step number and subtitle. */
export function SectionCard({
  step,
  title,
  subtitle,
  actions,
  bodyClassName,
  className,
  children,
}: {
  step?: React.ReactNode
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-slate-700 bg-slate-900', className)}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div className="flex items-start gap-3">
          {step != null && <StepBadge>{step}</StepBadge>}
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

interface ToggleOption<T extends string> {
  key: T
  label: string
  icon?: React.ReactNode
}

/** Clean segmented control for picking the capture source. */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: ToggleOption<T>[]
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1">
      {options.map((opt) => {
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Thin progress bar. */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const AlertIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

/** Inline success / error banner for status messages. */
export function StatusAlert({ tone, children }: { tone: 'ok' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'ok'
          ? 'border-green-600/40 bg-green-500/10 text-green-300'
          : 'border-red-600/40 bg-red-500/10 text-red-300'
      )}
      role="status"
    >
      <span className="mt-0.5">{tone === 'ok' ? CheckIcon : AlertIcon}</span>
      <span>{children}</span>
    </div>
  )
}

export function WebcamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="11" r="4" />
      <path d="M12 15a7 7 0 0 0-7 5h14a7 7 0 0 0-7-5Z" />
    </svg>
  )
}

export function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
