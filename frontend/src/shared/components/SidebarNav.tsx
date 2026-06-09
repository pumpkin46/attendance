import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { prefetchRoute } from '@/app/routes'
import { ROUTE_PERMISSIONS } from '@/app/access'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/shared/lib/cn'

type NavItem = { to: string; label: string; end?: boolean }

type NavGroup = {
  id: string
  title: string
  icon: ReactNode
  items: NavItem[]
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center text-slate-400 [&_svg]:h-5 [&_svg]:w-5">
      {children}
    </span>
  )
}

const navGroups: NavGroup[] = [
  {
    id: 'overview',
    title: 'Overview',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
        </svg>
      </Icon>
    ),
    items: [{ to: '/', label: 'Dashboard', end: true }],
  },
  {
    id: 'access',
    title: 'Access & Visitors',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/visitors', label: 'Visitors' },
      { to: '/access-control', label: 'Access Control' },
    ],
  },
  {
    id: 'facilities',
    title: 'Facilities & Security',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 21V9l9-6 9 6v12M9 21V12h6v9" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/smart-building', label: 'Smart Building' },
      { to: '/security-monitoring', label: 'AI Security' },
    ],
  },
  {
    id: 'people',
    title: 'People',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/employees', label: 'Employees' },
      { to: '/enrollment', label: 'Face Enrollment' },
      { to: '/enrollment-simple', label: 'Quick Face Register' },
    ],
  },
  {
    id: 'recognition',
    title: 'Face Recognition',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="10" r="6" />
          <path d="M8 18h8M10 14h.01M14 14h.01" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/recognition-engine', label: 'AI Engine' },
      { to: '/live-kiosk', label: 'Live Kiosk' },
      { to: '/liveness-test', label: 'Liveness Test' },
      { to: '/recognition-test', label: 'Test Recognition' },
      { to: '/unknown-faces', label: 'Unknown Faces' },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/attendance', label: 'Attendance' },
      { to: '/anomalies', label: 'Anomalies' },
      { to: '/shifts', label: 'Shifts' },
    ],
  },
  {
    id: 'devices',
    title: 'Devices',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 8h16v10H4zM8 4h8v4H8z" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/cameras', label: 'Cameras' },
      { to: '/rfid', label: 'RFID' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports & Compliance',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19V5M4 19h16M8 15v-4M12 15V9M16 15v-2" />
        </svg>
      </Icon>
    ),
    items: [
      { to: '/reports', label: 'Reports' },
      { to: '/audit-logs', label: 'Audit Logs' },
      { to: '/notifications', label: 'Notifications' },
      { to: '/privacy', label: 'Privacy & GDPR' },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    icon: (
      <Icon>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V7l8-4z" />
        </svg>
      </Icon>
    ),
    items: [{ to: '/security', label: 'Security & Tenancy' }],
  },
]

function pathMatches(pathname: string, to: string, end?: boolean) {
  if (end) return pathname === to || (to === '/' && pathname === '/')
  return pathname === to || pathname.startsWith(`${to}/`)
}

function groupHasActiveItem(pathname: string, group: NavGroup) {
  return group.items.some((item) => pathMatches(pathname, item.to, item.end))
}

type ScrollThumb = { height: number; top: number; show: boolean }

function updateScrollThumb(el: HTMLElement): ScrollThumb {
  const { scrollTop, scrollHeight, clientHeight } = el
  if (scrollHeight <= clientHeight + 1) {
    return { height: 0, top: 0, show: false }
  }
  const thumbHeight = Math.max(40, Math.round(clientHeight * (clientHeight / scrollHeight)))
  const maxTop = clientHeight - thumbHeight
  const top = Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop)
  return { height: thumbHeight, top, show: true }
}

export default function SidebarNav() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()
  const [query, setQuery] = useState('')

  // Hide nav items the current user can't access (matches the route guards and
  // the backend's per-endpoint permissions). Items with no required permission
  // are always visible; groups left with no items are dropped.
  const visibleGroups = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => {
            const perm = ROUTE_PERMISSIONS[item.to]
            return !perm || hasPermission(perm)
          }),
        }))
        .filter((group) => group.items.length > 0),
    [hasPermission]
  )
  const scrollRef = useRef<HTMLElement>(null)
  const [scrollThumb, setScrollThumb] = useState<ScrollThumb>({
    height: 0,
    top: 0,
    show: false,
  })

  const activeGroupId = useMemo(
    () => visibleGroups.find((g) => groupHasActiveItem(pathname, g))?.id,
    [pathname, visibleGroups]
  )

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return visibleGroups
    return visibleGroups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) || group.title.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [query, visibleGroups])

  // Expansion is fully derived: a search expands every match, otherwise only the
  // group owning the active route is open (accordion). Navigating updates the
  // route, which re-derives this — no effect needed.
  const expanded = useMemo(() => {
    if (query.trim()) return new Set(filteredGroups.map((g) => g.id))
    return new Set(activeGroupId ? [activeGroupId] : [])
  }, [query, filteredGroups, activeGroupId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const sync = () => setScrollThumb(updateScrollThumb(el))
    sync()

    el.addEventListener('scroll', sync, { passive: true })
    const resizeObserver = new ResizeObserver(sync)
    resizeObserver.observe(el)
    const mutationObserver = new MutationObserver(sync)
    mutationObserver.observe(el, { childList: true, subtree: true })

    return () => {
      el.removeEventListener('scroll', sync)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [filteredGroups, expanded])

  const openGroup = (group: NavGroup) => {
    const first = group.items[0]
    if (first) {
      navigate(first.to)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <label className="relative mx-2 block shrink-0">
        <span className="sr-only">Search navigation</span>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search menu…"
          className="w-full rounded-lg border border-slate-700/80 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-slate-200 transition-colors placeholder:text-slate-500 hover:border-slate-600 focus:border-blue-500/60 focus:outline-none focus:ring-1 focus:ring-blue-500/40 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>

      <div className="relative min-h-0 flex-1">
        <nav
          ref={scrollRef}
          className="scrollbar-hidden h-full overflow-y-auto pr-2"
        >
          <ul className="flex flex-col gap-0.5 pl-2 pr-1">
            {filteredGroups.map((group) => {
              const isOpen = expanded.has(group.id)
              const isActiveGroup = groupHasActiveItem(pathname, group)

              return (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => openGroup(group)}
                    onMouseEnter={() => group.items[0] && prefetchRoute(group.items[0].to)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[15px] font-medium transition-colors',
                      isActiveGroup
                        ? 'bg-slate-800 text-slate-100 [&_span_svg]:text-blue-400'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 hover:[&_span_svg]:text-slate-300'
                    )}
                  >
                    {group.icon}
                    <span className="min-w-0 flex-1 truncate">{group.title}</span>
                    <svg
                      viewBox="0 0 24 24"
                      className={cn(
                        'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200',
                        isOpen ? 'rotate-0' : '-rotate-90'
                      )}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div
                      className="relative -mx-2 py-0.5"
                      role="group"
                      aria-label={group.title}
                    >
                      <span
                        className="pointer-events-none absolute bottom-1 left-7 top-1 w-px bg-slate-700/70"
                        aria-hidden
                      />
                      <ul className="flex flex-col">
                        {group.items.map((item) => {
                          const isActive = pathMatches(pathname, item.to, item.end)
                          return (
                            <li
                              key={item.to}
                              className="relative flex min-h-[32px] items-center"
                            >
                              {isActive && (
                                <span
                                  className="pointer-events-none absolute left-7 top-1/2 z-10 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400"
                                  aria-hidden
                                />
                              )}
                              <NavLink
                                to={item.to}
                                end={item.end}
                                onMouseEnter={() => prefetchRoute(item.to)}
                                onFocus={() => prefetchRoute(item.to)}
                                className={({ isActive: linkActive }) =>
                                  cn(
                                    'mr-1 flex w-full items-center rounded-md py-1.5 pl-10 pr-3 text-[14px] transition-colors',
                                    linkActive
                                      ? 'font-semibold text-blue-300'
                                      : 'font-medium text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                                  )
                                }
                              >
                                {item.label}
                              </NavLink>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>
        {scrollThumb.show && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-1 bottom-0 w-1"
          >
            <div
              className="absolute right-0 w-1 rounded-full bg-slate-600"
              style={{ height: scrollThumb.height, top: scrollThumb.top }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
