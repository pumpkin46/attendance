import { cn } from '@/shared/lib/cn'

type Tone = 'ok' | 'warn' | 'danger' | 'neutral'

const tones: Record<Tone, string> = {
  ok: 'bg-green-500/15 text-green-400',
  warn: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-red-500/15 text-red-400',
  neutral: 'bg-slate-500/15 text-slate-400',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
