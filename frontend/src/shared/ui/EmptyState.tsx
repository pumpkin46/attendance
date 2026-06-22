import { type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * Friendly placeholder for "no data yet" surfaces — an optional icon, a title,
 * a short description, and an optional call-to-action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon && (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-800 text-slate-400 [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      )}
      <div className="max-w-sm">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
