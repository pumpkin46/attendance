import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/chat', label: 'Chat' },
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
      { to: '/visitors', label: 'Visitors' },
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
    items: [
      { to: '/user-management', label: 'Users & Permissions' },
      { to: '/organizations', label: 'Organizations' },
      { to: '/locations', label: 'Locations' },
      { to: '/security', label: 'Security & Tenancy' },
    ],
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

export default function SidebarNav({ collapsed = false }: { collapsed?: boolean }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { hasPermission } = useAuth()

  // Collapsed-rail flyout: which group is open and where to anchor its panel.
  const [flyout, setFlyout] = useState<{ id: string; top: number; left: number } | null>(null)
  const flyoutTimer = useRef<number | null>(null)
  const cancelFlyoutClose = () => {
    if (flyoutTimer.current !== null) {
      window.clearTimeout(flyoutTimer.current)
      flyoutTimer.current = null
    }
  }
  const scheduleFlyoutClose = () => {
    cancelFlyoutClose()
    flyoutTimer.current = window.setTimeout(() => setFlyout(null), 150)
  }
  // Navigating (from the flyout or anywhere else) dismisses the panel
  // (render-phase adjustment, re-renders before commit).
  const [flyoutPath, setFlyoutPath] = useState(pathname)
  if (flyoutPath !== pathname) {
    setFlyoutPath(pathname)
    setFlyout(null)
  }

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

  // Expansion is fully derived: only the group owning the active route is open
  // (accordion). Navigating updates the route, which re-derives this — no effect needed.
  const expanded = useMemo(
    () => new Set(activeGroupId ? [activeGroupId] : []),
    [activeGroupId]
  )

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
  }, [visibleGroups, expanded])

  const openGroup = (group: NavGroup) => {
    const first = group.items[0]
    if (first) {
      void navigate(first.to)
    }
  }

  // ── Collapsed rail: icon-only groups with hover/focus flyout menus ─────────
  if (collapsed) {
    const flyoutGroup = flyout ? visibleGroups.find((g) => g.id === flyout.id) : null
    const showFlyout = (id: string, el: HTMLElement, firstTo?: string) => {
      cancelFlyoutClose()
      const rect = el.getBoundingClientRect()
      setFlyout({ id, top: rect.top, left: rect.right + 10 })
      if (firstTo) prefetchRoute(firstTo)
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <nav aria-label="Main navigation" className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2">
          <ul className="flex flex-col gap-1">
            {visibleGroups.map((group) => {
              const isActiveGroup = groupHasActiveItem(pathname, group)
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    aria-label={group.title}
                    onClick={() => openGroup(group)}
                    onMouseEnter={(e) => showFlyout(group.id, e.currentTarget, group.items[0]?.to)}
                    onMouseLeave={scheduleFlyoutClose}
                    onFocus={(e) => showFlyout(group.id, e.currentTarget, group.items[0]?.to)}
                    onBlur={scheduleFlyoutClose}
                    className={cn(
                      'flex w-full items-center justify-center rounded-lg py-3 transition-colors',
                      // Rail mode: upsize the shared group icons for legibility.
                      '[&_span]:!h-7 [&_span]:!w-7 [&_svg]:!h-6 [&_svg]:!w-6',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                      isActiveGroup
                        ? 'bg-slate-800 [&_svg]:text-blue-400'
                        : 'hover:bg-slate-800/60 [&_svg]:text-slate-400 hover:[&_svg]:text-slate-200'
                    )}
                  >
                    {group.icon}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {flyoutGroup &&
          flyout &&
          createPortal(
            <div
              className="fixed z-50"
              style={{
                left: flyout.left,
                // Keep the panel on-screen near the bottom of the rail.
                top: Math.max(
                  8,
                  Math.min(flyout.top, window.innerHeight - (52 + flyoutGroup.items.length * 34))
                ),
              }}
              onMouseEnter={cancelFlyoutClose}
              onMouseLeave={scheduleFlyoutClose}
            >
              <div className="w-56 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-2xl shadow-black/50">
                <div className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {flyoutGroup.title}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {flyoutGroup.items.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onMouseEnter={() => prefetchRoute(item.to)}
                        className={({ isActive }) =>
                          cn(
                            'block rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                            isActive
                              ? 'bg-blue-500/10 font-semibold text-blue-300'
                              : 'font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                          )
                        }
                      >
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body
          )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <nav
          ref={scrollRef}
          className="scrollbar-hidden h-full overflow-y-auto pr-2"
        >
          <ul className="flex flex-col gap-0.5 pl-2 pr-1">
            {visibleGroups.map((group) => {
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
