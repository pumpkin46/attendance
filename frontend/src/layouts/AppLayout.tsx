import { Suspense, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { AppLogo } from '@/shared/components/AppLogo'
import SidebarNav from '@/shared/components/SidebarNav'
import { UserMenu } from '@/shared/components/UserMenu'
import { Loading } from '@/shared/ui/Loading'
import { cn } from '@/shared/lib/cn'

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

export default function AppLayout() {
  const { user, logout, isSuperAdmin } = useAuth()
  const role = isSuperAdmin() ? 'Super Admin' : user?.roles?.[0]?.label ?? 'Member'

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
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/95 px-4 backdrop-blur">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-lg text-slate-400',
              'transition-colors hover:bg-slate-800 hover:text-slate-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
            )}
          >
            <CollapseIcon collapsed={collapsed} />
          </button>
          {user && <UserMenu user={user} role={role} onLogout={() => logout()} />}
        </header>
        <main className="scrollbar-styled min-h-0 flex-1 overflow-y-auto p-6">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
