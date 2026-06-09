import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { useApiQuery } from '@/shared/hooks/useApiQuery'
import type {
  Branch,
  CreateOrganizationPayload,
  Department,
  Organization,
  SecurityConfig,
  SecurityAlert,
  SecurityDashboard,
  SecurityMonitoringConfig,
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
}

export function useSecurityMonitoringConfig() {
  return useApiQuery<SecurityMonitoringConfig>(
    securityMonitoringKeys.config,
    '/security-monitoring/config',
    undefined,
    { silent: true }
  )
}

/** `poll` comes from `useFallbackPoll` — undefined while the socket is healthy. */
export function useSecurityDashboard(poll: number | undefined) {
  return useApiQuery<SecurityDashboard>(
    securityMonitoringKeys.dashboard,
    '/security-monitoring/dashboard',
    undefined,
    { silent: true, refetchInterval: poll }
  )
}

export function useSecurityAlerts(poll: number | undefined) {
  return useApiQuery<{ data: SecurityAlert[] }>(
    securityMonitoringKeys.alerts,
    '/security-monitoring/alerts',
    { per_page: 50 },
    { silent: true, refetchInterval: poll }
  )
}

function useInvalidateSecurityMonitoring() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: securityMonitoringKeys.all })
}

export function useAcknowledgeAlert() {
  const invalidate = useInvalidateSecurityMonitoring()
  return useMutation({
    mutationFn: (id: number) => api.post(`/security-monitoring/alerts/${id}/acknowledge`),
    onSuccess: invalidate,
  })
}

export function useResolveAlert() {
  const invalidate = useInvalidateSecurityMonitoring()
  return useMutation({
    mutationFn: (id: number) => api.post(`/security-monitoring/alerts/${id}/resolve`),
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

/** Invalidates every organization-scoped query after a mutation. */
export function useInvalidateOrganizations() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: organizationKeys.all })
}

export function useCreateOrganization() {
  const invalidate = useInvalidateOrganizations()
  return useMutation({
    mutationFn: (payload: CreateOrganizationPayload) => api.post('/organizations', payload),
    onSuccess: () => {
      toast.success('Organization created')
      invalidate()
    },
  })
}
