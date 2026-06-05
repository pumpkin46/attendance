import { cn } from '@/shared/lib/cn'

export function Card({
  className,
  children,
  padding = true,
}: {
  className?: string
  children: React.ReactNode
  padding?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-700 bg-slate-900',
        padding && 'p-5',
        className
      )}
    >
      {children}
    </div>
  )
}
