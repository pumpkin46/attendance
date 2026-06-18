import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Loading } from '@/shared/ui/Loading'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <Loading fullScreen />
  }
  if (!user) {
    // Preserve the deep link so login can return the user here (the 401
    // interceptor already does this for API-triggered redirects).
    const next = location.pathname + location.search
    const param = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''
    return <Navigate to={`/login${param}`} replace />
  }
  return children
}
