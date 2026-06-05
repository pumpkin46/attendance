import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { AppLogo } from '@/shared/components/AppLogo'
import { Button } from '@/shared/ui/Button'
import SidebarNav from '@/shared/components/SidebarNav'
import { RealtimeIndicator } from '@/shared/components/RealtimeIndicator'

export default function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-full w-[248px] shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 py-4">
        <div className="mb-4 shrink-0 px-4">
          <AppLogo showText />
        </div>

        <SidebarNav />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-950">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-end border-b border-slate-800 bg-slate-900 px-6">
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <RealtimeIndicator />
            <span>{user?.name}</span>
            <Button variant="ghost" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="scrollbar-styled min-h-0 flex-1 overflow-y-auto p-6">
          <Suspense
            fallback={<div className="grid h-full place-items-center text-slate-400">Loading…</div>}
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
