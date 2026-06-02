import { cn } from '../../lib/cn'
import { Card } from './Card'

export function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: 'warn' | 'danger'
}) {
  return (
    <Card>
      <span className="block text-xs text-slate-400">{label}</span>
      <span
        className={cn(
          'mt-1 block text-3xl font-semibold',
          tone === 'warn' && 'text-amber-400',
          tone === 'danger' && 'text-red-400'
        )}
      >
        {value}
      </span>
    </Card>
  )
}
