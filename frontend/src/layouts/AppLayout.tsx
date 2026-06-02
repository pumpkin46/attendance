import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../lib/cn'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/Button'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/employees', label: 'Employees' },
  { to: '/enrollment', label: 'Face Enrollment' },
  { to: '/live-kiosk', label: 'Live Kiosk' },
  { to: '/recognition-test', label: 'Test Recognition' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/shifts', label: 'Shifts' },
  { to: '/cameras', label: 'Cameras' },
  { to: '/reports', label: 'Reports' },
  { to: '/audit-logs', label: 'Audit Logs' },
]

export default function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold">
            A
          </span>
          <div>
            <strong className="block text-sm">Attendance</strong>
            <small className="text-xs text-slate-400">AI Platform</small>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-800 bg-slate-900 px-6">
          <div />
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
