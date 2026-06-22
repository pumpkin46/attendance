import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/ui/PageHeader'
import { Card } from '@/shared/ui/Card'
import { Button } from '@/shared/ui/Button'
import { useAuth } from '@/features/auth/AuthProvider'
import { getApiErrorMessage } from '@/shared/api/client'
import { inputClass } from '@/shared/lib/inputClass'
import { initials } from '@/shared/lib/format'

/** Long-form date, e.g. "9 Jun 2026". Returns "—" when missing. */
function formatDate(value?: string | null): string {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </label>
      {children}
    </div>
  )
}

function ProfileCard() {
  const { user, saveProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')

  if (!user) return null

  const startEditing = () => {
    setName(user.name)
    setEmail(user.email)
    setEditing(true)
  }

  const cancel = () => {
    setName(user.name)
    setEmail(user.email)
    setEditing(false)
  }

  const dirty = name.trim() !== user.name || email.trim() !== user.email

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!dirty) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await saveProfile({ name: name.trim(), email: email.trim() })
      toast.success('Profile updated')
      setEditing(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not update profile'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Account details</h3>
          <p className="text-xs text-slate-400">Your personal information and sign-in identity.</p>
        </div>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={startEditing}>
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Full name" htmlFor="profile-name">
            <input
              id="profile-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputClass()}
            />
          </Field>
          <Field label="Email" htmlFor="profile-email">
            <input
              id="profile-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass()}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Used to sign in. Changing it requires you to use the new address next time.
            </p>
          </Field>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" size="sm" isLoading={saving} disabled={!dirty}>
              Save changes
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <dl className="divide-y divide-slate-800 text-sm">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">Full name</dt>
            <dd className="font-medium text-slate-100">{user.name}</dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">Email</dt>
            <dd className="font-medium text-slate-100">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-slate-400">Member since</dt>
            <dd className="font-medium text-slate-100">{formatDate(user.created_at)}</dd>
          </div>
        </dl>
      )}
    </Card>
  )
}

function PasswordCard() {
  const { changeUserPassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    if (next !== confirm) {
      toast.error('New passwords do not match')
      return
    }
    setSaving(true)
    try {
      await changeUserPassword(current, next)
      toast.success('Password updated')
      reset()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not update password'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-200">Password</h3>
      <p className="mb-4 text-xs text-slate-400">
        Choose a strong password you don&apos;t use elsewhere.
      </p>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Field label="Current password" htmlFor="current-password">
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
            className={inputClass()}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="new-password">
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              className={inputClass()}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              className={inputClass()}
            />
          </Field>
        </div>
        <div className="pt-1">
          <Button
            type="submit"
            size="sm"
            isLoading={saving}
            disabled={!current || !next || !confirm}
          >
            Update password
          </Button>
        </div>
      </form>
    </Card>
  )
}

export default function ProfilePage() {
  const { user, isSuperAdmin } = useAuth()
  if (!user) return null

  const roles = user.roles ?? []
  const permissions = Array.from(
    new Set(roles.flatMap((r) => (r.permissions ?? []).map((p) => p.label || p.name)))
  ).sort()
  const isLocalAccount = !user.auth_provider || user.auth_provider === 'local'

  return (
    <div className="space-y-6">
      <PageHeader title="My account" description="Your profile, organization, and access level." />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity */}
        <Card className="lg:col-span-1 self-start">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-semibold text-white">
              {initials(user.name)}
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-100">{user.name}</h2>
            <p className="text-sm text-slate-400">{user.email}</p>
            <span className="mt-3 inline-block rounded-full bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-400">
              {isSuperAdmin() ? 'Super Admin' : roles[0]?.label ?? 'Member'}
            </span>

            <dl className="mt-5 w-full space-y-2 border-t border-slate-800 pt-4 text-left text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Status</dt>
                <dd>
                  <span
                    className={`inline-flex items-center gap-1.5 font-medium ${
                      user.is_active === false ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        user.is_active === false ? 'bg-amber-400' : 'bg-emerald-400'
                      }`}
                    />
                    {user.is_active === false ? 'Inactive' : 'Active'}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Sign-in method</dt>
                <dd className="font-medium capitalize text-slate-200">
                  {isLocalAccount ? 'Password' : user.auth_provider}
                </dd>
              </div>
            </dl>
          </div>
        </Card>

        {/* Details */}
        <div className="space-y-6 lg:col-span-2">
          <ProfileCard />

          {isLocalAccount && <PasswordCard />}

          <Card>
            <h3 className="mb-1 text-sm font-semibold text-slate-200">Roles &amp; permissions</h3>
            <p className="mb-3 text-xs text-slate-400">
              What you can access in the platform. Managed by your administrator.
            </p>

            <div className="mb-4">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Roles
              </p>
              {roles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((r) => (
                    <span
                      key={r.id}
                      className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-xs text-slate-300"
                    >
                      {r.label}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-slate-500">—</span>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                Permissions
              </p>
              {isSuperAdmin() ? (
                <p className="rounded-lg bg-blue-500/10 px-3 py-2 text-sm text-blue-300">
                  Super Admin — full access to all features and organizations.
                </p>
              ) : permissions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {permissions.map((p) => (
                    <span
                      key={p}
                      className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  No elevated permissions. You have standard employee access.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
