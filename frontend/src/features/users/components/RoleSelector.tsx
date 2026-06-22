import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import type { RoleWithUsage } from '@/features/users/api/queries'

const SUPER_ADMIN = 'super_admin'

const s = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const
const g = 'h-5 w-5'

const ShieldStarIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M12 3 5 6v5c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6l-7-3Z" />
    <path d="m12 8 1 2 2 .3-1.5 1.5.4 2.2L12 15l-1.9 1 .4-2.2L9 12.3l2-.3 1-2Z" />
  </svg>
)
const BuildingIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 21V9h3a1 1 0 0 1 1 1v11" />
    <path d="M8 7h2M8 11h2M8 15h2" />
  </svg>
)
const UsersIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M21 19c0-2.6-1.6-4.4-3.8-4.9" />
  </svg>
)
const UserCheckIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="m16 12 2 2 4-4" />
  </svg>
)
const UserIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
  </svg>
)
const ShieldLockIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <path d="M12 3 5 6v5c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6l-7-3Z" />
    <rect x="9.5" y="10.5" width="5" height="4.5" rx="1" />
    <path d="M10.5 10.5v-1a1.5 1.5 0 0 1 3 0v1" />
  </svg>
)
const KeyIcon = (
  <svg viewBox="0 0 24 24" className={g} {...s}>
    <circle cx="7.5" cy="15.5" r="4" />
    <path d="m10.5 12.5 8-8M16 5l3 3M14 7l2 2" />
  </svg>
)
const CheckIcon = (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const LockIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...s}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const RolesHeaderIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...s}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)

/** Glyph + tinted tile for a role, keyed on its canonical name. */
function roleVisual(name: string): { icon: ReactNode; tile: string } {
  switch (name) {
    case SUPER_ADMIN:
      return { icon: ShieldStarIcon, tile: 'bg-amber-500/15 text-amber-300' }
    case 'org_admin':
      return { icon: BuildingIcon, tile: 'bg-blue-500/15 text-blue-300' }
    case 'hr_manager':
      return { icon: UsersIcon, tile: 'bg-violet-500/15 text-violet-300' }
    case 'supervisor':
      return { icon: UserCheckIcon, tile: 'bg-cyan-500/15 text-cyan-300' }
    case 'employee':
      return { icon: UserIcon, tile: 'bg-slate-700/60 text-slate-300' }
    case 'security_officer':
      return { icon: ShieldLockIcon, tile: 'bg-emerald-500/15 text-emerald-300' }
    default:
      return { icon: KeyIcon, tile: 'bg-slate-800 text-slate-400' }
  }
}

export function RoleSelector({
  roles,
  selectedIds,
  onToggle,
  canAssignSuperAdmin,
}: {
  roles: RoleWithUsage[]
  selectedIds: number[]
  onToggle: (id: number, checked: boolean) => void
  /** When false, the super-admin role card is locked (only super admins grant it). */
  canAssignSuperAdmin: boolean
}) {
  const selected = new Set(selectedIds)

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-800 text-slate-300">
            {RolesHeaderIcon}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Roles</h3>
            <p className="text-xs text-slate-500">What this user can do across the system.</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
          {selected.size} selected
        </span>
      </header>

      {roles.length === 0 ? (
        <p className="rounded-xl border border-slate-700/80 bg-slate-950/40 p-4 text-sm text-slate-500">
          No roles defined yet.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {roles.map((role) => {
            const checked = selected.has(role.id)
            const isSuper = role.name === SUPER_ADMIN
            const locked = isSuper && !canAssignSuperAdmin
            const { icon, tile } = roleVisual(role.name)
            const desc = isSuper
              ? 'Bypasses all permission checks.'
              : `${role.permissions?.length ?? 0} permission${(role.permissions?.length ?? 0) === 1 ? '' : 's'}`
            return (
              <button
                key={role.id}
                type="button"
                aria-pressed={checked}
                disabled={locked}
                title={locked ? 'Only super admins can grant the Super Admin role' : undefined}
                onClick={() => onToggle(role.id, !checked)}
                className={cn(
                  'group relative flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                  locked
                    ? 'cursor-not-allowed border-slate-800 bg-slate-900 opacity-60'
                    : checked
                      ? isSuper
                        ? 'border-amber-400/60 bg-amber-500/10'
                        : 'border-blue-500 bg-blue-500/10'
                      : 'cursor-pointer border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800/50'
                )}
              >
                <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', tile)}>
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-100">{role.label}</span>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{desc}</p>
                </div>
                {locked ? (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-slate-500">
                    {LockIcon}
                  </span>
                ) : (
                  <span
                    className={cn(
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors',
                      checked
                        ? isSuper
                          ? 'border-amber-400 bg-amber-400 text-slate-900'
                          : 'border-blue-500 bg-blue-500 text-white'
                        : 'border-slate-600 text-transparent'
                    )}
                  >
                    {CheckIcon}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
