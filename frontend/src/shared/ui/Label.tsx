import { cn } from '@/shared/lib/cn'

export function Label({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cn('mb-4 flex flex-col gap-1.5 text-sm text-slate-400', className)}>
      {children}
    </label>
  )
}
