import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRealtime, type RealtimeStatus } from '@/features/realtime/RealtimeContext'
import { Popover } from '@/shared/ui/Popover'
import { cn } from '@/shared/lib/cn'
import { initials } from '@/shared/lib/format'
import type { User } from '@/shared/types'

const REALTIME_META: Record<RealtimeStatus, { label: string; desc: string; dot: string }> = {
  open: { label: 'Live', desc: 'Real-time updates connected', dot: 'bg-emerald-400' },
  connecting: { label: 'Connecting', desc: 'Establishing real-time connection…', dot: 'bg-amber-400 animate-pulse' },
  closed: { label: 'Offline', desc: 'Real-time updates unavailable', dot: 'bg-slate-500' },
}

/** Avatar with a presence dot reflecting the realtime connection state. */
function StatusAvatar({
  name,
  status,
  size = 'sm',
}: {
  name: string
  status: RealtimeStatus
  size?: 'sm' | 'md'
}) {
  return (
    <span className="relative shrink-0">
      <span
        className={cn(
          'grid place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 font-semibold text-white',
          size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
        )}
      >
        {initials(name)}
      </span>
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-900',
          REALTIME_META[status].dot
        )}
        aria-hidden
      />
    </span>
  )
}

const ChevronIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
)
const LogoutIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </svg>
)
const BuildingIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M17 21V9h2a2 2 0 0 1 2 2v10M8 7h2M8 11h2M8 15h2" />
  </svg>
)
const AccountIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
  </svg>
)

export function UserMenu({
  user,
  role,
  onLogout,
}: {
  user: User
  role: string
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const orgName = user.organization?.name
  const { status } = useRealtime()
  const realtime = REALTIME_META[status]

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Realtime: ${realtime.label}`}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors',
          'hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          open && 'bg-slate-800'
        )}
      >
        <StatusAvatar name={user.name} status={status} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-sm font-medium text-slate-100">
            {user.name}
          </span>
          <span className="block text-xs text-slate-400">{role}</span>
        </span>
        {ChevronIcon}
      </button>

      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        matchWidth={false}
        className="w-64 p-1.5"
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-2.5 pb-3 pt-2">
          <StatusAvatar name={user.name} status={status} size="md" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100">{user.name}</div>
            <div className="truncate text-xs text-slate-400">{user.email}</div>
            <span className="mt-1 inline-block rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">
              {role}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-2.5 text-xs">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', realtime.dot)} aria-hidden />
          <span className="font-medium text-slate-300">{realtime.label}</span>
          <span className="truncate text-slate-500">· {realtime.desc}</span>
        </div>

        {orgName && (
          <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-2.5 text-xs text-slate-400">
            <span className="text-slate-500">{BuildingIcon}</span>
            <span className="truncate">{orgName}</span>
          </div>
        )}

        <div className="mt-1 space-y-0.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/profile')
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
          >
            {AccountIcon}
            My account
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
          >
            {LogoutIcon}
            Sign out
          </button>
        </div>
      </Popover>
    </>
  )
}
