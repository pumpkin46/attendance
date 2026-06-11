import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import { Button } from '@/shared/ui/Button'
import { AppLogo } from '@/shared/components/AppLogo'

const fieldBase =
  'w-full rounded-lg border border-slate-700 bg-slate-800/60 py-2.5 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

const UserIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
  </svg>
)
const MailIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)
const LockIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const EyeIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
const EyeOffIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 3.4-.6" />
  </svg>
)
const AlertIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4m0 4h.01" />
  </svg>
)

interface AuthConfig {
  registration_enabled: boolean
}

function Field({
  id,
  label,
  icon,
  children,
}: {
  id: string
  label: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
          {icon}
        </span>
        {children}
      </div>
    </div>
  )
}

export default function RegisterPage() {
  const { user, register, loading } = useAuth()
  const { data: config } = useApiQuery<AuthConfig>(['auth', 'config'], '/auth/config', undefined, {
    silent: true,
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to="/" replace />

  const registrationDisabled = config?.registration_enabled === false

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await register(name, email, password)
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Registration failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <AppLogo size="md" showText />
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-100">Create your account</h1>
          <p className="mt-1 text-sm text-slate-400">
            Join the attendance platform in under a minute.
          </p>
        </div>

        {registrationDisabled ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Self-registration is currently disabled. Ask an administrator to create your account.
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                {AlertIcon}
                {error}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <Field id="name" label="Full name" icon={UserIcon}>
                <input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                  maxLength={255}
                  className={`${fieldBase} pl-10 pr-3`}
                />
              </Field>

              <Field id="email" label="Email" icon={MailIcon}>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  className={`${fieldBase} pl-10 pr-3`}
                />
              </Field>

              <Field id="password" label="Password" icon={LockIcon}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                  className={`${fieldBase} pl-10 pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
                >
                  {showPassword ? EyeOffIcon : EyeIcon}
                </button>
              </Field>

              <Field id="confirm" label="Confirm password" icon={LockIcon}>
                <input
                  id="confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat your password"
                  required
                  minLength={8}
                  className={`${fieldBase} pl-10 pr-3`}
                />
              </Field>

              <Button type="submit" fullWidth size="lg" isLoading={submitting}>
                Create account
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            Sign in
          </Link>
        </p>

        <p className="mt-8 text-center text-xs text-slate-600">
          Protected by enterprise-grade encryption.
        </p>
      </div>
    </div>
  )
}
