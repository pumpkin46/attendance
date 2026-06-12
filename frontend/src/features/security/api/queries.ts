import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/shared/api/client'
import { STATIC_STALE_MS, useApiQuery } from '@/shared/hooks/useApiQuery'
import type {
  Branch,
  CreateBranchPayload,
  CreateDepartmentPayload,
  CreateLocationPayload,
  CreateOrganizationPayload,
  Department,
  Location,
  Organization,
  SecurityConfig,
  UpdateBranchPayload,
  UpdateDepartmentPayload,
  UpdateLocationPayload,
  UpdateOrganizationPayload,
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
  // Deliberately the same key the employee form's location dropdown uses
  // (employeeKeys.locations), so location changes refresh both surfaces.
  locations: ['locations'] as const,
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

export function useLocations() {
  return useApiQuery<Location[]>(organizationKeys.locations, '/locations')
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

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateLocationPayload) => api.post('/locations', payload),
    onSuccess: () => {
      toast.success('Location created')
      qc.invalidateQueries({ queryKey: organizationKeys.locations })
    },
  })
}

export function useUpdateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...payload }: UpdateLocationPayload & { id: number }) =>
      api.patch(`/locations/${id}`, payload),
    onSuccess: () => {
      toast.success('Location updated')
      qc.invalidateQueries({ queryKey: organizationKeys.locations })
    },
  })
}

export function useDeleteLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/locations/${id}`),
    onSuccess: () => {
      toast.success('Location deleted')
      qc.invalidateQueries({ queryKey: organizationKeys.locations })
    },
  })
}
