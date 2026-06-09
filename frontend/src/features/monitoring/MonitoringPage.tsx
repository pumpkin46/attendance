import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Badge } from '@/shared/ui/Badge'
import { Card } from '@/shared/ui/Card'
import { PageHeader } from '@/shared/ui/PageHeader'
import { cn } from '@/shared/lib/cn'
import { useFallbackPoll } from '@/features/realtime/useFallbackPoll'
import {
  useMonitoringDashboard,
  useMonitoringFeed,
  useMonitoringLiveFeed,
} from '@/features/monitoring/api/queries'

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
  neutral: 'bg-slate-700/50 text-slate-400',
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
const AbsentIcon = (
  <svg viewBox="0 0 24 24" className={ico} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5M16 14l5 5M21 14l-5 5" />
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

function Kpi({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: ReactNode
  sub?: string
  tone?: Tone
  icon: ReactNode
}) {
  return (
    <Card className="flex items-center gap-3">
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-lg', toneChip[tone])}>{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className={cn('text-2xl font-semibold leading-tight', toneText[tone])}>{value}</div>
        {sub && <div className="text-xs text-slate-500">{sub}</div>}
      </div>
    </Card>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="rounded-lg bg-slate-800/40 px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={cn('mt-0.5 text-lg font-semibold', tone ? toneText[tone] : 'text-slate-100')}>{value}</div>
    </div>
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

const QUICK_LINKS = [
  { to: '/cameras', label: 'Cameras' },
  { to: '/access-control', label: 'Access' },
  { to: '/visitors', label: 'Visitors' },
]

export default function MonitoringPage() {
  // Live counters stream over a WebSocket (pushed every ~3s) and write straight
  // into the query cache. Realtime events still resync on reconnect, and HTTP
  // polling stays as a fallback only while the socket is down.
  useMonitoringFeed()
  const poll = useFallbackPoll(60_000)
  const live = poll === undefined
  const { data: dashboard } = useMonitoringDashboard(poll)
  const { data: liveFeed } = useMonitoringLiveFeed(poll)
  const events = liveFeed?.events ?? []

  const eventTone = (type: string): Tone => {
    if (type.includes('unknown')) return 'danger'
    if (type.includes('offline')) return 'warn'
    if (type.includes('check_in') || type.includes('access_granted')) return 'ok'
    return 'neutral'
  }

  const cameras = dashboard?.cameras ?? []
  const health = dashboard?.camera_health

  return (
    <div>
      <PageHeader
        title="Real-Time Monitoring Center"
        description="Live workforce, camera health, and security events"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                live ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
              )}
            >
              <span className="relative flex h-2 w-2">
                {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-amber-500')} />
              </span>
              {live ? 'Live' : 'Reconnecting…'}
            </span>
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800/60 hover:text-slate-100"
              >
                {l.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Active cameras"
          value={`${dashboard?.active_cameras ?? '—'}/${dashboard?.total_cameras ?? '—'}`}
          icon={CameraIcon}
          tone="accent"
        />
        <Kpi label="Present" value={dashboard?.employees_present ?? '—'} tone="ok" icon={PresentIcon} />
        <Kpi label="Absent" value={dashboard?.employees_absent ?? '—'} tone="danger" icon={AbsentIcon} />
        <Kpi label="Late" value={dashboard?.employees_late ?? '—'} tone="warn" icon={ClockIcon} />
        <Kpi label="Unknown today" value={dashboard?.unknown_persons_today ?? '—'} tone="danger" icon={AlertIcon} />
        <Kpi label="Active visitors" value={dashboard?.active_visitors ?? '—'} icon={VisitorIcon} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Camera health */}
        <Card className="lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">Camera health</h2>
            <Badge tone={(health?.offline ?? 0) > 0 ? 'warn' : 'ok'}>
              {health?.online ?? 0}/{(health?.online ?? 0) + (health?.offline ?? 0)} online
            </Badge>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            <MiniStat label="Online" value={health?.online ?? 0} tone="ok" />
            <MiniStat label="Offline" value={health?.offline ?? 0} tone={(health?.offline ?? 0) > 0 ? 'warn' : undefined} />
            <MiniStat label="Avg FPS" value={health?.avg_fps?.toFixed(1) ?? '—'} />
            <MiniStat
              label="Avg latency"
              value={health?.avg_latency_ms != null ? `${health.avg_latency_ms}ms` : '—'}
            />
          </div>

          <ul className="scrollbar-styled max-h-72 divide-y divide-slate-800 overflow-y-auto text-sm">
            {cameras.length === 0 ? (
              <li className="py-4 text-sm text-slate-500">No cameras registered</li>
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
                          <div className="truncate text-xs text-slate-500">
                            {[c.location?.name, c.zone].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.health?.fps != null && (
                        <span className="font-mono text-xs text-slate-500">{c.health.fps.toFixed(0)} fps</span>
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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">Live events feed</h2>
            <span className="text-xs text-slate-500">{events.length} recent</span>
          </div>
          <ul className="scrollbar-styled max-h-[28rem] divide-y divide-slate-800 overflow-y-auto">
            {events.length === 0 ? (
              <li className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-800 text-slate-500">
                  {ClockIcon}
                </span>
                <p className="text-sm text-slate-400">No events yet today</p>
                <p className="text-xs text-slate-500">Recognition and access events will appear here in real time.</p>
              </li>
            ) : (
              events.map((e) => {
                const tone = eventTone(e.event_type)
                return (
                  <li key={e.id} className="flex items-start gap-3 py-3">
                    <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', toneChip[tone])}>
                      {eventGlyph[tone]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm text-slate-200">{e.message}</p>
                        <span className="shrink-0 text-xs text-slate-500" title={new Date(e.occurred_at).toLocaleString()}>
                          {timeAgo(e.occurred_at)}
                        </span>
                      </div>
                      <Badge tone={tone === 'accent' ? 'neutral' : tone} className="mt-1.5 capitalize">
                        {e.event_type.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </Card>
      </div>
    </div>
  )
}
