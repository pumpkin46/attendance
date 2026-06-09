import { type ReactNode } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { ForbiddenPage } from '@/shared/components/StatusScreen'

/**
 * Gates a route by permission. Renders a 403 page (inside the app layout, so
 * the user keeps the nav) when the current user lacks `permission`. Super
 * admins always pass via `hasPermission`.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string
  children: ReactNode
}) {
  const { hasPermission } = useAuth()
  if (!hasPermission(permission)) return <ForbiddenPage />
  return <>{children}</>
}
