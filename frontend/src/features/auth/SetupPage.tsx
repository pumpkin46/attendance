import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, getApiErrorMessage } from '@/shared/api/client'
import { AppLogo } from '@/shared/components/AppLogo'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/cn'

interface SetupStatus {
  needs_setup: boolean
  database_ready: boolean
  database_name: string
  pending_migrations: number
  migration_status: string
}

interface MigrationProgress {
  status: 'idle' | 'running' | 'done' | 'failed'
  lines: string[]
  total: number
  completed: number
  error?: string | null
}

const fieldBase =
  'w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-slate-100 ' +
  'placeholder:text-slate-500 transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

const DatabaseIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
)
const BuildingIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>
)
const UserIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c.6-3.5 3.8-5.5 8-5.5s7.4 2 8 5.5" /></svg>
)
const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
)
const AlertIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 4h.01" /></svg>
)
const EyeIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
)
const EyeOffIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.3 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 3.4-.6" /></svg>
)

const STEPS = [
  { title: 'Database', icon: DatabaseIcon },
  { title: 'Organization', icon: BuildingIcon },
  { title: 'Administrator', icon: UserIcon },
]

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/**
 * First-run setup wizard: shown once on a fresh install.
 * Step 1 creates the database and runs alembic migrations (live progress),
 * step 2 names the organization, step 3 creates the first administrator —
 * then the user signs in on the login page.
 */
export default function SetupPage() {
  const navigate = useNavigate()
  const [bootStatus, setBootStatus] = useState<SetupStatus | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [polling, setPolling] = useState(false)
  const [dbName, setDbName] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({
    organization_name: '',
    admin_name: '',
    admin_email: '',
    admin_password: '',
    confirm_password: '',
  })

  // Initial probe: skip finished steps, or resume watching a migration that is
  // already running (e.g. after a page refresh).
  useEffect(() => {
    api
      .get<SetupStatus>('/setup/status')
      .then((r) => {
        setBootStatus(r.data)
        setDbName(r.data.database_name)
        if (r.data.database_ready) setStep(1)
        else if (r.data.migration_status === 'running') setPolling(true)
      })
      .catch(() => {
        // Backend unreachable: render the database step; actions surface the real error.
        setBootStatus({
          needs_setup: true,
          database_ready: false,
          database_name: '',
          pending_migrations: 0,
          migration_status: 'idle',
        })
      })
  }, [])

  // Poll migration progress while the background job runs.
  useEffect(() => {
    if (!polling) return
    let cancelled = false
    const tick = async () => {
      try {
        const { data } = await api.get<MigrationProgress>('/setup/database/progress')
        if (cancelled) return
        setProgress(data)
        if (data.status === 'done') {
          setPolling(false)
          window.setTimeout(() => setStep((s) => (s === 0 ? 1 : s)), 1200)
        } else if (data.status === 'failed') {
          setPolling(false)
        }
      } catch {
        /* transient — keep polling */
      }
    }
    void tick()
    const id = window.setInterval(tick, 800)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [polling])

  // Keep the log terminal pinned to the latest line.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [progress?.lines.length])

  if (bootStatus && !bootStatus.needs_setup) return <Navigate to="/login" replace />

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value })

  const startDatabase = async () => {
    setError('')
    const name = dbName.trim()
    if (name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setError('Database name may only contain letters, digits and underscores, and must not start with a digit.')
      return
    }
    try {
      const { data } = await api.post<MigrationProgress>('/setup/database', {
        database_name: name || undefined,
      })
      setProgress(data)
      setPolling(true)
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not start database setup.'))
    }
  }

  const nextFromOrg = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setStep(2)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (form.admin_password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (form.admin_password !== form.confirm_password) {
      setError('Passwords do not match.')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/setup', {
        organization_name: form.organization_name,
        admin_name: form.admin_name,
        admin_email: form.admin_email,
        admin_password: form.admin_password,
      })
      toast.success('Setup complete — sign in with your new administrator account.')
      void navigate('/login', { replace: true })
    } catch (err) {
      setError(getApiErrorMessage(err, 'Setup failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  const migrating = progress?.status === 'running'
  const migrationDone = progress?.status === 'done'
  const migrationFailed = progress?.status === 'failed'
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : null

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" aria-hidden />

      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <AppLogo size="md" showText />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-black/40">
          <h1 className="text-xl font-semibold text-slate-100">Welcome — let&apos;s set things up</h1>
          <p className="mt-1 text-sm text-slate-400">
            Three quick steps and your workspace is ready.
          </p>

          {/* Step indicator */}
          <div className="mt-6 flex items-center">
            {STEPS.map((s, i) => {
              const done = i < step
              const active = i === step
              return (
                <div key={s.title} className={cn('flex items-center', i > 0 && 'flex-1')}>
                  {i > 0 && (
                    <div className={cn('mx-2.5 h-0.5 flex-1 rounded-full', done || active ? 'bg-blue-500' : 'bg-slate-700')} />
                  )}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'grid h-8 w-8 place-items-center rounded-full text-xs font-bold transition-colors',
                        done
                          ? 'bg-emerald-600 text-white'
                          : active
                            ? 'bg-blue-600 text-white'
                            : 'border border-slate-600 bg-slate-800 text-slate-400'
                      )}
                    >
                      {done ? CheckIcon : s.icon}
                    </span>
                    <span className={cn('text-xs font-medium', active ? 'text-slate-200' : 'text-slate-500')}>
                      {s.title}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {error && (
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              {AlertIcon}
              {error}
            </div>
          )}

          {bootStatus === null ? (
            <div className="mt-8 space-y-3">
              <div className="h-10 animate-pulse rounded-lg bg-slate-800" />
              <div className="h-10 animate-pulse rounded-lg bg-slate-800" />
            </div>
          ) : step === 0 ? (
            /* ── Step 1: Database ─────────────────────────────────────── */
            <div className="mt-6 space-y-4">
              {!progress && (
                <>
                  <p className="text-sm text-slate-400">
                    The database hasn&apos;t been initialized yet. This will create the{' '}
                    PostgreSQL database (if needed) and apply all schema migrations.
                    {bootStatus.pending_migrations > 0 && (
                      <span className="text-slate-300"> {bootStatus.pending_migrations} migration(s) pending.</span>
                    )}
                  </p>
                  <Field
                    id="db-name"
                    label="Database name"
                    hint="Letters, digits and underscores only. Created on the PostgreSQL server if it doesn't exist."
                  >
                    <input
                      id="db-name"
                      value={dbName}
                      onChange={(e) => setDbName(e.target.value)}
                      placeholder="attendance"
                      autoFocus
                      spellCheck={false}
                      className={`${fieldBase} font-mono`}
                    />
                  </Field>
                  <Button fullWidth size="lg" onClick={startDatabase}>
                    Create database &amp; run migrations
                  </Button>
                </>
              )}

              {progress && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span
                      className={cn(
                        'flex items-center gap-2 font-medium',
                        migrationDone ? 'text-emerald-400' : migrationFailed ? 'text-red-400' : 'text-slate-200'
                      )}
                    >
                      {migrating && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400" />
                      )}
                      {migrationDone && CheckIcon}
                      {migrationFailed && AlertIcon}
                      {migrating ? 'Running migrations…' : migrationDone ? 'Database ready' : 'Migration failed'}
                    </span>
                    {progress.total > 0 && (
                      <span className="font-mono text-xs text-slate-400">
                        {progress.completed}/{progress.total}
                      </span>
                    )}
                  </div>

                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        migrationFailed ? 'bg-red-500' : migrationDone ? 'bg-emerald-500' : 'bg-blue-500',
                        migrating && percent === null && 'w-1/3 animate-pulse'
                      )}
                      style={percent !== null ? { width: `${migrationDone ? 100 : percent}%` } : undefined}
                    />
                  </div>

                  <div
                    ref={logRef}
                    className="h-44 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-400"
                  >
                    {progress.lines.map((line, i) => (
                      <div key={i} className={cn(line.startsWith('ERROR') && 'text-red-400')}>
                        {line}
                      </div>
                    ))}
                    {migrating && <div className="animate-pulse text-slate-600">▍</div>}
                  </div>

                  {migrationDone && (
                    <Button fullWidth size="lg" onClick={() => setStep(1)}>
                      Continue
                    </Button>
                  )}
                  {migrationFailed && (
                    <Button fullWidth size="lg" onClick={startDatabase}>
                      Retry
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : step === 1 ? (
            /* ── Step 2: Organization ─────────────────────────────────── */
            <form className="mt-6 space-y-4" onSubmit={nextFromOrg}>
              <Field
                id="org-name"
                label="Organization name"
                hint="Shown in the top bar and on reports. You can rename it later."
              >
                <input
                  id="org-name"
                  value={form.organization_name}
                  onChange={set('organization_name')}
                  placeholder="e.g. Acme Corporation"
                  required
                  autoFocus
                  className={fieldBase}
                />
              </Field>
              <Button type="submit" fullWidth size="lg">
                Continue
              </Button>
            </form>
          ) : (
            /* ── Step 3: Administrator ────────────────────────────────── */
            <form className="mt-6 space-y-4" onSubmit={submit}>
              <Field id="admin-name" label="Your name">
                <input
                  id="admin-name"
                  value={form.admin_name}
                  onChange={set('admin_name')}
                  placeholder="e.g. Alex Morgan"
                  required
                  autoFocus
                  autoComplete="name"
                  className={fieldBase}
                />
              </Field>
              <Field id="admin-email" label="Email">
                <input
                  id="admin-email"
                  type="email"
                  value={form.admin_email}
                  onChange={set('admin_email')}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                  className={fieldBase}
                />
              </Field>
              <Field id="admin-password" label="Password" hint="At least 8 characters.">
                <div className="relative">
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.admin_password}
                    onChange={set('admin_password')}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={`${fieldBase} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
                  >
                    {showPassword ? EyeOffIcon : EyeIcon}
                  </button>
                </div>
              </Field>
              <Field id="confirm-password" label="Confirm password">
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirm_password}
                  onChange={set('confirm_password')}
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  className={fieldBase}
                />
              </Field>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" size="lg" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="submit" fullWidth size="lg" isLoading={submitting}>
                  Complete setup
                </Button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-slate-600">
          This administrator gets full access. You can add team members and roles later.
        </p>
      </div>
    </div>
  )
}
