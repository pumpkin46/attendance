import { cn } from '@/shared/lib/cn'

const spinnerSize = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-9 w-9',
  xl: 'h-12 w-12',
} as const

/**
 * Professional ring spinner: a faint full track with a spinning accent arc.
 * Inherits `currentColor`, so set the colour via a text-* class.
 */
export function Spinner({
  size = 'md',
  className,
}: {
  size?: keyof typeof spinnerSize
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
      className={cn('animate-spin text-blue-500', spinnerSize[size], className)}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.18" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Centered loading state with a spinner and optional label. Use `fullScreen`
 * for app-boot / auth gates and the default (fills its container) for route
 * suspense fallbacks and in-page loads.
 */
export function Loading({
  label = 'Loading…',
  fullScreen = false,
  className,
}: {
  label?: string
  fullScreen?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid place-items-center',
        fullScreen ? 'min-h-screen' : 'h-full min-h-[16rem]',
        className
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        {label && <p className="text-sm text-slate-400">{label}</p>}
      </div>
    </div>
  )
}
