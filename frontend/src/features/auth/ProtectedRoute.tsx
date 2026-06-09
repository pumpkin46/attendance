import { Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Loading } from '@/shared/ui/Loading'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <Loading fullScreen />
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}
