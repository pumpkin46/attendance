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

export function AppLogo({ size = 'md', showText = false, className }: AppLogoProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <img
        src="/app-icon.png"
        alt=""
        width={64}
        height={64}
        className={cn('shrink-0 rounded-full object-cover', sizeClass[size])}
      />
      {showText && (
        <div className="min-w-0">
          <span className="block truncate text-base font-semibold text-slate-100">
            Attendance Platform
          </span>
          <span className="block truncate text-xs text-slate-500">Face & RFID access</span>
        </div>
      )}
    </div>
  )
}
