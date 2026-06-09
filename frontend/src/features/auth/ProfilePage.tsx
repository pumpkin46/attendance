import { PageHeader } from '@/shared/ui/PageHeader'
import { Card } from '@/shared/ui/Card'
import { useAuth } from '@/features/auth/AuthProvider'
import { initials } from '@/shared/lib/format'

export default function ProfilePage() {
  const { user, isSuperAdmin } = useAuth()
  if (!user) return null

  const roles = user.roles ?? []
  const permissions = Array.from(
    new Set(roles.flatMap((r) => (r.permissions ?? []).map((p) => p.label || p.name)))
  ).sort()

  return (
    <div className="space-y-6">
      <PageHeader title="My account" description="Your profile, organization, and access level." />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Identity */}
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-semibold text-white">
              {initials(user.name)}
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-100">{user.name}</h2>
            <p className="text-sm text-slate-400">{user.email}</p>
            <span className="mt-3 inline-block rounded-full bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-400">
              {isSuperAdmin() ? 'Super Admin' : roles[0]?.label ?? 'Member'}
            </span>
          </div>
        </Card>

        {/* Details */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-slate-200">Account details</h3>
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
                <dt className="text-slate-400">Organization</dt>
                <dd className="font-medium text-slate-100">{user.organization?.name ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-400">Roles</dt>
                <dd className="flex flex-wrap justify-end gap-1.5">
                  {roles.length > 0 ? (
                    roles.map((r) => (
                      <span
                        key={r.id}
                        className="rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-0.5 text-xs text-slate-300"
                      >
                        {r.label}
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <h3 className="mb-1 text-sm font-semibold text-slate-200">Permissions</h3>
            <p className="mb-3 text-xs text-slate-400">
              What you can access in the platform. Managed by your administrator.
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
          </Card>
        </div>
      </div>
    </div>
  )
}
