/**
 * Route → required permission map. Mirrors the backend's per-endpoint
 * `require_permission(...)` enforcement (see backend/app/api/*.py) so the
 * sidebar and route guards hide exactly what the API would reject with 403.
 *
 * Routes NOT listed here are open to any authenticated user (the backend
 * serves their primary GET endpoint auth-only). Super admins bypass all
 * checks via `useAuth().hasPermission`, which short-circuits for super_admin.
 */
export const ROUTE_PERMISSIONS: Record<string, string> = {
  '/access-control': 'cameras.manage',
  '/smart-building': 'building.manage',
  '/security-monitoring': 'security.monitor',
  '/employees': 'employees.manage',
  '/enrollment': 'employees.manage',
  '/enrollment-simple': 'employees.manage',
  '/recognition-engine': 'recognition.view',
  '/unknown-faces': 'reports.view',
  '/anomalies': 'reports.view',
  '/cameras': 'cameras.manage',
  '/rfid': 'rfid.manage',
  '/reports': 'reports.view',
  '/audit-logs': 'audit.view',
  '/security': 'security.view',
  '/user-management': 'users.manage',
}
