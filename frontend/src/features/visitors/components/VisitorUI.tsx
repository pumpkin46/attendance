import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { initials } from '@/shared/lib/format'
import { Card } from '@/shared/ui/Card'

export type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'

const toneText: Record<Tone, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  danger: 'text-red-400',
  accent: 'text-blue-400',
  neutral: 'text-slate-100',
}
const toneChip: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-red-500/15 text-red-400',
  accent: 'bg-blue-500/15 text-blue-400',
  neutral: 'bg-slate-700/50 text-slate-400',
}

const AVATAR_TONES = [
  'bg-blue-500/15 text-blue-300',
  'bg-emerald-500/15 text-emerald-300',
  'bg-violet-500/15 text-violet-300',
  'bg-amber-500/15 text-amber-300',
  'bg-rose-500/15 text-rose-300',
  'bg-cyan-500/15 text-cyan-300',
]

export function VisitorAvatar({ name, seed }: { name: string; seed: number }) {
  const tone = AVATAR_TONES[Math.abs(seed) % AVATAR_TONES.length]
  return (
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold', tone)}>
      {initials(name)}
    </span>
  )
}

/** Avatar + name + optional secondary lines, used in every visitor table. */
export function VisitorCell({
  name,
  seed,
  sub,
  code,
}: {
  name: string
  seed: number
  sub?: ReactNode
  code?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <VisitorAvatar name={name} seed={seed} />
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-100">{name}</div>
        {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
        {code && <div className="truncate font-mono text-xs text-slate-600">{code}</div>}
      </div>
    </div>
  )
}

/** Icon KPI tile shared across the visitor dashboard. */
export function Kpi({
  label,
  value,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: ReactNode
  tone?: Tone
  icon: ReactNode
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-lg', toneChip[tone])}>{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className={cn('text-2xl font-semibold leading-tight', toneText[tone])}>{value}</div>
      </div>
    </Card>
  )
}
