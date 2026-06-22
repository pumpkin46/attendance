import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Skeleton } from '@/shared/ui/Skeleton'
import { cn } from '@/shared/lib/cn'
import { prefetchRoute } from '@/app/routes'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import {
  useAttendanceTrend,
  useMonitoringDashboard,
  useMonitoringFeed,
  useMonitoringLiveFeed,
} from '@/features/dashboard/api/queries'
import { LiveEventDetailPanel } from '@/features/dashboard/components/LiveEventDetail'
import { AttendanceTrendChart, Donut, LegendItem } from '@/features/dashboard/components/charts'
import { eventTone } from '@/features/dashboard/lib'
import type { LiveEvent } from '@/features/dashboard/types'

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral'

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
  neutral: 'bg-slate-700/50 text-slate-300',
}
// Inset ring + a faint corner glow give the KPI tiles subtle depth on the dark surface.
const toneRing: Record<Tone, string> = {
  ok: 'ring-emerald-500/20',
  warn: 'ring-amber-500/20',
  danger: 'ring-red-500/20',
  accent: 'ring-blue-500/20',
  neutral: 'ring-slate-600/30',
}
const toneGlow: Record<Tone, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  danger: '#ef4444',
  accent: '#3b82f6',
  neutral: '#64748b',
}

// Shared chart palette (raw CSS colors for SVG/legend dots).
const CHART = {
  onTime: '#34d399', // emerald-400
  late: '#fbbf24', // amber-400
  onLeave: '#60a5fa', // blue-400
  absent: '#f87171', // red-400
}

const ico = 'h-5 w-5'
const sIco = 'h-4 w-4'
const CameraIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" /><circle cx="12" cy="12.5" r="3.2" />
  </svg>
)
const PresentIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5 1 0 2 .2 2.8.6M16 18l2 2 4-4" />
  </svg>
)
const WorkforceIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="2.2" /><path d="M5.8 16c.3-1.6 1.7-2.6 3.2-2.6s2.9 1 3.2 2.6" /><path d="M14.5 9h4M14.5 12.5h4" />
  </svg>
)
const FaceScanIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="11" r="2.3" /><path d="M8.6 16.2c.6-1.4 1.9-2.2 3.4-2.2s2.8.8 3.4 2.2" />
  </svg>
)
const ClockIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
)
const AlertIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" />
  </svg>
)
const VisitorIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.2" /><path d="M2 20c0-3 2.5-5 6-5s6 2 6 5M15 20c0-2 1-3.5 3-3.5" />
  </svg>
)
const CalendarIcon = (
  <svg viewBox="0 0 24 24" className={sIco} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" />
  </svg>
)
const ChartIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><path d="M7 14v3M12 9v8M17 12v5" />
  </svg>
)
const PieIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 3v9l7 4" />
  </svg>
)
const ActivityIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h4l2 6 4-14 2 8h6" />
  </svg>
)

// Per-event-tone glyphs for the live feed.
const eventGlyph: Record<Tone, ReactNode> = {
  ok: (
    <svg viewBox="0 0 24 24" className={sIco} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  ),
  danger: (
    <svg viewBox="0 0 24 24" className={sIco} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
  ),
  warn: (
    <svg viewBox="0 0 24 24" className={sIco} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8.8a14 14 0 0 1 20 0M5 12.5a9 9 0 0 1 14 0M12 19h.01M8.5 16a5 5 0 0 1 7 0" /></svg>
  ),
  accent: <span className="h-2 w-2 rounded-full bg-current" />,
  neutral: <span className="h-2 w-2 rounded-full bg-current" />,
}

function LivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      Live
    </span>
  )
}

function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
  to,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  icon: ReactNode
  /** Drill-down destination — makes the whole card a link. */
  to?: string
}) {
  const card = (
    <Card
      className={cn(
        'group relative flex h-full items-center gap-4 overflow-hidden shadow-sm transition-all duration-200',
        to && 'hover:-translate-y-0.5 hover:border-slate-600 hover:shadow-lg hover:shadow-black/30'
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full opacity-[0.08] blur-2xl transition-opacity duration-200 group-hover:opacity-[0.16]"
        style={{ backgroundColor: toneGlow[tone] }}
      />
      <span
        className={cn(
          'relative grid h-12 w-12 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
          toneChip[tone],
          toneRing[tone]
        )}
      >
        {icon}
      </span>
      <div className="relative min-w-0">
        <div className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className={cn('mt-0.5 text-2xl font-semibold leading-tight tracking-tight tabular-nums', toneText[tone])}>
          {value}
        </div>
        {sub != null && <div className="mt-0.5 truncate text-xs text-slate-400">{sub}</div>}
      </div>
    </Card>
  )
  if (!to) return card
  return (
    <Link
      to={to}
      aria-label={`View ${label} details`}
      onMouseEnter={() => prefetchRoute(to.split('?')[0])}
      className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {card}
    </Link>
  )
}

/** Card header with an optional leading icon, a title, and right-aligned meta. */
function SectionHeader({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-400">
            {icon}
          </span>
        )}
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      </div>
      {children && <div className="flex items-center gap-2 text-sm">{children}</div>}
    </div>
  )
}

/** Loading placeholder shaped like the horizontal Kpi card (avoids layout shift). */
function KpiSkeleton() {
  return (
    <Card className="flex h-full items-center gap-4">
      <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-6 w-12" />
      </div>
    </Card>
  )
}

function timeAgo(iso: string) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString()
}

export default function DashboardPage() {
  // Live counters stream over a WebSocket (pushed every ~3s) and write straight
  // into the query cache. Realtime events still resync on reconnect, and HTTP
  // polling stays as a fallback only while the socket is down.
  useMonitoringFeed()
  const poll = useFallbackPoll(60_000)
  const { data: dashboard } = useMonitoringDashboard(poll)
  const { data: liveFeed } = useMonitoringLiveFeed(poll)
  const { data: trend } = useAttendanceTrend(7)
  const events = liveFeed?.events ?? []

  // Selected event stays set while the panel animates closed (SidePanel
  // contract), so the content doesn't blank out mid-slide.
  const [selectedEvent, setSelectedEvent] = useState<LiveEvent | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const openEvent = (e: LiveEvent) => {
    setSelectedEvent(e)
    setDetailOpen(true)
  }

  const cameras = dashboard?.cameras ?? []
  const health = dashboard?.camera_health
  const today = new Date().toISOString().slice(0, 10)
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  // Derived attendance composition for the donut (segments sum to total_employees).
  const present = dashboard?.employees_present ?? 0
  const late = dashboard?.employees_late ?? 0
  const onLeave = dashboard?.employees_on_leave ?? 0
  const absent = dashboard?.employees_absent ?? 0
  const totalEmployees = dashboard?.total_employees ?? 0
  const onTime = Math.max(0, present - late)
  const attendanceRate = totalEmployees > 0 ? Math.round((present / totalEmployees) * 100) : null
  const attendanceTone: Tone =
    attendanceRate == null ? 'neutral' : attendanceRate >= 90 ? 'ok' : attendanceRate >= 75 ? 'warn' : 'danger'

  const recognitionsToday = cameras.reduce((sum, c) => sum + (c.recognition_count_today ?? 0), 0)
  const trendDays = trend?.days ?? []
  const weekTotal = trendDays.reduce((sum, d) => sum + d.total, 0)
  const weekLate = trendDays.reduce((sum, d) => sum + d.late, 0)
  const weekOnTimeRate = weekTotal > 0 ? Math.round(((weekTotal - weekLate) / weekTotal) * 100) : null

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live overview of attendance, camera health, and security events."
        actions={
          <>
            <LivePill />
            <span className="hidden items-center gap-1.5 text-sm text-slate-400 sm:inline-flex">
              {CalendarIcon}
              {todayLabel}
            </span>
          </>
        }
      />

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
        {!dashboard ? (
          Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
        ) : (
          <>
            <Kpi
              label="Workforce"
              value={totalEmployees}
              sub="Active employees"
              icon={WorkforceIcon}
              to="/employees"
            />
            <Kpi
              label="Attendance rate"
              value={attendanceRate != null ? `${attendanceRate}%` : '—'}
              sub={`${present} of ${totalEmployees} present`}
              tone={attendanceTone}
              icon={PresentIcon}
              to="/attendance?status=present"
            />
            <Kpi
              label="Active cameras"
              value={`${dashboard.active_cameras}/${dashboard.total_cameras}`}
              sub={(health?.offline ?? 0) > 0 ? `${health?.offline} offline` : 'All online'}
              icon={CameraIcon}
              tone="accent"
              to="/cameras?filter=online"
            />
            <Kpi
              label="Recognitions today"
              value={recognitionsToday}
              sub="Face scans today"
              tone="accent"
              icon={FaceScanIcon}
              to="/recognition-engine"
            />
            <Kpi
              label="Unknown today"
              value={dashboard.unknown_persons_today}
              sub={dashboard.unknown_persons_today > 0 ? 'Needs review' : 'All clear'}
              tone="danger"
              icon={AlertIcon}
              to={`/unknown-faces?from=${today}&to=${today}`}
            />
            <Kpi label="Active visitors" value={dashboard.active_visitors} sub="On site" icon={VisitorIcon} to="/visitors?tab=active" />
          </>
        )}
      </div>

      {/* Attendance analytics row */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        {/* Check-in trend */}
        <Card className="lg:col-span-2">
          <SectionHeader title="Check-in trend" icon={ChartIcon}>
            <span className="text-xs text-slate-400">Last 7 days</span>
            <span className="ml-2 flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART.onTime }} /> On time
              </span>
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART.late }} /> Late
              </span>
            </span>
          </SectionHeader>

          <div className="mb-5 grid grid-cols-3 divide-x divide-slate-800">
            <div className="pr-4">
              <div className="text-2xl font-semibold tabular-nums text-slate-100">{weekTotal}</div>
              <div className="text-xs text-slate-400">Check-ins this week</div>
            </div>
            <div className="px-4">
              <div className="text-2xl font-semibold tabular-nums text-amber-400">{weekLate}</div>
              <div className="text-xs text-slate-400">Late arrivals</div>
            </div>
            <div className="px-4">
              <div className="text-2xl font-semibold tabular-nums text-emerald-400">
                {weekOnTimeRate != null ? `${weekOnTimeRate}%` : '—'}
              </div>
              <div className="text-xs text-slate-400">On-time rate</div>
            </div>
          </div>

          {trend ? (
            <AttendanceTrendChart data={trendDays} />
          ) : (
            <div className="h-52 animate-pulse rounded-lg bg-slate-800/40" />
          )}
        </Card>

        {/* Today's attendance donut */}
        <Card className="lg:col-span-1">
          <SectionHeader title="Today's attendance" icon={PieIcon} />
          <div className="flex flex-col items-center gap-5">
            <Donut
              ariaLabel={`Today's attendance: ${
                attendanceRate != null ? `${attendanceRate}% present` : 'no active employees'
              }. On time ${onTime}, late ${late}, on leave ${onLeave}, absent ${absent}.`}
              segments={[
                { label: 'On time', value: onTime, color: CHART.onTime },
                { label: 'Late', value: late, color: CHART.late },
                { label: 'On leave', value: onLeave, color: CHART.onLeave },
                { label: 'Absent', value: absent, color: CHART.absent },
              ]}
              center={
                <div>
                  <div className="text-3xl font-semibold tabular-nums text-slate-100">{present}</div>
                  <div className="text-xs text-slate-400">of {totalEmployees} present</div>
                </div>
              }
            />
            <div className="w-full space-y-2.5">
              <LegendItem color={CHART.onTime} label="On time" value={onTime} />
              <LegendItem color={CHART.late} label="Late" value={late} />
              <LegendItem color={CHART.onLeave} label="On leave" value={onLeave} />
              <LegendItem color={CHART.absent} label="Absent" value={absent} />
            </div>
          </div>
        </Card>
      </div>

      {/* Operations row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Camera health */}
        <Card className="lg:col-span-1">
          <SectionHeader title="Camera health" icon={CameraIcon}>
            <Link
              to="/cameras"
              onMouseEnter={() => prefetchRoute('/cameras')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              View all
            </Link>
          </SectionHeader>

          {/* Online ratio bar */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-slate-400">Fleet status</span>
              <span className="font-medium tabular-nums text-slate-200">
                {health?.online ?? 0}/{(health?.online ?? 0) + (health?.offline ?? 0)} online
              </span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="bg-emerald-400"
                style={{
                  width: `${
                    ((health?.online ?? 0) / Math.max(1, (health?.online ?? 0) + (health?.offline ?? 0))) * 100
                  }%`,
                }}
              />
              <div className="flex-1 bg-slate-600" />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-800/40 px-2 py-2.5 ring-1 ring-inset ring-white/5">
              <div className="text-lg font-semibold tabular-nums text-slate-100">{health?.avg_fps?.toFixed(1) ?? '—'}</div>
              <div className="text-[11px] text-slate-400">Avg FPS</div>
            </div>
            <div className="rounded-lg bg-slate-800/40 px-2 py-2.5 ring-1 ring-inset ring-white/5">
              <div className="text-lg font-semibold tabular-nums text-slate-100">
                {health?.avg_latency_ms != null ? `${health.avg_latency_ms}` : '—'}
                {health?.avg_latency_ms != null && <span className="text-xs text-slate-400">ms</span>}
              </div>
              <div className="text-[11px] text-slate-400">Latency</div>
            </div>
            <div className="rounded-lg bg-slate-800/40 px-2 py-2.5 ring-1 ring-inset ring-white/5">
              <div className="text-lg font-semibold tabular-nums text-slate-100">
                {health?.total_dropped_frames ?? 0}
              </div>
              <div className="text-[11px] text-slate-400">Dropped</div>
            </div>
          </div>

          <ul className="scrollbar-styled max-h-72 divide-y divide-slate-800 overflow-y-auto text-sm">
            {cameras.length === 0 ? (
              <li className="py-4 text-sm text-slate-400">No cameras registered</li>
            ) : (
              cameras.map((c) => {
                const online = c.health?.online ?? c.online
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', online ? 'bg-emerald-400' : 'bg-slate-500')} />
                      <div className="min-w-0">
                        <div className="truncate text-slate-200">{c.name}</div>
                        {(c.zone || c.location?.name) && (
                          <div className="truncate text-xs text-slate-400">
                            {[c.location?.name, c.zone].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.health?.fps != null && (
                        <span className="font-mono text-xs text-slate-400">{c.health.fps.toFixed(0)} fps</span>
                      )}
                      <Badge tone={online ? 'ok' : 'warn'}>{online ? 'Online' : 'Offline'}</Badge>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </Card>

        {/* Live events feed */}
        <Card className="lg:col-span-2">
          <SectionHeader title="Live events feed" icon={ActivityIcon}>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-400">
              {events.length} recent
            </span>
          </SectionHeader>
          <ul className="scrollbar-styled max-h-[28rem] divide-y divide-slate-800 overflow-y-auto">
            {events.length === 0 ? (
              <li className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-800 text-slate-400">
                  {ClockIcon}
                </span>
                <p className="text-sm text-slate-400">No events yet today</p>
                <p className="text-xs text-slate-400">Recognition and access events will appear here in real time.</p>
              </li>
            ) : (
              events.map((e) => {
                const tone = eventTone(e.event_type)
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => openEvent(e)}
                      aria-label={`View details: ${e.message}`}
                      className="flex w-full items-start gap-3 rounded-lg px-1 py-3 text-left transition-colors hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', toneChip[tone])}>
                        {eventGlyph[tone]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm text-slate-200">{e.message}</p>
                          <span className="shrink-0 text-xs text-slate-400" title={new Date(e.occurred_at).toLocaleString()}>
                            {timeAgo(e.occurred_at)}
                          </span>
                        </div>
                        <Badge tone={tone} className="mt-1.5 capitalize">
                          {e.event_type.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </Card>
      </div>

      <LiveEventDetailPanel
        event={selectedEvent}
        cameras={cameras}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  )
}
