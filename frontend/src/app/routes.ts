/**
 * Route chunk prefetching.
 *
 * Maps each route path to the same dynamic `import()` specifier that `App.tsx`
 * lazy-loads. Calling the loader on nav hover/focus fetches the chunk early so
 * the subsequent navigation resolves from cache instead of waiting on the
 * network. The bundler dedupes identical specifiers to one chunk, so this never
 * double-fetches.
 *
 * A path missing here just means "no prefetch" — a safe, silent degradation, so
 * keeping this list in sync with App.tsx is an optimization, not a correctness
 * requirement.
 */
const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/': () => import('@/features/monitoring/MonitoringPage'),
  '/monitoring': () => import('@/features/monitoring/MonitoringPage'),
  '/dashboard': () => import('@/features/dashboard/DashboardPage'),
  '/access-control': () => import('@/features/access/AccessControlPage'),
  '/visitors': () => import('@/features/visitors/VisitorsPage'),
  '/employees': () => import('@/features/employees/EmployeesPage'),
  '/enrollment': () => import('@/features/enrollment/EnrollmentPage'),
  '/live-kiosk': () => import('@/features/kiosk/LiveKioskPage'),
  '/liveness-test': () => import('@/features/recognition/LivenessTestPage'),
  '/recognition-test': () => import('@/features/recognition/RecognitionTestPage'),
  '/attendance': () => import('@/features/attendance/AttendancePage'),
  '/anomalies': () => import('@/features/anomalies/AnomaliesPage'),
  '/shifts': () => import('@/features/shifts/ShiftsPage'),
  '/cameras': () => import('@/features/cameras/CamerasPage'),
  '/rfid': () => import('@/features/rfid/RfidPage'),
  '/reports': () => import('@/features/reports/ReportsPage'),
  '/unknown-faces': () => import('@/features/recognition/UnknownFacesPage'),
  '/audit-logs': () => import('@/features/audit/AuditLogsPage'),
  '/security': () => import('@/features/security/SecurityTenancyPage'),
  '/smart-building': () => import('@/features/building/SmartBuildingPage'),
  '/security-monitoring': () => import('@/features/security/SecurityMonitoringPage'),
  '/recognition-engine': () => import('@/features/recognition/RecognitionEnginePage'),
  '/notifications': () => import('@/features/notifications/NotificationsPage'),
  '/privacy': () => import('@/features/privacy/PrivacyPage'),
}

const prefetched = new Set<string>()

/** Warm the lazy chunk for `path` (once). No-op for unknown paths. */
export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return
  const load = routeLoaders[path]
  if (!load) return
  prefetched.add(path)
  void load()
}
