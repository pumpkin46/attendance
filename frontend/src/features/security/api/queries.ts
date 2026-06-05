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
} from '@/features/security/types'

export const securityKeys = {
  all: ['security'] as const,
  config: ['security', 'config'] as const,
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
