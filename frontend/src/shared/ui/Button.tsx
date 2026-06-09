import { forwardRef } from 'react'
import { cn } from '@/shared/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
type Size = 'sm' | 'md' | 'lg' | 'icon'

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium ' +
  'transition-all duration-150 active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ' +
  'disabled:pointer-events-none disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary:
    'bg-blue-600 text-white shadow-sm shadow-blue-950/40 hover:bg-blue-500 active:bg-blue-700 focus-visible:ring-blue-500',
  secondary:
    'bg-slate-700 text-slate-100 shadow-sm hover:bg-slate-600 active:bg-slate-700 focus-visible:ring-slate-500',
  ghost:
    'border border-slate-600 bg-transparent text-slate-300 hover:border-slate-500 hover:bg-slate-800/60 hover:text-slate-100 active:bg-slate-800 focus-visible:ring-slate-500',
  danger:
    'bg-red-600 text-white shadow-sm shadow-red-950/40 hover:bg-red-500 active:bg-red-700 focus-visible:ring-red-500',
  success:
    'bg-emerald-600 text-white shadow-sm shadow-emerald-950/40 hover:bg-emerald-500 active:bg-emerald-700 focus-visible:ring-emerald-500',
  outline:
    'border border-blue-600 bg-transparent text-blue-400 hover:bg-blue-600/10 hover:text-blue-300 active:bg-blue-600/20 focus-visible:ring-blue-500',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
  icon: 'h-10 w-10 p-0',
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  fullWidth?: boolean
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...props}
    >
      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-2', isLoading && 'invisible')}>
        {leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
        {children}
        {rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
      </span>
    </button>
  )
})
