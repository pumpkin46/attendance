import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { clearOrg, selectOrgId, setOrg } from '@/features/tenant/tenantSlice'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import { Combobox } from '@/shared/ui/Combobox'

interface OrgOption {
  id: number
  name: string
  is_active: boolean
}

const BuildingIcon = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" /></svg>
)

/**
 * Super-admin tenant selector. The chosen org id is persisted to the session
 * (sent as `X-Organization-Id` on every request) and the whole query cache is
 * refetched, since every server response is tenant-scoped. "All organizations"
 * clears the context — fine for browsing, but create actions need a tenant.
 */
export function OrgSwitcher() {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const orgId = useAppSelector(selectOrgId)
  const { data: orgs = [] } = useApiQuery<OrgOption[]>(
    ['organizations', 'switcher'],
    '/organizations',
    undefined,
    { silent: true, staleTime: STATIC_STALE_MS }
  )

  const switchTo = (value: string) => {
    if (value === (orgId ?? '')) return
    if (value) dispatch(setOrg(value))
    else dispatch(clearOrg())
    queryClient.invalidateQueries()
  }

  // The persisted scope can outlive its organization (deleted from another
  // session or by another admin). Self-heal: drop the stale context so writes
  // don't bounce off the backend's tenant validation.
  const orgIdStale =
    orgs.length > 0 && orgId != null && !orgs.some((o) => String(o.id) === orgId)
  useEffect(() => {
    if (orgIdStale) {
      dispatch(clearOrg())
      queryClient.invalidateQueries()
    }
  }, [orgIdStale, dispatch, queryClient])

  // Single-organization deployment: pin the context to the lone org. No cache
  // invalidation needed — the backend already defaults to this same org when
  // no tenant header is sent, so earlier responses hold identical data.
  const onlyOrg = orgs.length === 1 ? orgs[0] : null
  useEffect(() => {
    if (onlyOrg && orgId !== String(onlyOrg.id)) dispatch(setOrg(String(onlyOrg.id)))
  }, [onlyOrg, orgId, dispatch])

  if (onlyOrg) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-300">
        <span className="shrink-0 text-slate-500">{BuildingIcon}</span>
        <span className="truncate">{onlyOrg.name}</span>
      </div>
    )
  }

  // Nothing to pick yet (orgs still loading, or a fresh install with none).
  if (orgs.length === 0) return null

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-slate-500">{BuildingIcon}</span>
      <span className="hidden shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500 sm:inline">
        Organization
      </span>
      <Combobox
        size="sm"
        aria-label="Acting organization"
        placeholder="Select organization…"
        value={orgId ?? ''}
        onChange={switchTo}
        className="max-w-[14rem]"
        options={[
          { value: '', label: 'All organizations' },
          ...orgs.map((o) => ({
            value: String(o.id),
            label: o.is_active ? o.name : `${o.name} (inactive)`,
          })),
        ]}
      />
    </div>
  )
}
