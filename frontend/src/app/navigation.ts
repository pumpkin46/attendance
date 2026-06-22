/**
 * Single source of truth for the app's primary navigation. Consumed by the
 * sidebar (SidebarNav), the header breadcrumb (AppLayout), and the command
 * palette (CommandPalette). Per-route permission gating is applied by each
 * consumer via ROUTE_PERMISSIONS + useAuth().hasPermission.
 */

export type NavItem = { to: string; label: string; end?: boolean; keywords?: string }
export type NavGroup = { id: string; title: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', end: true, keywords: 'home overview kpi' },
      { to: '/chat', label: 'Chat', keywords: 'messages team' },
    ],
  },
  {
    id: 'people',
    title: 'People',
    items: [
      { to: '/employees', label: 'Employees', keywords: 'staff workforce people' },
      { to: '/visitors', label: 'Visitors', keywords: 'guests' },
      { to: '/enrollment', label: 'Face Enrollment', keywords: 'register face enroll' },
      { to: '/enrollment-simple', label: 'Quick Face Register', keywords: 'register face quick' },
    ],
  },
  {
    id: 'recognition',
    title: 'Face Recognition',
    items: [
      { to: '/recognition-engine', label: 'AI Engine', keywords: 'recognition engine ai' },
      { to: '/live-kiosk', label: 'Live Kiosk', keywords: 'kiosk' },
      { to: '/liveness-test', label: 'Liveness Test', keywords: 'anti-spoof liveness' },
      { to: '/recognition-test', label: 'Test Recognition', keywords: 'recognition test' },
      { to: '/unknown-faces', label: 'Unknown Faces', keywords: 'strangers unknown' },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    items: [
      { to: '/attendance', label: 'Attendance', keywords: 'check-in clock' },
      { to: '/anomalies', label: 'Anomalies', keywords: 'issues exceptions' },
      { to: '/shifts', label: 'Shifts', keywords: 'schedule roster' },
    ],
  },
  {
    id: 'devices',
    title: 'Devices',
    items: [
      { to: '/cameras', label: 'Cameras', keywords: 'camera video' },
      { to: '/rfid', label: 'RFID', keywords: 'badge card' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports & Compliance',
    items: [
      { to: '/reports', label: 'Reports', keywords: 'export analytics' },
      { to: '/audit-logs', label: 'Audit Logs', keywords: 'audit history' },
      { to: '/privacy', label: 'Privacy & GDPR', keywords: 'gdpr privacy data' },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    items: [
      { to: '/user-management', label: 'Users & Permissions', keywords: 'users roles permissions admin' },
      { to: '/organizations', label: 'Organizations', keywords: 'org tree departments' },
      { to: '/locations', label: 'Locations', keywords: 'sites' },
      { to: '/security', label: 'Security & Tenancy', keywords: 'security tenancy' },
    ],
  },
]

export type FlatNavItem = NavItem & { group: string; groupId: string }

/** Every nav item, flattened, each tagged with its group — drives the palette. */
export const ALL_NAV_ITEMS: FlatNavItem[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ ...i, group: g.title, groupId: g.id }))
)

// Routes reachable but not in the sidebar (so the breadcrumb still has a title).
const EXTRA_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/profile': 'Profile',
  '/kiosk': 'Live Kiosk',
}

export type Crumb = { group?: string; title: string }

/** Best-matching breadcrumb for a pathname (longest matching route prefix). */
export function routeCrumb(pathname: string): Crumb {
  let best: { group: string; title: string; score: number } | null = null
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const match = it.end
        ? pathname === it.to
        : pathname === it.to || pathname.startsWith(`${it.to}/`)
      if (match && (!best || it.to.length > best.score)) {
        best = { group: g.title, title: it.label, score: it.to.length }
      }
    }
  }
  if (best) return { group: best.group, title: best.title }
  if (EXTRA_TITLES[pathname]) return { title: EXTRA_TITLES[pathname] }
  return { title: 'Attendance Platform' }
}
