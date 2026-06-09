import { cn } from '@/shared/lib/cn'

const sizeClass = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
} as const

type AppLogoProps = {
  size?: keyof typeof sizeClass
  showText?: boolean
  className?: string
}

/**
 * Scalable brand mark: a gradient badge with face-recognition viewfinder
 * brackets, a person silhouette, and a "verified access" check — rendered as
 * crisp SVG so it stays sharp at any size.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Attendance Platform"
      className={cn('shrink-0 drop-shadow-sm', className)}
    >
      <defs>
        <linearGradient id="appLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      <rect x="3" y="3" width="42" height="42" rx="12" fill="url(#appLogoGrad)" />

      {/* Recognition viewfinder brackets */}
      <g
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 13 H15 A2 2 0 0 0 13 15 V17" />
        <path d="M31 13 H33 A2 2 0 0 1 35 15 V17" />
        <path d="M17 35 H15 A2 2 0 0 1 13 33 V31" />
      </g>

      {/* Person silhouette */}
      <circle cx="24" cy="20" r="4.3" fill="#ffffff" />
      <path d="M15.5 31.8 C15.5 27 19.4 25 24 25 C28.6 25 32.5 27 32.5 31.8 Z" fill="#ffffff" />

      {/* Verified-access check badge */}
      <circle cx="34" cy="34" r="6.8" fill="#ffffff" />
      <circle cx="34" cy="34" r="5.4" fill="#22c55e" />
      <path
        d="M31.4 34.1 L33.2 35.9 L36.7 32.2"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AppLogo({ size = 'md', showText = false, className }: AppLogoProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <LogoMark className={sizeClass[size]} />
      {showText && (
        <div className="min-w-0">
          <span className="block truncate text-base font-semibold text-slate-100">
            Attendance Platform
          </span>
          <span className="block truncate text-xs text-slate-500">Face &amp; RFID access</span>
        </div>
      )}
    </div>
  )
}
