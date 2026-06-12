import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type { Paginated } from '@/shared/types'
import type {
  Branch,
  CreateBranchPayload,
  CreateDepartmentPayload,
  CreateOrganizationPayload,
  Department,
  Organization,
  SecurityConfig,
  SecurityAlert,
  SecurityAlertFilters,
  SecurityDashboard,
  SecurityMonitoringConfig,
  UpdateBranchPayload,
  UpdateDepartmentPayload,
  UpdateOrganizationPayload,
} from '@/features/security/types'

export const securityKeys = {
  all: ['security'] as const,
  config: ['security', 'config'] as const,
}

export const securityMonitoringKeys = {
  all: ['security-monitoring'] as const,
  config: ['security-monitoring', 'config'] as const,
  dashboard: ['security-monitoring', 'dashboard'] as const,
  alerts: ['security-monitoring', 'alerts'] as const,
  alertList: (filters: SecurityAlertFilters) =>
    ['security-monitoring', 'alerts', filters] as const,
}

/** All times the API filters/aggregates on are shifted to the viewer's day. */
const tzOffset = () => new Date().getTimezoneOffset()

export function useSecurityMonitoringConfig() {
  return useApiQuery<SecurityMonitoringConfig>(
    securityMonitoringKeys.config,
    '/security-monitoring/config',
    undefined,
    { silent: true, staleTime: STATIC_STALE_MS }
  )
}

/** `poll` comes from `useFallbackPoll` — undefined while the socket is healthy. */
export function useSecurityDashboard(poll: number | undefined) {
  return useApiQuery<SecurityDashboard>(
    securityMonitoringKeys.dashboard,
    '/security-monitoring/dashboard',
    { tz_offset: tzOffset() },
    { silent: true, refetchInterval: poll }
  )
}

export function useSecurityAlerts(filters: SecurityAlertFilters, poll: number | undefined) {
  return useApiQuery<Paginated<SecurityAlert>>(
    securityMonitoringKeys.alertList(filters),
    '/security-monitoring/alerts',
    { ...filters, tz_offset: tzOffset() },
    { silent: true, refetchInterval: poll, keepPreviousData: true }
  )
}

/**
 * Fetch a security-alert export (csv/xlsx) for client-side download. The
 * filename comes from the response's Content-Disposition — the backend is the
 * single source of truth for naming.
 */
export async function fetchSecurityAlertExport(
  params: Record<string, string | number | undefined>
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await api.get<Blob>('/security-monitoring/alerts/export', {
    params: { ...params, tz_offset: tzOffset() },
    responseType: 'blob',
  })
  const disposition = res.headers['content-disposition'] as string | undefined
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return { blob: res.data, filename: match?.[1] ?? null }
}

/** Alert mutations change the alert list and the dashboard counters — config is static and never refetched here. */
function useInvalidateAlerts() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: securityMonitoringKeys.alerts })
    qc.invalidateQueries({ queryKey: securityMonitoringKeys.dashboard })
  }
}

export function useAcknowledgeAlert() {
  const invalidate = useInvalidateAlerts()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<SecurityAlert>(
        `/security-monitoring/alerts/${id}/acknowledge`
      )
      return data
    },
    onSuccess: invalidate,
  })
}

export function useResolveAlert() {
  const invalidate = useInvalidateAlerts()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<SecurityAlert>(
        `/security-monitoring/alerts/${id}/resolve`
      )
      return data
    },
    onSuccess: invalidate,
  })
}

export const organizationKeys = {
  all: ['organizations'] as const,
  list: ['organizations', 'list'] as const,
  branches: ['organizations', 'branches'] as const,
  departments: ['organizations', 'departments'] as const,
}

export function useSecurityConfig(enabled: boolean) {
  return useApiQuery<SecurityConfig>(securityKeys.config, '/security/config', undefined, {
    enabled,
    silent: true,
    staleTime: STATIC_STALE_MS,
  })
}

export function useOrganizations() {
  return useApiQuery<Organization[]>(organizationKeys.list, '/organizations')
}

export function useBranches() {
  return useApiQuery<Branch[]>(organizationKeys.branches, '/branches')
}

export function useDepartments() {
  return useApiQuery<Department[]>(organizationKeys.departments, '/departments')
}

export function useInvalidateOrganizationList() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: organizationKeys.list })
}

/**
 * Branch / department mutations also touch the org list because it embeds
 * per-org branch / department counts.
 */
function useInvalidateTenancy(key: readonly unknown[]) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: organizationKeys.list })
  }
}

export function useCreateOrganization() {
  const invalidate = useInvalidateOrganizationList()
  return useMutation({
    mutationFn: (payload: CreateOrganizationPayload) => api.post('/organizations', payload),
    onSuccess: () => {
      toast.success('Organization created')
      invalidate()
    },
  })
}

export function useUpdateOrganization() {
  const invalidate = useInvalidateOrganizationList()
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateOrganizationPayload & { id: number }) =>
      api.patch(`/organizations/${id}`, payload),
    onSuccess: () => {
      toast.success('Organization updated')
      invalidate()
    },
  })
}

export function useDeleteOrganization() {
  const invalidate = useInvalidateOrganizationList()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/organizations/${id}`),
    onSuccess: () => {
      toast.success('Organization deleted')
      invalidate()
    },
  })
}

export function useCreateBranch() {
  const invalidate = useInvalidateTenancy(organizationKeys.branches)
  return useMutation({
    mutationFn: (payload: CreateBranchPayload) => api.post('/branches', payload),
    onSuccess: () => {
      toast.success('Branch created')
      invalidate()
    },
  })
}

export function useUpdateBranch() {
  const invalidate = useInvalidateTenancy(organizationKeys.branches)
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateBranchPayload & { id: number }) =>
      api.patch(`/branches/${id}`, payload),
    onSuccess: () => {
      toast.success('Branch updated')
      invalidate()
    },
  })
}

export function useDeleteBranch() {
  // Deleting a branch detaches its departments (branch_id → null), so the
  // departments list is stale too.
  const invalidate = useInvalidateTenancy(organizationKeys.branches)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/branches/${id}`),
    onSuccess: () => {
      toast.success('Branch deleted')
      invalidate()
      qc.invalidateQueries({ queryKey: organizationKeys.departments })
    },
  })
}

export function useCreateDepartment() {
  const invalidate = useInvalidateTenancy(organizationKeys.departments)
  return useMutation({
    mutationFn: (payload: CreateDepartmentPayload) => api.post('/departments', payload),
    onSuccess: () => {
      toast.success('Department created')
      invalidate()
    },
  })
}

export function useUpdateDepartment() {
  const invalidate = useInvalidateTenancy(organizationKeys.departments)
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateDepartmentPayload & { id: number }) =>
      api.patch(`/departments/${id}`, payload),
    onSuccess: () => {
      toast.success('Department updated')
      invalidate()
    },
  })
}

export function useDeleteDepartment() {
  const invalidate = useInvalidateTenancy(organizationKeys.departments)
  return useMutation({
    mutationFn: (id: number) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      toast.success('Department deleted')
      invalidate()
    },
  })
}
