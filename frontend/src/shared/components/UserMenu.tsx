import { useRef, useState } from 'react'
import { Popover } from '@/shared/ui/Popover'
import { cn } from '@/shared/lib/cn'
import { initials } from '@/shared/lib/format'
import type { User } from '@/shared/types'

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
  const orgName = user.organization?.name

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors',
          'hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          open && 'bg-slate-800'
        )}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-semibold text-white">
          {initials(user.name)}
        </span>
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
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-semibold text-white">
            {initials(user.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-100">{user.name}</div>
            <div className="truncate text-xs text-slate-400">{user.email}</div>
            <span className="mt-1 inline-block rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400">
              {role}
            </span>
          </div>
        </div>

        {orgName && (
          <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-2.5 text-xs text-slate-400">
            <span className="text-slate-500">{BuildingIcon}</span>
            <span className="truncate">{orgName}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setOpen(false)
            onLogout()
          }}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          {LogoutIcon}
          Sign out
        </button>
      </Popover>
    </>
  )
}
