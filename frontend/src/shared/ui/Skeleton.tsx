import { cn } from '@/shared/lib/cn'

/** Animated placeholder shown while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-slate-800', className)} />
}

/** A StatCard-shaped skeleton used by dashboards. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-8 w-12" />
    </div>
  )
}
