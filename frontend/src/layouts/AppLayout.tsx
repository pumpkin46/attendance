import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { AppLogo } from '@/shared/components/AppLogo'
import SidebarNav from '@/shared/components/SidebarNav'
import { OrgSwitcher } from '@/shared/components/OrgSwitcher'
import { RealtimeIndicator } from '@/shared/components/RealtimeIndicator'
import { UserMenu } from '@/shared/components/UserMenu'
import { Loading } from '@/shared/ui/Loading'

export default function AppLayout() {
  const { user, logout, isSuperAdmin } = useAuth()
  const role = isSuperAdmin() ? 'Super Admin' : user?.roles?.[0]?.label ?? 'Member'

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-full w-[248px] shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 py-4">
        <div className="mb-4 shrink-0 px-4">
          <AppLogo showText />
        </div>

        <SidebarNav />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/95 px-6 backdrop-blur">
          <div className="min-w-0">
            {isSuperAdmin() ? (
              <OrgSwitcher />
            ) : (
              user?.organization?.name && (
                <span className="truncate text-sm font-medium text-slate-300">
                  {user.organization.name}
                </span>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-slate-800/70 px-2.5 py-1 ring-1 ring-slate-700/60">
              <RealtimeIndicator />
            </span>
            <span className="h-6 w-px bg-slate-700" aria-hidden />
            {user && <UserMenu user={user} role={role} onLogout={() => logout()} />}
          </div>
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
