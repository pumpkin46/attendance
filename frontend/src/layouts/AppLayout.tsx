import { Suspense, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { AppLogo } from '@/shared/components/AppLogo'
import SidebarNav from '@/shared/components/SidebarNav'
import { NotificationsMenu } from '@/shared/components/NotificationsMenu'
import { UserMenu } from '@/shared/components/UserMenu'
import { WindowControls } from '@/shared/components/WindowControls'
import { CommandPalette, openCommandPalette } from '@/shared/components/CommandPalette'
import { cn } from '@/shared/lib/cn'
import { DRAG_REGION, NO_DRAG_REGION } from '@/shared/lib/desktop'
import { routeCrumb } from '@/app/navigation'

const COLLAPSED_KEY = 'sidebar-collapsed'

/** Panel-left toggle: the sidebar silhouette with a chevron showing the action. */
const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    {collapsed ? <path d="m13.5 9.5 2.5 2.5-2.5 2.5" /> : <path d="m16.5 9.5-2.5 2.5 2.5 2.5" />}
  </svg>
)

const SearchIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

/** Slim indeterminate bar shown while a lazy route chunk loads. */
function RouteFallback() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden" aria-hidden>
      <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-r-full bg-blue-500" />
    </div>
  )
}

export default function AppLayout() {
  const { user, logout, isSuperAdmin } = useAuth()
  const role = isSuperAdmin() ? 'Super Admin' : user?.roles?.[0]?.label ?? 'Member'
  const { pathname } = useLocation()
  const crumb = routeCrumb(pathname)

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1')
  const toggleSidebar = () =>
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 py-4',
          'transition-[width] duration-200 ease-out',
          collapsed ? 'w-[68px]' : 'w-[248px]'
        )}
      >
        <div className={cn('mb-4 flex shrink-0', collapsed ? 'justify-center px-2' : 'px-4')}>
          <AppLogo size="md" showText={!collapsed} />
        </div>

        <SidebarNav collapsed={collapsed} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
        <header
          className={cn(
            'sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/95 px-4 backdrop-blur',
            DRAG_REGION
          )}
        >
          {/* Left: collapse toggle + breadcrumb */}
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400',
                'transition-colors hover:bg-slate-800 hover:text-slate-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                NO_DRAG_REGION
              )}
            >
              <CollapseIcon collapsed={collapsed} />
            </button>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
              {crumb.group && (
                <>
                  <span className="hidden truncate text-slate-500 sm:inline">{crumb.group}</span>
                  <span className="hidden text-slate-600 sm:inline">/</span>
                </>
              )}
              <span className="truncate font-semibold text-slate-100">{crumb.title}</span>
            </nav>
          </div>

          {/* Center: command-palette trigger (fills the title-bar space) */}
          <button
            type="button"
            onClick={openCommandPalette}
            className={cn(
              'absolute left-1/2 hidden w-full max-w-sm -translate-x-1/2 items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-600 hover:bg-slate-800 lg:flex',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
              NO_DRAG_REGION
            )}
          >
            {SearchIcon}
            <span>Search or jump to…</span>
            <kbd className="ml-auto rounded border border-slate-700 bg-slate-900/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              Ctrl K
            </kbd>
          </button>

          {/* Right: compact search, notifications, account, window controls */}
          <div className={cn('flex items-center gap-1', NO_DRAG_REGION)}>
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search"
              title="Search (Ctrl+K)"
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 lg:hidden"
            >
              {SearchIcon}
            </button>
            <NotificationsMenu />
            {user && <UserMenu user={user} role={role} onLogout={() => logout()} />}
            <WindowControls />
          </div>
        </header>
        <main className="scrollbar-styled relative min-h-0 flex-1 overflow-y-auto p-6">
          <div key={pathname} className="page-enter">
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <CommandPalette />
    </div>
  )
}
