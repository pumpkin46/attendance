import { Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AppLogo } from '../components/AppLogo'
import { Button } from '../components/ui/Button'
import SidebarNav from '../components/SidebarNav'

export default function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex h-screen w-[248px] shrink-0 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 py-4">
        <div className="mb-4 shrink-0 px-4">
          <AppLogo showText />
        </div>

        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-slate-950">
        <header className="flex h-14 items-center justify-end border-b border-slate-800 bg-slate-900 px-6">
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>{user?.name}</span>
            <Button variant="ghost" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
