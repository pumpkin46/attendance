import { useId, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import type { AttendanceTrendDay } from '@/features/dashboard/types'

export interface DonutSegment {
  label: string
  value: number
  /** Raw CSS color (hex/rgb) used for the SVG stroke. */
  color: string
}

/**
 * Dependency-free SVG donut. Segments are drawn clockwise from 12 o'clock using
 * the stroke-dasharray technique; `center` is overlaid for a value/label readout.
 * Renders just the track ring when every segment is zero.
 */
export function Donut({
  segments,
  size = 184,
  thickness = 18,
  center,
  ariaLabel,
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  center?: ReactNode
  /** Overrides the auto label (built from non-zero slices) for richer a11y text. */
  ariaLabel?: string
}) {
  const r = (size - thickness) / 2
  const cx = size / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  const visibleSegments = segments.filter((s) => s.value > 0)
  // Thin separator between adjacent slices (skipped when a single slice fills the ring).
  const gap = visibleSegments.length > 1 ? 2 : 0

  let offset = 0
  const arcs = visibleSegments.map((s) => {
    const len = (s.value / total) * c
    // Never let the separator exceed half the slice, so tiny real slices stay visible.
    const drawn = Math.max(0.5, len - Math.min(gap, len * 0.5))
    const arc = (
      <circle
        key={s.label}
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={thickness}
        strokeDasharray={`${drawn} ${c - drawn}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
      />
    )
    offset += len
    return arc
  })

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={ariaLabel ?? visibleSegments.map((s) => `${s.label}: ${s.value}`).join(', ')}
      >
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgb(30 41 59)" strokeWidth={thickness} />
        <g transform={`rotate(-90 ${cx} ${cx})`}>{arcs}</g>
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  )
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Build a 4-interval axis whose ticks are evenly-spaced whole numbers, so the
 * labels line up exactly with the (evenly distributed) gridlines. The step is
 * rounded up to a nice integer (1/2/5 × 10^n, min 1); `max` is `step × 4`.
 */
function niceAxis(peak: number): { max: number; ticks: number[] } {
  const rawStep = Math.max(1, peak) / 4
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / pow
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow)
  return { max: step * 4, ticks: [4, 3, 2, 1, 0].map((i) => i * step) }
}

/**
 * Responsive stacked-bar trend of daily check-ins (on-time + late). Pure
 * CSS/flex bars — crisp labels at any width, no charting dependency. Days with
 * no check-ins keep a baseline tick so the axis stays uniform.
 */
export function AttendanceTrendChart({ data }: { data: AttendanceTrendDay[] }) {
  const labelId = useId()
  const peak = Math.max(0, ...data.map((d) => d.total))
  const { max: axisMax, ticks } = niceAxis(peak)

  return (
    <div aria-describedby={labelId}>
      <div className="flex gap-2">
        {/* Y axis — labels centered on each gridline, sharing the plot's height */}
        <div className="relative h-52 w-8 shrink-0">
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-slate-400"
              style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>

        <div className="relative h-52 min-w-0 flex-1">
          {/* Gridlines */}
          <div className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((_, i) => (
              <div key={i} className="border-t border-slate-800/70" />
            ))}
          </div>

          {/* Bars */}
          <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2.5">
            {data.map((d) => {
              const barPct = axisMax > 0 ? (d.total / axisMax) * 100 : 0
              const latePct = d.total > 0 ? (d.late / d.total) * 100 : 0
              const onTimePct = d.total > 0 ? (d.on_time / d.total) * 100 : 0
              const dayLabel = new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })
              return (
                <div
                  key={d.date}
                  title={`${dayLabel}: ${d.on_time} on-time, ${d.late} late`}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                >
                  {/* Full-height column highlight on hover */}
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-full max-w-[44px] -translate-x-1/2 rounded-md bg-slate-100/0 transition-colors group-hover:bg-slate-100/[0.04]" />
                  {d.total > 0 ? (
                    <div
                      className="relative mx-auto w-full max-w-[40px] overflow-hidden rounded-md shadow-sm"
                      style={{ height: `${barPct}%` }}
                    >
                      <div
                        className="absolute inset-x-0 top-0 bg-gradient-to-t from-amber-500 to-amber-400"
                        style={{ height: `${latePct}%` }}
                      />
                      <div
                        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 to-emerald-400"
                        style={{ height: `${onTimePct}%` }}
                      />
                    </div>
                  ) : (
                    <div className="mx-auto h-0.5 w-full max-w-[40px] rounded bg-slate-700" />
                  )}

                  {/* Tooltip */}
                  <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-left text-xs shadow-xl group-hover:block">
                    <div className="font-medium text-slate-100">{dayLabel}</div>
                    <div className="mt-0.5 tabular-nums text-slate-300">
                      <span className="text-emerald-400">{d.on_time} on-time</span>
                      {' · '}
                      <span className="text-amber-400">{d.late} late</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* X axis — leading spacer matches the Y-axis gutter so labels sit under the bars */}
      <div className="mt-2 flex gap-2">
        <div className="w-8 shrink-0" />
        <div className="flex min-w-0 flex-1 gap-1.5 sm:gap-2.5">
          {data.map((d) => (
            <div key={d.date} className="flex-1 text-center text-[11px] text-slate-400">
              {DOW[new Date(`${d.date}T00:00:00`).getDay()]}
            </div>
          ))}
        </div>
      </div>

      <span id={labelId} className="sr-only">
        Daily check-ins over the last {data.length} days, split into on-time and late.
        {data.map(
          (d) =>
            ` ${new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}: ${d.on_time} on-time, ${d.late} late.`
        )}
      </span>
    </div>
  )
}

/** Legend dot + label used beside charts. */
export function LegendItem({
  color,
  label,
  value,
  className,
}: {
  color: string
  label: string
  value?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 text-sm', className)}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-slate-400">{label}</span>
      {value != null && <span className="ml-auto font-medium tabular-nums text-slate-200">{value}</span>}
    </div>
  )
}
