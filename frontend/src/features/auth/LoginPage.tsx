import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { AppLogo } from '@/shared/components/AppLogo'
import { Card } from '@/shared/ui/Card'

export default function LoginPage() {
  const { user, login, loading } = useAuth()
  const [email, setEmail] = useState(import.meta.env.DEV ? 'admin@attendance.local' : '')
  const [password, setPassword] = useState(import.meta.env.DEV ? 'password' : '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password)
    } catch {
      setError('Invalid credentials')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,_#1e3a5f_0%,_#020617_60%)]">
      <Card className="w-full max-w-md">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col items-center gap-3 pb-2 text-center">
            <AppLogo size="lg" />
            <div>
              <h1 className="text-xl font-semibold">Attendance Platform</h1>
              <p className="text-sm text-slate-400">Enterprise face recognition attendance</p>
            </div>
          </div>
          {error && (
            <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-400">{error}</div>
          )}
          <Label>
            Email
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Label>
          <Label>
            Password
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Label>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
